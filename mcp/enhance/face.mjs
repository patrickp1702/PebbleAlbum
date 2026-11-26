/**
 * face.mjs — face detection, 68-point landmarks, head-pose estimates and the
 * 128-d identity descriptor for AI Enhance (MCP server side, plain Node).
 * -----------------------------------------------------------------------------
 * Uses @vladmandic/face-api's CJS node-wasm build with tfjs on the CPU backend
 * (the ESM builds crash under plain Node). Model weights ship inside the package
 * and are loaded from disk — no network. Models load lazily, once per process.
 *
 * Detection runs on an EXIF-upright copy downscaled to ≤ 1024 px; landmarks and
 * boxes are scaled back to FULL-RES upright pixel coordinates. "The face" is the
 * largest detected box. Angles are geometric estimates from the landmarks — good
 * for comparing two images of the same pose (differences), not absolute truth.
 *
 * Nothing here writes to stdout (the tfjs banner goes to stderr).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';

/**
 * Resolve @vladmandic/face-api next to this file (dev), else from the app's
 * unpacked node_modules (packaged build: the server runs from resources/mcp/ while
 * the deps live in app.asar.unpacked — PEBBLE_APP_ROOT points at app.asar).
 */
function faceRequire() {
  const candidates = [import.meta.url];
  const root = process.env.PEBBLE_APP_ROOT;
  if (root) {
    candidates.push(path.join(root.replace(/app\.asar$/, 'app.asar.unpacked'), 'package.json'));
    candidates.push(path.join(root, 'package.json'));
  }
  for (const c of candidates) {
    try { const r = createRequire(c); r.resolve('@vladmandic/face-api/package.json'); return r; } catch { /* next */ }
  }
  throw new Error('@vladmandic/face-api is not installed (npm i in the app folder).');
}
let faceapi = null;
let loading = null;

async function loadNet(tf, net, modelDir, name) {
  const manifest = JSON.parse(await fs.readFile(path.join(modelDir, `${name}-weights_manifest.json`), 'utf-8'));
  const specs = manifest.flatMap((g) => g.weights);
  const bufs = [];
  for (const g of manifest) for (const p of g.paths) bufs.push(await fs.readFile(path.join(modelDir, p))); // eslint-disable-line no-await-in-loop
  const all = Buffer.concat(bufs);
  await net.loadFromWeightMap(tf.io.decodeWeights(all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength), specs));
}

/** Lazy, once-per-process model load. */
export async function ensureFaceModels() {
  if (faceapi) return faceapi;
  if (!loading) {
    loading = (async () => {
      // console.log from the tfjs banner would corrupt the MCP stream → route to stderr while loading.
      const origLog = console.log;
      console.log = (...a) => console.error(...a); // eslint-disable-line no-console
      try {
        const require = faceRequire();
        const fa = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
        const tf = fa.tf;
        await tf.setBackend('cpu');
        await tf.ready();
        const modelDir = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
        await loadNet(tf, fa.nets.ssdMobilenetv1, modelDir, 'ssd_mobilenetv1_model');
        await loadNet(tf, fa.nets.faceLandmark68Net, modelDir, 'face_landmark_68_model');
        await loadNet(tf, fa.nets.faceRecognitionNet, modelDir, 'face_recognition_model');
        faceapi = fa;
        return fa;
      } finally { console.log = origLog; } // eslint-disable-line no-console
    })().catch((e) => { loading = null; throw new Error(`Face models could not be loaded: ${e.message}`); });
  }
  return loading;
}

