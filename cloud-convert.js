// In-browser twin of scripts/build_hero_points.py: turns a .splat or trained 3DGS .ply into the
// point cloud the home stage renders. Pure functions, so it runs in a worker or under Node.
const SH_C0 = 0.28209479177387814;
const CHUNK = 64 * 1024 * 1024;
const SAMPLE = 200000;

// Reads only what the cloud needs (position, size, colour, opacity), in chunks, so a large
// .ply never sits in memory as one buffer.
export async function readGaussians(file, name, onProgress) {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'splat') return readSplat(file, onProgress);
  if (ext === 'ply') return readPly(file, onProgress);
  throw Error('请选择 .splat 或 3DGS 训练输出的 .ply 文件');
}

function allocate(count) {
  return {count, position: new Float32Array(count * 3), size: new Float32Array(count), rgb: new Uint8Array(count * 3), alpha: new Float32Array(count)};
}

async function readSplat(file, onProgress) {
  if (!file.size || file.size % 32) throw Error('.splat 文件应由完整的32字节记录组成');
  const g = allocate(file.size / 32);
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    const view = new DataView(await file.slice(offset, Math.min(file.size, offset + CHUNK)).arrayBuffer());
    const first = offset / 32, n = view.byteLength / 32;
    for (let r = 0; r < n; r++) {
      const b = r * 32, i = first + r;
      for (let k = 0; k < 3; k++) g.position[i * 3 + k] = view.getFloat32(b + k * 4, true);
      g.size[i] = Math.cbrt(view.getFloat32(b + 12, true) * view.getFloat32(b + 16, true) * view.getFloat32(b + 20, true));
      for (let k = 0; k < 3; k++) g.rgb[i * 3 + k] = view.getUint8(b + 24 + k);
      g.alpha[i] = view.getUint8(b + 27) / 255;
    }
    onProgress?.(Math.min(1, (offset + view.byteLength) / file.size));
  }
  return g;
}

async function readPly(file, onProgress) {
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 65536)).arrayBuffer());
  const text = new TextDecoder('latin1').decode(head), end = text.indexOf('end_header');
  if (!text.startsWith('ply') || end < 0) throw Error('不是有效的 .ply 文件');
  const dataStart = text.indexOf('\n', end) + 1, props = [];
  let count = 0, format = '';
  for (const line of text.slice(0, end).split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    if (f[0] === 'format') format = f[1];
    if (f[0] === 'element' && f[1] === 'vertex') count = Number(f[2]);
    if (f[0] === 'property') { if (f[1] !== 'float') throw Error('.ply 需为 float32 的3DGS高斯属性'); props.push(f[2]); }
  }
  const at = name => { const i = props.indexOf(name); if (i < 0) throw Error('.ply 缺少3DGS属性 ' + name); return i * 4; };
  if (format !== 'binary_little_endian' || !count) throw Error('.ply 需为 binary_little_endian 格式');
  const stride = props.length * 4;
  if (file.size < dataStart + count * stride) throw Error('.ply 文件不完整');
  const xyz = ['x', 'y', 'z'].map(at), sc = [0, 1, 2].map(i => at('scale_' + i)), dc = [0, 1, 2].map(i => at('f_dc_' + i)), op = at('opacity');
  const g = allocate(count), per = Math.max(1, Math.floor(CHUNK / stride));
  for (let first = 0; first < count; first += per) {
    const n = Math.min(per, count - first), start = dataStart + first * stride;
    const view = new DataView(await file.slice(start, start + n * stride).arrayBuffer());
    for (let r = 0; r < n; r++) {
      const b = r * stride, i = first + r;
      for (let k = 0; k < 3; k++) {
        g.position[i * 3 + k] = view.getFloat32(b + xyz[k], true);
        g.rgb[i * 3 + k] = Math.max(0, Math.min(255, Math.round((0.5 + SH_C0 * view.getFloat32(b + dc[k], true)) * 255)));
      }
      g.size[i] = Math.exp((view.getFloat32(b + sc[0], true) + view.getFloat32(b + sc[1], true) + view.getFloat32(b + sc[2], true)) / 3);
      g.alpha[i] = 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, view.getFloat32(b + op, true)))));
    }
    onProgress?.((first + n) / count);
  }
  return g;
}

