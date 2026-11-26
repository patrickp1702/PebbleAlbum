/**
 * composite.mjs — put the ORIGINAL face back onto a generated variant.
 * -----------------------------------------------------------------------------
 *  1. 2-D similarity transform (scale + rotation + translation, least squares /
 *     Umeyama) from 5 points: eye centres, nose tip (30), mouth corners (48, 54),
 *     source → variant.
 *  2. Face mask in the variant grid: convex hull of the jaw (0..16) + brows
 *     (17..26) lifted by maskTop × face height, scaled by `expand` about the face
 *     centre, rasterised by scanline, then feathered INWARD with a separable box
 *     blur (3 passes ≈ Gaussian) so the fade never pulls source background in.
 *  3. Inverse-mapped bilinear warp of the source into the variant grid (raw RGBA,
 *     only inside the mask's bounding box).
 *  4. Reinhard tone transfer in CIE Lab: warped-source stats → variant stats over
 *     the SAME region (mask > 0.5), σ ratio clamped to [0.7, 1.4], blended by
 *     `toneMatch`.
 *  5. Straight-alpha composite out = variant·(1−m) + face·m → JPEG q92 at the
 *     variant's resolution.
 * Also builds the generation-time keep-face mask (opaque face, transparent rest).
 */
import sharp from 'sharp';
import { fivePoints } from './face.mjs';

// ---- geometry ---------------------------------------------------------------

/** Least-squares similarity transform mapping src[i] → dst[i]. q = s·R·p + t. */
export function similarityTransform(src, dst) {
  const n = src.length;
  let mpx = 0; let mpy = 0; let mqx = 0; let mqy = 0;
  for (let i = 0; i < n; i += 1) { mpx += src[i][0]; mpy += src[i][1]; mqx += dst[i][0]; mqy += dst[i][1]; }
  mpx /= n; mpy /= n; mqx /= n; mqy /= n;
  let sxx = 0; let sxy = 0; let va = 0;
  for (let i = 0; i < n; i += 1) {
    const ax = src[i][0] - mpx; const ay = src[i][1] - mpy;
    const bx = dst[i][0] - mqx; const by = dst[i][1] - mqy;
    sxx += ax * bx + ay * by; sxy += ax * by - ay * bx; va += ax * ax + ay * ay;
  }
  const theta = Math.atan2(sxy, sxx);
  const s = va > 1e-9 ? Math.hypot(sxx, sxy) / va : 1;
  const a = s * Math.cos(theta); const b = s * Math.sin(theta);
  // q = [a −b; b a]·p + t
  const tx = mqx - (a * mpx - b * mpy); const ty = mqy - (b * mpx + a * mpy);
  const apply = (p) => [a * p[0] - b * p[1] + tx, b * p[0] + a * p[1] + ty];
  let err = 0;
  for (let i = 0; i < n; i += 1) { const q = apply(src[i]); err += (q[0] - dst[i][0]) ** 2 + (q[1] - dst[i][1]) ** 2; }
  return { a, b, tx, ty, scale: s, rotationDeg: theta * 180 / Math.PI, residual: Math.sqrt(err / n), apply };
}

function convexHull(points) {
  const p = points.map((q) => [q[0], q[1]]).sort((u, v) => (u[0] - v[0]) || (u[1] - v[1]));
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = []; for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper = []; for (let i = p.length - 1; i >= 0; i -= 1) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/** Face-mask polygon (convex) in the landmarks' own pixel space. */
export function faceMaskPolygon(lm, { expand = 1.05, maskTop = 0.35 } = {}) {
  const [le, re] = fivePoints(lm);
  const ex = re[0] - le[0]; const ey = re[1] - le[1]; const el = Math.hypot(ex, ey) || 1;
  const up = [ey / el, -ex / el]; // perpendicular to the eye line, pointing to the forehead
  const browMid = [0, 0]; for (let i = 17; i <= 26; i += 1) { browMid[0] += lm[i][0] / 10; browMid[1] += lm[i][1] / 10; }
  const faceH = Math.hypot(lm[8][0] - browMid[0], lm[8][1] - browMid[1]);
  const lift = maskTop * faceH;
  const pts = [];
  for (let i = 0; i <= 16; i += 1) pts.push(lm[i]);
  for (let i = 17; i <= 26; i += 1) pts.push([lm[i][0] + up[0] * lift, lm[i][1] + up[1] * lift]);
  const hull = convexHull(pts);
  let cx = 0; let cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
  const poly = hull.map((p) => [cx + (p[0] - cx) * expand, cy + (p[1] - cy) * expand]);
  const jawW = Math.hypot(lm[16][0] - lm[0][0], lm[16][1] - lm[0][1]);
  return { poly, center: [cx, cy], faceWidth: jawW, faceHeight: faceH };
}

/** Even-odd scanline fill of a polygon into a Float32 mask of the bbox (pixel centres). */
function rasterize(poly, bx, by, bw, bh) {
  const m = new Float32Array(bw * bh);
  const xs = [];
  for (let row = 0; row < bh; row += 1) {
    const y = by + row + 0.5;
    xs.length = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const [x1, y1] = poly[i]; const [x2, y2] = poly[j];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - bx - 0.5)); const x1 = Math.min(bw - 1, Math.floor(xs[k + 1] - bx - 0.5));
      for (let x = x0; x <= x1; x += 1) m[row * bw + x] = 1;
    }
  }
  return m;
}

