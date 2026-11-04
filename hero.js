// Home stage: building 4906981 as a rotating specimen. The reconstructed point cloud assembles
// bottom-up, two particle layers drift around it, and the view can be dragged, zoomed and spun.
import * as THREE from './vendor/three-0.170.0.module.min.js';

const VERTEX = `
uniform float uTime, uProgress, uScale;
attribute vec3 aStart;
attribute vec4 aColor;
attribute float aSize, aDelay;
varying vec4 vColor;
void main(){
  float t = clamp((uProgress - aDelay) / 0.5, 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  vec3 p = mix(aStart, position, t);
  p += (1.0 - t) * 0.08 * vec3(sin(uTime * 1.4 + aDelay * 40.0), cos(uTime * 1.2 + aDelay * 31.0), sin(uTime + aDelay * 17.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uScale * (0.7 + aSize * 1.5) / -mv.z;
  vColor = vec4(aColor.rgb, aColor.a * t);
}`;
const FRAGMENT = `
varying vec4 vColor;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * exp(-r2 * 2.2));
}`;
// Fine drifting particles in the template's olive (#566147).
const DUST_VERTEX = `
uniform float uTime, uScale;
attribute float aSeed;
varying float vSeed;
void main(){
  vec3 p = position + vec3(sin(uTime * 0.13 + aSeed * 9.0), cos(uTime * 0.09 + aSeed * 13.0) * 0.7, sin(uTime * 0.11 + aSeed * 5.0)) * 0.8;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uScale * (0.7 + fract(aSeed * 7.3) * 1.4) / -mv.z;
  vSeed = aSeed;
}`;
const DUST_FRAGMENT = `
varying float vSeed;
void main(){
  float r2 = dot(gl_PointCoord - 0.5, gl_PointCoord - 0.5) * 4.0;
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(0.337, 0.380, 0.278, (0.18 + 0.3 * fract(vSeed * 3.1)) * exp(-r2 * 2.5));
}`;

async function download(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw Error('point cloud unavailable');
  const total = Number(response.headers.get('content-length')) || 0, reader = response.body?.getReader();
  if (!reader) { const buffer = await response.arrayBuffer(); onProgress?.(1); return buffer; }
  const chunks = [];
  let got = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    if (total) onProgress?.(Math.min(got / total, 0.99));
  }
  const out = new Uint8Array(got);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  onProgress?.(1);
  return out.buffer;
}

function decode(buffer) {
  const view = new DataView(buffer);
  if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'CWPT') throw Error('bad point file');
  const count = view.getUint32(8, true), f = i => view.getFloat32(12 + i * 4, true);
  const lo = [f(0), f(1), f(2)], hi = [f(3), f(4), f(5)];
  const q = new Int16Array(buffer, 48, count * 3), rgba = new Uint8Array(buffer, 48 + count * 6, count * 4);
  const size = new Uint8Array(buffer, 48 + count * 10, count);
  const position = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) { const k = i % 3; position[i] = lo[k] + (q[i] + 32768) / 65535 * (hi[k] - lo[k]); }
  return {count, position, rgba, size, lo, hi};
}

// Point files come from scripts/build_hero_points.py (any .splat or 3DGS .ply).
function buildCloud({count, position, rgba, size, lo, hi}, material) {
  const color = new Float32Array(count * 4), start = new Float32Array(count * 3), delay = new Float32Array(count), sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) color[i * 4 + k] = Math.min(1, (rgba[i * 4 + k] / 255) * 0.92);
    color[i * 4 + 3] = 0.55 + (rgba[i * 4 + 3] / 255) * 0.45;
    sizes[i] = size[i] / 255;
    const y = (position[i * 3 + 1] - lo[1]) / (hi[1] - lo[1]);
    delay[i] = Math.min(0.5, y * 0.4 + Math.random() * 0.1);
    start[i * 3] = position[i * 3] + (Math.random() - 0.5) * 3;
    start[i * 3 + 1] = position[i * 3 + 1] + 4 + Math.random() * 5;
    start[i * 3 + 2] = position[i * 3 + 2] + (Math.random() - 0.5) * 3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aStart', new THREE.BufferAttribute(start, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(color, 4));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
  const points = new THREE.Points(geometry, material);
  points.position.set(-(lo[0] + hi[0]) / 2, -(lo[1] + (hi[1] - lo[1]) * 0.32), -(lo[2] + hi[2]) / 2);
  points.frustumCulled = false;
  return points;
}