const mean = (pts) => { let x = 0; let y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
const DEG = 180 / Math.PI;

/** Eye centres (image-left eye first), nose tip, mouth corners — the 5 alignment points. */
export function fivePoints(lm) {
  return [mean(lm.slice(36, 42)), mean(lm.slice(42, 48)), lm[30], lm[48], lm[54]];
}

/**
 * Head-pose estimates from 68 landmarks (degrees).
 *  roll  — angle of the eye line (+ = clockwise in the image).
 *  yaw   — nose-tip offset between the jaw extremes after de-rolling: asin(2t−1),
 *          0 = frontal, + = nose towards image right.
 *  pitch — nose-bridge length (27→30) vs eyes-to-mouth distance, relative to a
 *          typical frontal ratio: + = looking down, − = looking up.
 */
export function poseFromLandmarks(lm) {
  const [le, re] = fivePoints(lm);
  const roll = Math.atan2(re[1] - le[1], re[0] - le[0]);
  const c = Math.cos(-roll); const s = Math.sin(-roll);
  const o = [(le[0] + re[0]) / 2, (le[1] + re[1]) / 2];
  const rot = (p) => [o[0] + (p[0] - o[0]) * c - (p[1] - o[1]) * s, o[1] + (p[0] - o[0]) * s + (p[1] - o[1]) * c];
  const j0 = rot(lm[0]); const j16 = rot(lm[16]); const nose = rot(lm[30]);
  const span = j16[0] - j0[0];
  const t = span > 1e-6 ? (nose[0] - j0[0]) / span : 0.5;
  const yaw = Math.asin(Math.max(-1, Math.min(1, 2 * t - 1)));
  const mouth = mean([lm[48], lm[54], lm[51], lm[57]]);
  const eyeMouth = dist(o, mouth);
  const bridge = dist(lm[27], lm[30]);
  const FRONTAL_RATIO = 0.62; // bridge / eyes-to-mouth on a frontal face (calibrated on frontal portraits)
  const ratio = eyeMouth > 1e-6 ? bridge / eyeMouth : FRONTAL_RATIO;
  const pitch = Math.asin(Math.max(-1, Math.min(1, ratio / FRONTAL_RATIO - 1)));
  return { roll: roll * DEG, yaw: yaw * DEG, pitch: pitch * DEG };
}

const cache = new Map();
const CACHE_MAX = 24;

/**
 * Detect the largest face in an image file.
 * @returns {Promise<{width:number,height:number,faces:number,face:null|{score:number,box:{x,y,width,height},landmarks:number[][],descriptor:Float32Array}}>}
 *          (full-res upright pixel coordinates)
 */
export async function detectFace(file, { maxSide = 1024 } = {}) {
  const st = await fs.stat(file);
  const key = `${path.resolve(file)}|${st.mtimeMs}|${st.size}|${maxSide}`;
  if (cache.has(key)) return cache.get(key);
  const fa = await ensureFaceModels();
  const meta = await sharp(file).metadata();
  const swap = (meta.orientation || 1) >= 5;
  const fullW = swap ? meta.height : meta.width;
  const fullH = swap ? meta.width : meta.height;
  // Pass 1 at ≤ maxSide / 0.4 confidence; generated images with strong colour casts or
  // rotation can score lower, so retry with a lower threshold and a second scale.
  const passes = [[maxSide, 0.4], [maxSide, 0.25], [Math.min(640, maxSide), 0.25]];
  let dets = []; let k = 1;
  for (const [side, minConfidence] of passes) {
    // eslint-disable-next-line no-await-in-loop
    const { data, info } = await sharp(file).rotate()
      .resize(side, side, { fit: 'inside', withoutEnlargement: true })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    k = fullW / info.width; // detection px → full-res px
    const tensor = fa.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');
    try {
      // eslint-disable-next-line no-await-in-loop
      dets = await fa.detectAllFaces(tensor, new fa.SsdMobilenetv1Options({ minConfidence })).withFaceLandmarks().withFaceDescriptors();
    } finally { tensor.dispose(); }
    if (dets.length) break;
  }
  let best = null;
  for (const d of dets) {
    const b = d.detection.box;
    if (!best || b.width * b.height > best.detection.box.width * best.detection.box.height) best = d;
  }
  const res = { width: fullW, height: fullH, faces: dets.length, face: null };
  if (best) {
    const b = best.detection.box;
    res.face = {
      score: best.detection.score,
      box: { x: b.x * k, y: b.y * k, width: b.width * k, height: b.height * k },
      landmarks: best.landmarks.positions.map((p) => [p.x * k, p.y * k]),
      descriptor: best.descriptor,
    };
  }
  cache.set(key, res);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return res;
}

/** EnhanceFaceMetrics (src/types/pebble.types.ts) for a detectFace() result. */
export function faceMetrics(det) {
  if (!det || !det.face) return { detected: false, faces: det ? det.faces : 0 };
  const { face, width, height } = det;
  const pose = poseFromLandmarks(face.landmarks);
  const [le, re] = fivePoints(face.landmarks);
  return {
    detected: true,
    score: r3(face.score),
    yaw: r1(pose.yaw), pitch: r1(pose.pitch), roll: r1(pose.roll),
    eyeDistance: r3(dist(le, re) / width),
    box: { x: r3(face.box.x / width), y: r3(face.box.y / height), width: r3(face.box.width / width), height: r3(face.box.height / height) },
    faces: det.faces,
  };
}

/** 1 − euclidean distance of two 128-d descriptors, clamped 0..1 (≥ 0.4 ≈ same person per face-api's 0.6 rule). */
export function descriptorSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return undefined;
  let s = 0;
  for (let i = 0; i < a.length; i += 1) { const d = a[i] - b[i]; s += d * d; }
  return r3(Math.max(0, Math.min(1, 1 - Math.sqrt(s))));
}

/** Source-vs-variant comparison block used by enhance_generate / compare / composite. */
export function compareMetrics(srcDet, varDet) {
  const source = faceMetrics(srcDet);
  const generated = faceMetrics(varDet);
  const out = { source, generated };
  if (source.detected && generated.detected) {
    out.yawDiff = r1(Math.abs(generated.yaw - source.yaw));
    out.pitchDiff = r1(Math.abs(generated.pitch - source.pitch));
    out.rollDiff = r1(Math.abs(generated.roll - source.roll));
    out.similarity = descriptorSimilarity(srcDet.face.descriptor, varDet.face.descriptor);
  }
  return out;
}