/** In-place separable box blur, `passes` times (3 ≈ Gaussian with σ ≈ r). Edge-clamped. */
function boxBlur(m, w, h, r, passes = 3) {
  if (r < 1) return m;
  const tmp = new Float32Array(Math.max(w, h));
  const win = 2 * r + 1;
  for (let p = 0; p < passes; p += 1) {
    for (let y = 0; y < h; y += 1) {
      const o = y * w; let acc = 0;
      for (let k = -r; k <= r; k += 1) acc += m[o + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x += 1) {
        tmp[x] = acc / win;
        acc += m[o + Math.min(w - 1, x + r + 1)] - m[o + Math.max(0, x - r)];
      }
      for (let x = 0; x < w; x += 1) m[o + x] = tmp[x];
    }
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let k = -r; k <= r; k += 1) acc += m[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y += 1) {
        tmp[y] = acc / win;
        acc += m[Math.min(h - 1, y + r + 1) * w + x] - m[Math.max(0, y - r) * w + x];
      }
      for (let y = 0; y < h; y += 1) m[y * w + x] = tmp[y];
    }
  }
  return m;
}

/**
 * Feathered mask for a landmark set in an image grid of W×H.
 * Feather is applied INSIDE the polygon: the hard polygon is blurred and then
 * remapped (2m−1) so alpha is 0 on the outline and reaches 1 ≈ 1.5·r inside.
 * @returns {{mask:Float32Array, bx:number, by:number, bw:number, bh:number, radius:number, maskPx:number, poly:number[][]}}
 */
export function featheredFaceMask(lm, W, H, { feather = 0.12, expand = 1.05, maskTop = 0.35 } = {}) {
  const { poly, faceWidth } = faceMaskPolygon(lm, { expand, maskTop });
  const radius = Math.max(0, Math.round(feather * faceWidth / 2));
  const pad = 3 * radius + 2;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of poly) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const bx = Math.max(0, Math.floor(minX - pad)); const by = Math.max(0, Math.floor(minY - pad));
  const bw = Math.max(1, Math.min(W, Math.ceil(maxX + pad)) - bx); const bh = Math.max(1, Math.min(H, Math.ceil(maxY + pad)) - by);
  const mask = rasterize(poly, bx, by, bw, bh);
  if (radius >= 1) {
    boxBlur(mask, bw, bh, radius, 3);
    for (let i = 0; i < mask.length; i += 1) mask[i] = Math.max(0, Math.min(1, 2 * mask[i] - 1));
  }
  let maskPx = 0; for (let i = 0; i < mask.length; i += 1) if (mask[i] > 0.5) maskPx += 1;
  return { mask, bx, by, bw, bh, radius, maskPx, poly };
}

/**
 * Generation-time keep-face mask PNG (W×H): RGB black, alpha = feathered face
 * (opaque = KEEP the face, transparent = REGENERATE). `lm` in W×H pixel space.
 */