// Linear-interpolated percentiles (numpy's default) over an evenly strided sample.
function quantiles(idx, value, qs) {
  const step = Math.max(1, Math.floor(idx.length / SAMPLE)), s = new Float64Array(Math.ceil(idx.length / step));
  for (let i = 0, j = 0; i < idx.length; i += step) s[j++] = value(idx[i]);
  s.sort();
  return qs.map(q => { const p = (s.length - 1) * q / 100, lo = Math.floor(p); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (p - lo); });
}

function filter(idx, keep) {
  const out = new Uint32Array(idx.length);
  let n = 0;
  for (const i of idx) if (keep(i)) out[n++] = i;
  return out.subarray(0, n);
}

// Eigen-decomposition of a symmetric 3x3 matrix (Jacobi); columns of the result, ascending.
function eigen3(a) {
  const m = a.map(r => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) off += m[p][q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(m[p][q]) < 1e-30) continue;
      const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]), t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const kp = m[k][p], kq = m[k][q]; m[k][p] = c * kp - s * kq; m[k][q] = s * kp + c * kq; }
      for (let k = 0; k < 3; k++) { const pk = m[p][k], qk = m[q][k]; m[p][k] = c * pk - s * qk; m[q][k] = s * pk + c * qk; }
      for (let k = 0; k < 3; k++) { const kp = v[k][p], kq = v[k][q]; v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq; }
    }
  }
  return [0, 1, 2].map(i => ({value: m[i][i], vector: [v[0][i], v[1][i], v[2][i]]})).sort((x, y) => x.value - y.value);
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const n = Math.hypot(...a); return a.map(x => x / n); };

