// Home: building tabs drive the specimen stage and the right-hand panel; visitors can add their own model.
import {initHero} from './hero.js?v=20261103-upload';
import {encode} from './cloud-convert.js?v=20261103-upload';

const $ = id => document.getElementById(id);
const ICON = {
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/>',
  trend: '<path d="M3.5 17l6-6 4 4 7-7"/><path d="M14.5 8h6v6"/>',
  layers: '<path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12.5l8.5 4.5 8.5-4.5"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  points: '<circle cx="6" cy="8" r="1.6"/><circle cx="15" cy="6" r="2"/><circle cx="11" cy="15" r="2.4"/><circle cx="18.5" cy="15.5" r="1.4"/>',
};
// Icon shows what a click switches to: the image, or back to the 3D point cloud.
const VIEW_ICON = {
  photo: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 15.5l5-4.5 4 3.5 3-2.5 5 4"/><circle cx="16" cy="9.2" r="1.6"/></svg>',
  cloud: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
};
// Three-seed means and paired bootstrap results from the technical report (table 1 and section 5.3).
// `points` is a file from scripts/build_hero_points.py; buildings without one show `photo` instead.
const BUILDINGS = {
  '4906981': {
    family: 'TUM2TWIN · Independent validation', tags: ['24 视角', 'CW-DepthGS', '+0.40 dB'],
    lede: 'TUM2TWIN公开数据中的一栋多层建筑，用于独立验证。仅用24张训练图像，CW-DepthGS的三种子平均PSNR较RGB-only提高0.3994 dB，配对Bootstrap 95%区间为[0.3048, 0.4953]。',
    metrics: [['target', 'PSNR', '19.8767 dB'], ['trend', 'ΔPSNR · 对RGB-only', '+0.3994 dB'], ['trend', 'ΔPSNR · 对固定深度', '+0.1175 dB'], ['layers', 'SSIM', '0.6385'], ['eye', 'LPIPS', '0.3681'], ['points', '完整模型高斯点', '3,383,214']],
    closeup: 'assets/cases/4906981/00012-render.png', points: 'assets/hero-points.bin',
  },
  '4959323': {
    family: 'TUM2TWIN · Method selection', tags: ['调参建筑', '24 视角', '+0.16 dB'],
    lede: '用于方法选型的调参建筑。CW-DepthGS较RGB-only提高0.1552 dB（95%区间[0.0544, 0.2543]），平均PSNR为21.19 dB，固定深度为21.26 dB。',
    metrics: [['target', 'PSNR', '21.1899 dB'], ['trend', 'ΔPSNR · 对RGB-only', '+0.1552 dB'], ['trend', 'ΔPSNR · 对固定深度', '−0.0717 dB'], ['layers', 'SSIM', '0.6643'], ['eye', 'LPIPS', '0.3366'], ['points', '局部校正P95', '6.53%']],
    photo: 'assets/cases/4959323/00008-render.png', points: 'assets/hero-points-4959323.bin', closeup: 'assets/cases/4959323/00010-render.png',
  },
  pilot: {
    family: 'TUM2TWIN · Independent validation', tags: ['验证建筑', '24 视角', '+0.21 dB'],
    lede: '第二栋独立验证建筑。CW-DepthGS较RGB-only提高0.2066 dB（95%区间[0.0206, 0.3853]）。其局部校正幅度P95为8.92%，超过8%阈值，诊断建议回退至鲁棒几何与跨视角路径。',
    metrics: [['target', 'PSNR', '19.6361 dB'], ['trend', 'ΔPSNR · 对RGB-only', '+0.2066 dB'], ['trend', 'ΔPSNR · 对固定深度', '+0.0993 dB'], ['layers', 'SSIM', '0.7395'], ['eye', 'LPIPS', '0.2395'], ['points', '局部校正P95', '8.92%']],
    photo: 'assets/cases/pilot/00006-render.png', points: 'assets/hero-points-pilot.bin', closeup: 'assets/cases/pilot/00012-render.png',
  },
};

