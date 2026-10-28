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
  if (!reader || !total) { onProgress?.(1); return response.arrayBuffer(); }
  const out = new Uint8Array(total);
  for (let got = 0; ;) { const {done, value} = await reader.read(); if (done) break; out.set(value, got); got += value.length; onProgress?.(got / total); }
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

export async function initHero(canvas, {onReady, onProgress, onAngle} = {}) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({canvas, antialias: false, alpha: true, premultipliedAlpha: false, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setClearColor(0x000000, 0);
  const data = decode(await download('assets/hero-points.bin', onProgress));
  const {count, position, rgba, size, lo, hi} = data;
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
  const uniforms = {uTime: {value: 0}, uProgress: {value: reduce ? 1 : 0}, uScale: {value: 1}};
  const material = new THREE.ShaderMaterial({vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, transparent: true, depthWrite: false});
  const points = new THREE.Points(geometry, material);
  const centre = [(lo[0] + hi[0]) / 2, lo[1] + (hi[1] - lo[1]) * 0.32, (lo[2] + hi[2]) / 2];
  points.position.set(-centre[0], -centre[1], -centre[2]);
  points.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(points);
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
  const radius = Math.max(hi[0] - lo[0], hi[2] - lo[2]);
  const view = {yaw: 0.6, pitch: 0.5, zoom: 1, auto: !reduce, tyaw: 0.6, tpitch: 0.5, tzoom: 1};
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = {x: e.clientX, y: e.clientY, yaw: view.tyaw, pitch: view.tpitch}; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    view.tyaw = drag.yaw - (e.clientX - drag.x) * 0.006;
    view.tpitch = Math.max(0.12, Math.min(1.25, drag.pitch + (e.clientY - drag.y) * 0.004));
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); view.tzoom = Math.max(0.55, Math.min(1.8, view.tzoom * (e.deltaY > 0 ? 1.08 : 0.93))); }, {passive: false});
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

  let visible = true, last = performance.now(), born = null, frame = 0;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(canvas);
  function tick(now) {
    frame = requestAnimationFrame(tick);
    if (!visible || document.hidden) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (born === null) born = now;
    uniforms.uTime.value += dt;
    if (!reduce) uniforms.uProgress.value = Math.min(1, (now - born) / 3200);
    if (view.auto && !drag) view.tyaw += dt * 0.12;
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
    zoom(f) { view.tzoom = Math.max(0.55, Math.min(1.8, view.tzoom * f)); },
    rotate(deg) { view.tyaw += deg * Math.PI / 180; },
    toggleAuto() { view.auto = !view.auto; return view.auto; },
    reset() { view.tyaw = 0.6; view.tpitch = 0.5; view.tzoom = 1; },
    dispose() { cancelAnimationFrame(frame); geometry.dispose(); material.dispose(); dustGeometry.dispose(); dustMaterial.dispose(); renderer.dispose(); },
  };
}
