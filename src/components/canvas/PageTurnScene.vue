<script setup lang="ts">
/**
 * PageTurnScene.vue
 * -----------------------------------------------------------------------------
 * WebGL page-turn preview (Three.js). The default style is a realistic **page
 * curl**: the current page (printed on one side) curls away from the right edge
 * toward the left spine, revealing the next page lying flat beneath it.
 *
 * Implementation notes:
 *  - Two meshes per turn: `under` (the page being revealed, flat) and `over`
 *    (the page being turned). For curl, `over` uses a vertex shader that bends
 *    the page around a moving cylinder; its back face shows a paper colour.
 *  - Every turn fully rebuilds + disposes its meshes, so repeated turns are
 *    reliable (the previous implementation broke after the first turn).
 *  - Other styles (hard / slide / fade) animate a simple textured plane.
 *  Speed: slow 1.2s · normal 0.6s · fast 0.3s.
 */
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as THREE from 'three';
import { useProjectStore } from '@/stores/projectStore';
import { renderPageStatic } from '@/engine/pageRenderer';
import { loadImageDataUrl } from '@/engine/imageLoader';

const props = withDefaults(defineProps<{ pageIndex: number; kenBurns?: boolean }>(), { kenBurns: true });
const emit = defineEmits<{ (e: 'pageChanged', index: number): void }>();
const project = useProjectStore();
let kbStart = performance.now(); // Ken Burns animation clock, reset per page

const host = ref<HTMLDivElement | null>(null);
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let raf = 0;
let busy = false;
let shownIndex = props.pageIndex;

let over: THREE.Mesh | null = null;
let under: THREE.Mesh | null = null;

const PLANE_H = 4;
const planeW = () => PLANE_H * ((project.meta?.albumWidth ?? 3) / (project.meta?.albumHeight ?? 2));
const speedMs = () => ({ slow: 1200, normal: 600, fast: 300 }[project.meta?.pageTurnSpeed ?? 'normal']);
const style = () => project.meta?.pageTurnStyle ?? 'curl';