let hero = null, heroFailed = false; // hero stays null while the first cloud loads
let preferPhoto = false; // set by the cloud/image toggle; applies to every building
function renderPanel({family, name, tags, lede, metrics}, animate, local) {
  $('b-family').textContent = family;
  $('b-name').textContent = name;
  $('b-tags').replaceChildren(...tags.map(t => Object.assign(document.createElement('span'), {className: 'tag', textContent: t})));
  $('b-lede').textContent = lede;
  $('b-traits').replaceChildren(...metrics.map(([ico, label, value]) => {
    const row = document.createElement('div');
    row.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[ico]}</svg><dt></dt><dd></dd>`;
    row.querySelector('dt').textContent = label;
    row.querySelector('dd').textContent = value;
    return row;
  }));
  $('b-local').hidden = !local;
  $('b-exp').hidden = $('b-closeup').hidden = !!local;
  document.querySelectorAll('.thumb').forEach(t => t.setAttribute('aria-pressed', String(local ? t.id === 'upload-model' : t.dataset.building === name)));
  if (animate) {
    const panel = $('panel');
    panel.animate([{opacity: 0, transform: 'translateX(18px)'}, {opacity: 1, transform: 'none'}], {duration: 520, easing: 'cubic-bezier(.2,.75,.2,1)'});
    $('b-name').animate([{opacity: 0, letterSpacing: '.08em'}, {opacity: 1, letterSpacing: '-.005em'}], {duration: 700, easing: 'cubic-bezier(.2,.75,.2,1)'});
  }
}

function fill(id, animate) {
  const b = BUILDINGS[id];
  document.body.dataset.building = id;
  showCloud(id);
  renderPanel({...b, name: id}, animate, false);
  $('b-closeup').querySelector('img').src = b.closeup;
  if (b.photo) $('specimen-photo').src = b.photo;
}

document.querySelectorAll('.thumb[data-building]').forEach(t => t.addEventListener('click', () => {
  const go = () => fill(t.dataset.building, !document.startViewTransition);
  // A quick second click skips the running transition; that rejection is expected.
  if (document.startViewTransition) document.startViewTransition(go).ready.catch(() => {}); else go();
}));
fill('4906981', false);

const note = $('load-note'), count = $('loader-count'), progress = f => { count.textContent = String(Math.round(f * 100)); };
// The stage shows the selected building's point cloud, or its render when there is none.
async function showCloud(id) {
  const {points, photo} = BUILDINGS[id], hasCloud = !!points && !heroFailed;
  document.body.dataset.cloud = hasCloud && !preferPhoto ? 'on' : 'off';
  syncViewToggle(hasCloud);
  if (!photo) $('specimen-photo').src = 'assets/cases/' + id + '/00007-render.png';
  if (preferPhoto) note.classList.add('done');
  if (!hasCloud || preferPhoto || !hero) return;
  $('hero-canvas').setAttribute('aria-label', '建筑' + id + '重建点云：拖动或双指滑动旋转，双指捏合或滚轮缩放');
  note.replaceChildren('Loading point cloud · ', count, '%');
  note.classList.remove('done');
  try { await hero.load(points, progress); } catch { if (document.body.dataset.building === id) document.body.dataset.cloud = 'off'; }
  if (document.body.dataset.building === id) note.classList.add('done');
}
// Both views exist only for the site's buildings; an uploaded model has no image to switch to.
function syncViewToggle(available) {
  const button = $('view-mode'), photo = available && preferPhoto, label = photo ? '切换为三维点云' : '切换为图片';
  button.disabled = !available;
  button.setAttribute('aria-pressed', String(photo));
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = photo ? VIEW_ICON.cloud : VIEW_ICON.photo;
}
$('view-mode').onclick = () => {
  if (document.body.dataset.building === 'local') return;
  preferPhoto = !preferPhoto;
  showCloud(document.body.dataset.building);
};
try {
  hero = await initHero($('hero-canvas'), {
    url: BUILDINGS['4906981'].points,
    onProgress: progress,
    onReady: () => note.classList.add('done'),
    onAngle: a => { $('angle').textContent = Math.round(a) + '°'; },
  });
  showCloud(document.body.dataset.building);
} catch (error) {
  heroFailed = true;
  syncViewToggle(false);
  note.textContent = '当前浏览器无法显示点云，已显示渲染图。';
  document.body.dataset.cloud = 'off';
  $('specimen-photo').src = 'assets/cases/4906981/00007-render.png';
}

// A visitor's .splat / 3DGS .ply is converted in a worker (same steps as scripts/build_hero_points.py)
// and shown on the stage; the converted cloud can be downloaded in the site's point-cloud format.
const upload = $('upload-model'), fileInput = $('model-file');
let worker = null, local = null, converting = false;
upload.disabled = !hero;
upload.onclick = () => { if (!converting) fileInput.click(); };
fileInput.onchange = () => { const file = fileInput.files[0]; fileInput.value = ''; if (file) convertLocal(file, false); };
$('local-flip').onclick = () => { if (local && !converting) convertLocal(null, !local.flip); };
$('local-download').onclick = () => {
  if (!local) return;
  const a = Object.assign(document.createElement('a'), {href: URL.createObjectURL(new Blob([encode(local.cloud)])), download: local.base + '-points.bin'});
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
};
function status(text, done) {
  note.textContent = text;
  note.classList.toggle('done', !!done);
}
function convertLocal(file, flip) {
  if (file && !/\.(splat|ply)$/i.test(file.name)) { status('请选择 .splat 或 3DGS 训练输出的 .ply 文件'); setTimeout(() => note.classList.add('done'), 4000); return; }
  if (file && file.size > 1536 * 1024 * 1024) { status('模型文件超过1.5 GB，请先导出较小的展示版本'); setTimeout(() => note.classList.add('done'), 4000); return; }
  worker ??= new Worker(new URL('./cloud-worker.js?v=20261103-upload', import.meta.url), {type: 'module'});
  converting = true;
  upload.disabled = $('local-flip').disabled = true;
  status(file ? '正在读取模型 · 0%' : '正在重新生成点云…');
  const meta = file ? {base: file.name.replace(/\.[^.]+$/, ''), ext: file.name.split('.').pop().toLowerCase(), bytes: file.size} : local;
  worker.onmessage = ({data}) => {
    if (data.progress !== undefined) { status(data.progress < 1 ? `正在读取模型 · ${Math.round(data.progress * 100)}%` : '正在生成点云…'); return; }
    converting = false;
    upload.disabled = $('local-flip').disabled = false;
    if (data.error) { status('无法生成点云：' + data.error); setTimeout(() => note.classList.add('done'), 5000); return; }
    local = {...meta, flip, cloud: data.cloud};
    showLocal();
    status('', true);
  };
  worker.postMessage({file, options: {flip}});
}
function showLocal() {
  const {cloud, base, ext, bytes} = local, {total, kept} = cloud.stats;
  document.body.dataset.building = 'local';
  document.body.dataset.cloud = 'on';
  syncViewToggle(false);
  hero.display(cloud, `local:${base}:${bytes}:${local.flip}`);
  $('hero-canvas').setAttribute('aria-label', base + '点云：拖动或双指滑动旋转，双指捏合或滚轮缩放');
  renderPanel({
    family: 'Local model · Browser conversion', name: base,
    tags: ['本地模型', '.' + ext, cloud.count.toLocaleString() + ' 点'],
    lede: `在本机浏览器中由模型生成的点云：筛除低透明度与离群高斯点，按不透明度抽样${cloud.count.toLocaleString()}点，并按地面方向自动摆正。拖动旋转查看；方向不对时点“上下翻转”。下载的点云文件可直接用于首页展示。`,
    metrics: [['points', '原始高斯点', total.toLocaleString()], ['layers', '有效高斯点', kept.toLocaleString()], ['target', '点云点数', cloud.count.toLocaleString()],
      ['eye', '文件大小', (bytes / 1024 / 1024).toFixed(1) + ' MB'], ['trend', '竖直方向', local.flip ? '已翻转' : '自动识别']],
  }, true, true);
}
$('z-in').onclick = () => hero?.zoom(0.85);
$('z-out').onclick = () => hero?.zoom(1.18);
$('rot-l').onclick = () => hero?.rotate(-45);
$('rot-r').onclick = () => hero?.rotate(45);
$('auto').onclick = () => { const on = hero?.toggleAuto(); $('auto').classList.toggle('on', !!on); $('auto').setAttribute('aria-pressed', String(!!on)); };
$('fs').onclick = () => { const stage = document.querySelector('.stage'); if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen?.(); };