export async function keepFaceMaskPng(lm, W, H, opts = {}) {
  const f = featheredFaceMask(lm, W, H, { feather: 0.08, expand: 1.1, maskTop: 0.35, ...opts });
  const rgba = Buffer.alloc(W * H * 4);
  for (let y = 0; y < f.bh; y += 1) {
    for (let x = 0; x < f.bw; x += 1) {
      const a = f.mask[y * f.bw + x];
      if (a > 0) rgba[((f.by + y) * W + f.bx + x) * 4 + 3] = Math.round(a * 255);
    }
  }
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

// ---- colour (sRGB ↔ CIE Lab, D65) -----------------------------------------
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i += 1) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
const fInv = (t) => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
const toSrgb = (c) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * (c ** (1 / 2.4)) - 0.055; return v * 255; };

const linF = (v) => { if (Number.isInteger(v) && v >= 0 && v <= 255) return LIN[v]; const c = Math.max(0, Math.min(1, v / 255)); return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function rgbToLab(r, g, b, out) {
  const R = linF(r); const G = linF(g); const B = linF(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
  const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
  const fx = fLab(X); const fy = fLab(Y); const fz = fLab(Z);
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
}
function labToRgb(L, A, Bv, out) {
  const fy = (L + 16) / 116; const fx = fy + A / 500; const fz = fy - Bv / 200;
  const X = fInv(fx) * 0.95047; const Y = fInv(fy); const Z = fInv(fz) * 1.08883;
  const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const G = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
  const B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  out[0] = toSrgb(Math.max(0, Math.min(1, R))); out[1] = toSrgb(Math.max(0, Math.min(1, G))); out[2] = toSrgb(Math.max(0, Math.min(1, B)));
}

// ---- the composite ----------------------------------------------------------

/**
 * @param {object} o
 * @param {string} o.sourcePath  original photo (any orientation; EXIF-rotated here)
 * @param {{landmarks:number[][], width:number, height:number}} o.sourceFace  full-res upright landmarks + dims
 * @param {string} o.variantPath generated image
 * @param {{landmarks:number[][]}} o.variantFace  variant landmarks (variant pixel space)
 * @returns {Promise<{buffer:Buffer,width:number,height:number,alignmentResidualPx:number,scale:number,rotationDeg:number,maskPx:number,faceBox:{x,y,width,height}}>}
 */
export async function compositeFace({ sourcePath, sourceFace, variantPath, variantFace, feather = 0.12, toneMatch = 0.85, expand = 1.05, maskTop = 0.35 }) {
  const { data: vdata, info: vinfo } = await sharp(variantPath).rotate().removeAlpha().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = vinfo.width; const H = vinfo.height;
  const dstPts = fivePoints(variantFace.landmarks);
  let srcLm = sourceFace.landmarks;
  let T = similarityTransform(fivePoints(srcLm), dstPts);
  // Pre-shrink the source when the face is being scaled DOWN (memory + less aliasing
  // than bilinear minification). Afterwards the remaining scale is ≈ 1.
  let srcScale = 1;
  if (T.scale < 0.95) srcScale = T.scale;
  const sw = Math.max(1, Math.round(sourceFace.width * srcScale)); const sh = Math.max(1, Math.round(sourceFace.height * srcScale));
  const { data: sdata, info: sinfo } = await sharp(sourcePath).rotate().resize(sw, sh, { fit: 'fill' }).removeAlpha().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const kx = sinfo.width / sourceFace.width; const ky = sinfo.height / sourceFace.height;
  if (kx !== 1 || ky !== 1) {
    srcLm = srcLm.map((p) => [p[0] * kx, p[1] * ky]);
    const T2 = similarityTransform(fivePoints(srcLm), dstPts);
    T = { ...T2, scale: T.scale, residual: T2.residual };
  }
  const SW = sinfo.width; const SH = sinfo.height;
  // Inverse of q = [a −b; b a]p + t  →  p = [a b; −b a](q − t) / (a² + b²)
  const det = T.a * T.a + T.b * T.b;
  const ia = T.a / det; const ib = T.b / det;

  const fm = featheredFaceMask(variantFace.landmarks, W, H, { feather, expand, maskTop });
  const { mask, bx, by, bw, bh } = fm;
  const n = bw * bh;
  const face = new Float32Array(n * 3); // warped source RGB
  const valid = new Uint8Array(n);
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      const i = y * bw + x;
      if (mask[i] <= 0) continue;
      const qx = bx + x + 0.5 - T.tx; const qy = by + y + 0.5 - T.ty;
      const px = ia * qx + ib * qy - 0.5; const py = -ib * qx + ia * qy - 0.5;
      if (px < 0 || py < 0 || px > SW - 1 || py > SH - 1) continue;
      const x0 = Math.floor(px); const y0 = Math.floor(py);
      const x1 = Math.min(SW - 1, x0 + 1); const y1 = Math.min(SH - 1, y0 + 1);
      const fx = px - x0; const fy = py - y0;
      const o00 = (y0 * SW + x0) * 4; const o10 = (y0 * SW + x1) * 4; const o01 = (y1 * SW + x0) * 4; const o11 = (y1 * SW + x1) * 4;
      for (let c = 0; c < 3; c += 1) {
        const top = sdata[o00 + c] * (1 - fx) + sdata[o10 + c] * fx;
        const bot = sdata[o01 + c] * (1 - fx) + sdata[o11 + c] * fx;
        face[i * 3 + c] = top * (1 - fy) + bot * fy;
      }
      valid[i] = 1;
    }
  }

  // Reinhard Lab statistics over mask > 0.5.
  const lab = new Float32Array(n * 3);
  const tmp = [0, 0, 0];
  const sSum = [0, 0, 0]; const sSq = [0, 0, 0]; const vSum = [0, 0, 0]; const vSq = [0, 0, 0]; let cnt = 0;
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      const i = y * bw + x;
      if (!valid[i]) continue;
      rgbToLab(face[i * 3], face[i * 3 + 1], face[i * 3 + 2], tmp);
      lab[i * 3] = tmp[0]; lab[i * 3 + 1] = tmp[1]; lab[i * 3 + 2] = tmp[2];
      if (mask[i] > 0.5) {
        for (let c = 0; c < 3; c += 1) { sSum[c] += tmp[c]; sSq[c] += tmp[c] * tmp[c]; }
        const vo = ((by + y) * W + bx + x) * 4;
        rgbToLab(vdata[vo], vdata[vo + 1], vdata[vo + 2], tmp);
        for (let c = 0; c < 3; c += 1) { vSum[c] += tmp[c]; vSq[c] += tmp[c] * tmp[c]; }
        cnt += 1;
      }
    }
  }
  const tm = Math.max(0, Math.min(1, toneMatch));
  const muS = [0, 0, 0]; const muV = [0, 0, 0]; const ratio = [1, 1, 1];
  if (cnt > 16 && tm > 0) {
    for (let c = 0; c < 3; c += 1) {
      muS[c] = sSum[c] / cnt; muV[c] = vSum[c] / cnt;
      const sdS = Math.sqrt(Math.max(1e-6, sSq[c] / cnt - muS[c] ** 2));
      const sdV = Math.sqrt(Math.max(1e-6, vSq[c] / cnt - muV[c] ** 2));
      ratio[c] = Math.max(0.7, Math.min(1.4, sdV / sdS));
    }
  }
  const doTone = cnt > 16 && tm > 0;

  const out = Buffer.from(vdata); // RGBA copy of the variant
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      const i = y * bw + x;
      if (!valid[i]) continue;
      const m = mask[i];
      let r = face[i * 3]; let g = face[i * 3 + 1]; let b = face[i * 3 + 2];
      if (doTone) {
        labToRgb((lab[i * 3] - muS[0]) * ratio[0] + muV[0], (lab[i * 3 + 1] - muS[1]) * ratio[1] + muV[1], (lab[i * 3 + 2] - muS[2]) * ratio[2] + muV[2], tmp);
        r = r * (1 - tm) + tmp[0] * tm; g = g * (1 - tm) + tmp[1] * tm; b = b * (1 - tm) + tmp[2] * tm;
      }
      const o = ((by + y) * W + bx + x) * 4;
      out[o] = Math.round(out[o] * (1 - m) + r * m);
      out[o + 1] = Math.round(out[o + 1] * (1 - m) + g * m);
      out[o + 2] = Math.round(out[o + 2] * (1 - m) + b * m);
    }
  }
  const buffer = await sharp(out, { raw: { width: W, height: H, channels: 4 } }).removeAlpha().jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  // Face box of the composite (variant space) for preview crops.
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [px, py] of variantFace.landmarks) { minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); }
  return {
    buffer, width: W, height: H,
    alignmentResidualPx: Math.round(T.residual * 100) / 100,
    scale: Math.round(T.scale * 1000) / 1000,
    rotationDeg: Math.round(T.rotationDeg * 100) / 100,
    maskPx: fm.maskPx,
    faceBox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}