const CURL_VERT = `
  uniform float uProgress; uniform float uWidth;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    float R = 0.42;
    float cx = mix(uWidth * 0.5, -uWidth * 0.5 - R * 3.14159, uProgress);
    float d = p.x - cx;
    if (d > 0.0) {
      float ang = d / R;
      p.x = cx + R * sin(ang);
      p.z = R * (1.0 - cos(ang));
    }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const CURL_FRAG = `
  uniform sampler2D uTex; uniform vec3 uBack;
  varying vec2 vUv;
  void main() {
    if (gl_FrontFacing) gl_FragColor = texture2D(uTex, vUv);
    else gl_FragColor = vec4(uBack, 1.0);
  }`;

async function makeTexture(index: number): Promise<THREE.Texture | null> {
  const page = project.pages[index];
  if (!page || !project.meta || !project.theme) return null;
  // Use the shared ≤1600px thumbnail loader (same as the editor): EXIF-normalised,
  // cached, and small enough that Fabric's WebGL filter backend never truncates it.
  // Reading the full-resolution original here made filtered tall photos (e.g.
  // 3376×6000) exceed the GL texture size, so the preview showed only ~2/3 of the
  // image with a blank band below — and it was far slower.
  const dataUrl = await renderPageStatic(
    page, project.meta, project.theme,
    (f) => loadImageDataUrl(project.meta!.sourceFolder, f, 1600), 0.45,
  );
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(dataUrl, (t) => { t.colorSpace = THREE.SRGBColorSpace; resolve(t); }, undefined, () => resolve(null));
  });
}

function geometry(subdiv: boolean): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(planeW(), PLANE_H, subdiv ? 80 : 1, 1);
}

function disposeMesh(m: THREE.Mesh | null) {
  if (!m || !scene) return;
  scene.remove(m);
  m.geometry.dispose();
  const mat = m.material as THREE.Material & { map?: THREE.Texture };
  mat.map?.dispose();
  mat.dispose();
}

/** Build a single flat page (the resting state). */
async function buildStatic(index: number) {
  if (!scene) return;
  const tex = await makeTexture(index);
  disposeMesh(over); disposeMesh(under); under = null;
  const mat = new THREE.MeshBasicMaterial({ map: tex ?? undefined, side: THREE.DoubleSide });
  over = new THREE.Mesh(geometry(false), mat);
  scene.add(over);
  kbStart = performance.now(); // restart Ken Burns drift for the new page
}

/** Apply a subtle Ken Burns pan/zoom to the resting page (cinematic life). */
function applyKenBurns(now: number) {
  if (!over || busy || !props.kenBurns) { if (over && !busy) over.scale.setScalar(1); return; }
  const e = (now - kbStart) / 1000;
  const z = 1 + 0.05 * (0.5 - 0.5 * Math.cos(e * 0.22)); // 1.00 → 1.05, slow ease
  over.scale.set(z, z, 1);
  const dir = shownIndex % 2 === 0 ? 1 : -1;
  over.position.x = dir * 0.06 * (planeW() / 2) * (0.5 - 0.5 * Math.cos(e * 0.18));
  over.position.y = -dir * 0.05 * (PLANE_H / 2) * (0.5 - 0.5 * Math.cos(e * 0.15));
}

/** Ease for the newer styles (smooth in-out; classic styles stay linear). */
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Apply the current animation progress (0..1) to the meshes for a style/dir. */
function applyState(p: number, dir: 1 | -1) {
  if (!over) return;
  const W = planeW();
  const s = style();
  // For reverse turns the "over" mesh is the INCOMING page: run its motion backwards.
  const q = dir > 0 ? p : 1 - p;
  if (s === 'curl') {
    (over.material as THREE.ShaderMaterial).uniforms.uProgress.value = q;
  } else if (s === 'slide') {
    over.position.x = -W * q;
  } else if (s === 'fade') {
    const m = over.material as THREE.MeshBasicMaterial; m.transparent = true; m.opacity = 1 - q;
  } else if (s === 'push') {
    // Old page pushed off to the left while the new page slides in from the right.
    const e = easeInOut(q);
    over.position.x = -W * e;
    if (under) under.position.x = W * (1 - e);
  } else if (s === 'zoom') {
    // Old page zooms toward the camera and dissolves, revealing the new page.
    const e = easeInOut(q);
    const m = over.material as THREE.MeshBasicMaterial; m.transparent = true; m.opacity = 1 - e;
    const k = 1 + 0.35 * e;
    over.scale.set(k, k, 1);
    if (under) { const uk = 0.92 + 0.08 * e; under.scale.set(uk, uk, 1); }
  } else if (s === 'flip_up') {
    // Flip up around the bottom edge (calendar-style).
    over.rotation.x = Math.PI * q;
  } else { // hard flip around the left spine
    over.rotation.y = -Math.PI * q;
  }
}

/** Start a turn in a direction (+1 next, -1 prev). */
async function turn(dir: 1 | -1) {
  if (busy || !scene) return;
  const target = Math.min(project.pages.length - 1, Math.max(0, shownIndex + dir));
  if (target === shownIndex) return;
  busy = true;

  const overIndex = dir > 0 ? shownIndex : target; // page that turns
  const underIndex = dir > 0 ? target : shownIndex; // page revealed
  const [overTex, underTex] = await Promise.all([makeTexture(overIndex), makeTexture(underIndex)]);

  disposeMesh(over); disposeMesh(under);
  // Under page sits flat, slightly behind.
  under = new THREE.Mesh(geometry(false), new THREE.MeshBasicMaterial({ map: underTex ?? undefined, side: THREE.DoubleSide }));
  under.position.z = -0.01;
  scene.add(under);

  // Over page uses the curl shader (default) or a basic material for other styles.
  const W = planeW();
  if (style() === 'curl') {
    over = new THREE.Mesh(geometry(true), new THREE.ShaderMaterial({
      uniforms: { uTex: { value: overTex }, uProgress: { value: 0 }, uWidth: { value: W }, uBack: { value: new THREE.Color('#efece4') } },
      vertexShader: CURL_VERT, fragmentShader: CURL_FRAG, side: THREE.DoubleSide,
    }));
  } else {
    const mat = new THREE.MeshBasicMaterial({ map: overTex ?? undefined, side: THREE.DoubleSide });
    over = new THREE.Mesh(geometry(false), mat);
    if (style() === 'hard') { over.geometry.translate(W / 2, 0, 0); over.position.x = -W / 2; }
    if (style() === 'flip_up') { over.geometry.translate(0, PLANE_H / 2, 0); over.position.y = -PLANE_H / 2; }
    if (style() === 'push' && under) under.position.x = W; // incoming page waits off-screen
  }
  scene.add(over);

  const start = performance.now();
  const dur = speedMs();
  applyState(dir > 0 ? 0 : 0, dir); // initial
  const tick = (now: number) => {
    const p = Math.min(1, (now - start) / dur);
    applyState(p, dir);
    if (p < 1) { requestAnimationFrame(tick); } else { void finish(target); }
  };
  requestAnimationFrame(tick);
}

let onTurnDone: (() => void) | null = null;
async function finish(target: number) {
  shownIndex = target;
  await buildStatic(target);
  busy = false;
  emit('pageChanged', target);
  const cb = onTurnDone; onTurnDone = null;
  cb?.();
}

function render() {
  applyKenBurns(performance.now());
  if (renderer && scene && camera) renderer.render(scene, camera);
  raf = requestAnimationFrame(render);
}

function fitCamera() {
  if (!camera || !host.value) return;
  const aspect = host.value.clientWidth / Math.max(1, host.value.clientHeight);
  const t = Math.tan((camera.fov * Math.PI) / 180 / 2);
  const distV = (PLANE_H / 2) / t;
  const distH = (planeW() / 2) / (t * aspect);
  camera.position.set(0, 0, Math.max(distV, distH) * 1.18);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

function onResize() {
  if (!renderer || !host.value) return;
  renderer.setSize(host.value.clientWidth, host.value.clientHeight);
  fitCamera();
}

/** Animated turn that resolves when the new page is fully shown (for export). */
function turnAndWait(dir: 1 | -1): Promise<void> {
  if (busy) return Promise.resolve();
  const target = Math.min(project.pages.length - 1, Math.max(0, shownIndex + dir));
  if (target === shownIndex) return Promise.resolve();
  return new Promise((res) => { onTurnDone = res; void turn(dir); });
}

/** Jump straight to a page (no animation) and resolve when it's rendered. */
async function jumpTo(index: number): Promise<void> {
  shownIndex = Math.min(project.pages.length - 1, Math.max(0, index));
  await buildStatic(shownIndex);
  emit('pageChanged', shownIndex);
}

/** The WebGL canvas (for captureStream) — null before mount. */
function canvasEl(): HTMLCanvasElement | null { return renderer?.domElement ?? null; }

/** Fixed export size (e.g. 1920×1280) at pixel-ratio 1; call resetSize() after. */
function setExportSize(w: number, h: number) {
  if (!renderer || !camera) return;
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  const t = Math.tan((camera.fov * Math.PI) / 180 / 2);
  const aspect = w / h;
  camera.position.set(0, 0, Math.max((PLANE_H / 2) / t, (planeW() / 2) / (t * aspect)) * 1.18);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}
function resetSize() {
  if (!renderer) return;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  onResize();
}

defineExpose({ next: () => turn(1), prev: () => turn(-1), turnAndWait, jumpTo, canvasEl, setExportSize, resetSize });

onMounted(async () => {
  if (!host.value) return;
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a0a14');
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  // preserveDrawingBuffer: true is REQUIRED for the video export — without it
  // WebGL clears the drawing buffer after each composite, so canvas.captureStream()
  // reads empty (black) frames even though the screen looks correct. The perf
  // cost is negligible for this small, gently-animated scene.
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  host.value.appendChild(renderer.domElement);
  onResize();
  shownIndex = props.pageIndex;
  await buildStatic(props.pageIndex);
  render();
  window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  window.removeEventListener('resize', onResize);
  disposeMesh(over); disposeMesh(under);
  renderer?.dispose();
});

// External page changes (e.g. jumping pages) rebuild the resting page.
watch(() => props.pageIndex, (i) => { if (!busy && i !== shownIndex) { shownIndex = i; void buildStatic(i); } });
</script>

<template>
  <div ref="host" class="w-full h-full" />
</template>