function mulberry32(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// Same steps and defaults as the Python script; `flip` turns the detected up axis over.
export function convert(g, {points = 160000, minAlpha = 0.08, extent = 9, flip = false, seed = 0} = {}) {
  const P = g.position;
  let idx = new Uint32Array(g.count).map((_, i) => i);
  idx = filter(idx, i => Number.isFinite(P[i * 3]) && Number.isFinite(P[i * 3 + 1]) && Number.isFinite(P[i * 3 + 2])
    && Number.isFinite(g.size[i]) && g.size[i] > 0 && g.alpha[i] >= minAlpha);
  if (idx.length < 1000) throw Error('可见高斯点不足1000个，无法生成点云');
  const [maxSize] = quantiles(idx, i => g.size[i], [99.5]);
  idx = filter(idx, i => g.size[i] <= maxSize);
  // Floaters sit far outside the scene; trim each axis to its 1st-99th percentile band.
  const band = [0, 1, 2].map(k => { const [lo, hi] = quantiles(idx, i => P[i * 3 + k], [1, 99]), m = (hi - lo) * 0.03; return [lo - m, hi + m]; });
  idx = filter(idx, i => band.every(([lo, hi], k) => P[i * 3 + k] >= lo && P[i * 3 + k] <= hi));
  if (idx.length < 1000) throw Error('筛除离群点后剩余点数不足，无法生成点云');

  const centre = [0, 1, 2].map(k => quantiles(idx, i => P[i * 3 + k], [50])[0]);
  const step = Math.max(1, Math.floor(idx.length / SAMPLE)), mean = [0, 0, 0], cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let n = 0;
  for (let j = 0; j < idx.length; j += step, n++) for (let k = 0; k < 3; k++) mean[k] += P[idx[j] * 3 + k];
  mean.forEach((_, k) => { mean[k] /= n; });
  for (let j = 0; j < idx.length; j += step) {
    const d = [0, 1, 2].map(k => P[idx[j] * 3 + k] - mean[k]);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] += d[a] * d[b] / (n - 1);
  }
  const axes = eigen3(cov).map(e => e.vector);
  const rel = (i, axis) => (P[i * 3] - centre[0]) * axis[0] + (P[i * 3 + 1] - centre[1]) * axis[1] + (P[i * 3 + 2] - centre[2]) * axis[2];
  // Up is the flattest axis, pointing away from the wider (ground) slab.
  let up = axes[0];
  const [h15, h85] = quantiles(idx, i => rel(i, up), [15, 85]);
  const footprint = slab => {
    const [a5, a95] = quantiles(slab, i => rel(i, axes[1]), [5, 95]), [b5, b95] = quantiles(slab, i => rel(i, axes[2]), [5, 95]);
    return (a95 - a5) * (b95 - b5);
  };
  if (footprint(filter(idx, i => rel(i, up) > h85)) > footprint(filter(idx, i => rel(i, up) < h15))) up = up.map(x => -x);
  if (flip) up = up.map(x => -x);
  let right = unit(axes[2].map((x, k) => x - dot(axes[2], up) * up[k]));
  // Eigenvector signs are arbitrary; pin one so a model always faces the same way.
  if (right[right.map(Math.abs).indexOf(Math.max(...right.map(Math.abs)))] < 0) right = right.map(x => -x);
  const forward = cross(right, up);

  const local = i => [rel(i, right), rel(i, up), rel(i, forward)];
  const [x1, x99] = quantiles(idx, i => rel(i, right), [1, 99]), [z1, z99] = quantiles(idx, i => rel(i, forward), [1, 99]);
  const scale = extent / Math.max(x99 - x1, z99 - z1);
  const [y1] = quantiles(idx, i => rel(i, up), [1]), [xm] = quantiles(idx, i => rel(i, right), [50]), [zm] = quantiles(idx, i => rel(i, forward), [50]);

  // Weighted sampling without replacement by opacity (Efraimidis-Spirakis keys).
  const random = mulberry32(seed), keys = new Float32Array(idx.length);
  for (let j = 0; j < idx.length; j++) keys[j] = -Math.log(1 - random()) / g.alpha[idx[j]];
  const count = Math.min(points, idx.length), threshold = keys.slice().sort()[count - 1];
  const picked = filter(new Uint32Array(idx.length).map((_, j) => j), j => keys[j] <= threshold).subarray(0, count);

  const position = new Float32Array(count * 3), rgba = new Uint8Array(count * 4), size = new Uint8Array(count);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  picked.forEach((j, o) => {
    const i = idx[j], p = local(i);
    p[0] = (p[0] - xm) * scale; p[1] = (p[1] - y1) * scale; p[2] = (p[2] - zm) * scale;
    for (let k = 0; k < 3; k++) { position[o * 3 + k] = p[k]; lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); rgba[o * 4 + k] = g.rgb[i * 3 + k]; }
    rgba[o * 4 + 3] = Math.max(1, Math.min(255, Math.round(g.alpha[i] * 255)));
  });
  const order = Array.from(picked.keys()).sort((a, b) => g.size[idx[picked[a]]] - g.size[idx[picked[b]]]);
  order.forEach((o, rank) => { size[o] = Math.round(rank / Math.max(count - 1, 1) * 255); });
  return {count, position, rgba, size, lo, hi, stats: {total: g.count, kept: idx.length, scale, up}};
}

// CWPT layout shared with the Python script, so a browser conversion can be published as-is.
export function encode({count, position, rgba, size, lo, hi, stats}) {
  const buffer = new ArrayBuffer(48 + count * 11), view = new DataView(buffer);
  [67, 87, 80, 84].forEach((c, i) => view.setUint8(i, c));
  view.setUint32(4, 1, true); view.setUint32(8, count, true);
  [...lo, ...hi].forEach((v, i) => view.setFloat32(12 + i * 4, v, true));
  view.setFloat32(36, stats?.scale ?? 1, true);
  const q = new Int16Array(buffer, 48, count * 3);
  for (let i = 0; i < count * 3; i++) {
    const k = i % 3, span = hi[k] > lo[k] ? hi[k] - lo[k] : 1;
    q[i] = Math.max(-32768, Math.min(32767, Math.round((position[i] - lo[k]) / span * 65535 - 32768)));
  }
  new Uint8Array(buffer, 48 + count * 6, count * 4).set(rgba);
  new Uint8Array(buffer, 48 + count * 10, count).set(size);
  return buffer;
}