// `cloud` (already decoded, e.g. from cloud-convert.js) is shown instead of downloading `url`.
export async function initHero(canvas, {url = 'assets/hero-points.bin', cloud, onReady, onProgress, onAngle} = {}) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({canvas, antialias: false, alpha: true, premultipliedAlpha: false, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setClearColor(0x000000, 0);
  const uniforms = {uTime: {value: 0}, uProgress: {value: reduce ? 1 : 0}, uScale: {value: 1}};
  const material = new THREE.ShaderMaterial({vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, transparent: true, depthWrite: false});
  const scene = new THREE.Scene();
  let points = null, radius = 1, born = null, loadSeq = 0, shown = '';
  const cache = new Map();
  // Swap in another cloud and replay the bottom-up assembly.
  function show(data, src) {
    shown = src;
    if (points) { scene.remove(points); points.geometry.dispose(); }
    points = buildCloud(data, material);
    scene.add(points);
    radius = Math.max(data.hi[0] - data.lo[0], data.hi[2] - data.lo[2]);
    born = null;
    if (!reduce) uniforms.uProgress.value = 0;
  }
  async function fetchCloud(src, progress) {
    if (!cache.has(src)) cache.set(src, download(src, progress).then(decode).catch(error => { cache.delete(src); throw error; }));
    else progress?.(1);
    return cache.get(src);
  }
  const data = cloud || await fetchCloud(url, onProgress);
  show(data, cloud ? 'inline' : url);
  const dustCount = 900, dustPos = new Float32Array(dustCount * 3), dustSeed = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 30; dustPos[i * 3 + 1] = (Math.random() - 0.35) * 14; dustPos[i * 3 + 2] = (Math.random() - 0.5) * 30; dustSeed[i] = Math.random();
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeometry.setAttribute('aSeed', new THREE.BufferAttribute(dustSeed, 1));
  const dustMaterial = new THREE.ShaderMaterial({vertexShader: DUST_VERTEX, fragmentShader: DUST_FRAGMENT, uniforms: {uTime: uniforms.uTime, uScale: uniforms.uScale}, transparent: true, depthWrite: false});
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  dust.frustumCulled = false;
  scene.add(dust);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 90);
  const view = {yaw: 0.6, pitch: 0.5, zoom: 1, auto: !reduce, tyaw: 0.6, tpitch: 0.5, tzoom: 1};
  const setZoom = z => { view.tzoom = Math.max(0.55, Math.min(1.8, z)); };
  const setPitch = p => { view.tpitch = Math.max(0.12, Math.min(1.25, p)); };
  // Auto-spin waits while any gesture is in progress and briefly after it ends.
  let drag = null, holdUntil = 0;
  const hold = () => { holdUntil = performance.now() + 1500; };
  const touches = new Map();
  const spread = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  canvas.addEventListener('pointerdown', e => {
    touches.set(e.pointerId, {x: e.clientX, y: e.clientY});
    canvas.setPointerCapture(e.pointerId);
    // A second finger on a touchscreen turns the drag into a pinch.
    drag = touches.size === 2 ? {pinch: spread(), zoom: view.tzoom} : {x: e.clientX, y: e.clientY, yaw: view.tyaw, pitch: view.tpitch};
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || !touches.has(e.pointerId)) return;
    touches.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (drag.pinch) { if (touches.size === 2) setZoom(drag.zoom * drag.pinch / spread()); return; }
    view.tyaw = drag.yaw - (e.clientX - drag.x) * 0.006;
    setPitch(drag.pitch + (e.clientY - drag.y) * 0.004);
  });
  const release = e => {
    touches.delete(e.pointerId);
    hold();
    const [rest] = touches.values();
    drag = rest ? {x: rest.x, y: rest.y, yaw: view.tyaw, pitch: view.tpitch} : null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  // Trackpads send many small pixel deltas (often fractional, often with deltaX); a mouse wheel
  // sends coarse vertical notches. A gesture keeps its classification until the stream pauses.
  let padUntil = 0;
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    hold();
    const now = performance.now(), scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
    const dx = e.deltaX * scale, dy = e.deltaY * scale;
    if (e.ctrlKey) { setZoom(view.tzoom * Math.exp(Math.max(-25, Math.min(25, dy)) * 0.01)); return; } // pinch on Chrome, Edge, Firefox
    const pad = now < padUntil || (e.deltaMode === 0 && (dx !== 0 || !Number.isInteger(dy) || Math.abs(dy) < 50));
    if (pad) {
      padUntil = now + 160;
      view.tyaw += dx * 0.004;
      setPitch(view.tpitch - dy * 0.003);
    } else setZoom(view.tzoom * (dy > 0 ? 1.08 : 0.93));
  }, {passive: false});
  // Safari reports trackpad pinch and two-finger rotation as gesture events instead of ctrl+wheel.
  let gesture = null;
  canvas.addEventListener('gesturestart', e => { e.preventDefault(); gesture = {zoom: view.tzoom, yaw: view.tyaw}; });
  canvas.addEventListener('gesturechange', e => {
    if (!gesture) return;
    e.preventDefault();
    hold();
    setZoom(gesture.zoom / e.scale);
    view.tyaw = gesture.yaw - e.rotation * Math.PI / 180;
  });
  canvas.addEventListener('gestureend', e => { e.preventDefault(); gesture = null; });
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    uniforms.uScale.value = h * renderer.getPixelRatio() * 0.034;
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  let visible = true, last = performance.now(), frame = 0;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(canvas);
  function tick(now) {
    frame = requestAnimationFrame(tick);
    if (!visible || document.hidden) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (born === null) born = now;
    uniforms.uTime.value += dt;
    if (!reduce) uniforms.uProgress.value = Math.min(1, (now - born) / 3200);
    if (view.auto && !drag && !gesture && now > holdUntil) view.tyaw += dt * 0.12;
    view.yaw += (view.tyaw - view.yaw) * 0.08; view.pitch += (view.tpitch - view.pitch) * 0.08; view.zoom += (view.tzoom - view.zoom) * 0.08;
    // Step back on tall, narrow stages (tablets, phones) so the whole building stays in frame.
    const dist = radius * 2.05 * view.zoom * Math.max(1, 0.95 / camera.aspect);
    camera.position.set(Math.sin(view.yaw) * Math.cos(view.pitch) * dist, Math.sin(view.pitch) * dist, Math.cos(view.yaw) * Math.cos(view.pitch) * dist);
    camera.lookAt(0, 0.15, 0);
    onAngle?.(((view.yaw * 180 / Math.PI) % 360 + 360) % 360);
    renderer.render(scene, camera);
  }
  frame = requestAnimationFrame(tick);
  onReady?.(data);
  return {
    zoom(f) { setZoom(view.tzoom * f); },
    rotate(deg) { view.tyaw += deg * Math.PI / 180; },
    toggleAuto() { view.auto = !view.auto; return view.auto; },
    reset() { view.tyaw = 0.6; view.tpitch = 0.5; view.tzoom = 1; },
    // Resolves true once the cloud is shown, false if a newer load replaced it first.
    async load(src, progress) {
      const seq = ++loadSeq;
      if (src === shown) { progress?.(1); return true; }
      const next = await fetchCloud(src, progress);
      if (seq !== loadSeq) return false;
      show(next, src);
      return true;
    },
    // Show a cloud built in the page (e.g. from an uploaded model); cancels pending loads.
    display(cloud, key) { loadSeq++; show(cloud, key); },
    dispose() { cancelAnimationFrame(frame); points?.geometry.dispose(); material.dispose(); dustGeometry.dispose(); dustMaterial.dispose(); renderer.dispose(); },
  };
}
