// Home: building tabs drive the specimen stage and the right-hand panel.
import {initHero} from './hero.js?v=20261027-atlas';

const $ = id => document.getElementById(id);
const ICON = {
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/>',
  trend: '<path d="M3.5 17l6-6 4 4 7-7"/><path d="M14.5 8h6v6"/>',
  layers: '<path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12.5l8.5 4.5 8.5-4.5"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  points: '<circle cx="6" cy="8" r="1.6"/><circle cx="15" cy="6" r="2"/><circle cx="11" cy="15" r="2.4"/><circle cx="18.5" cy="15.5" r="1.4"/>',
};
// Three-seed means and paired bootstrap results from the technical report (table 1 and section 5.3).
const BUILDINGS = {
  '4906981': {
    family: 'TUM2TWIN · Independent validation', tags: ['24 视角', 'CW-DepthGS', '+0.40 dB'],
    lede: 'TUM2TWIN公开数据中的一栋多层建筑，用于独立验证。仅用24张训练图像，CW-DepthGS的三种子平均PSNR较RGB-only提高0.3994 dB，配对Bootstrap 95%区间为[0.3048, 0.4953]。',
    metrics: [['target', 'PSNR', '19.8767 dB'], ['trend', 'ΔPSNR · 对RGB-only', '+0.3994 dB'], ['trend', 'ΔPSNR · 对固定深度', '+0.1175 dB'], ['layers', 'SSIM', '0.6385'], ['eye', 'LPIPS', '0.3681'], ['points', '完整模型高斯点', '3,383,214']],
    closeup: 'assets/cases/4906981/00012-render.png',
  },
  '4959323': {
    family: 'TUM2TWIN · Method selection', tags: ['调参建筑', '24 视角', '+0.16 dB'],
    lede: '用于方法选型的调参建筑。CW-DepthGS较RGB-only提高0.1552 dB（95%区间[0.0544, 0.2543]），但平均PSNR仍略低于固定深度（21.19 对 21.26 dB），说明增强模块的收益随场景变化。',
    metrics: [['target', 'PSNR', '21.1899 dB'], ['trend', 'ΔPSNR · 对RGB-only', '+0.1552 dB'], ['trend', 'ΔPSNR · 对固定深度', '−0.0717 dB'], ['layers', 'SSIM', '0.6643'], ['eye', 'LPIPS', '0.3366'], ['points', '局部校正P95', '6.53%']],
    photo: 'assets/cases/4959323/00008-render.png', closeup: 'assets/cases/4959323/00010-render.png',
  },
  pilot: {
    family: 'TUM2TWIN · Independent validation', tags: ['验证建筑', '24 视角', '+0.21 dB'],
    lede: '第二栋独立验证建筑。CW-DepthGS较RGB-only提高0.2066 dB（95%区间[0.0206, 0.3853]）。其局部校正幅度P95为8.92%，超过8%阈值，诊断建议回退至鲁棒几何与跨视角路径。',
    metrics: [['target', 'PSNR', '19.6361 dB'], ['trend', 'ΔPSNR · 对RGB-only', '+0.2066 dB'], ['trend', 'ΔPSNR · 对固定深度', '+0.0993 dB'], ['layers', 'SSIM', '0.7395'], ['eye', 'LPIPS', '0.2395'], ['points', '局部校正P95', '8.92%']],
    photo: 'assets/cases/pilot/00006-render.png', closeup: 'assets/cases/pilot/00012-render.png',
  },
};

function fill(id, animate) {
  const b = BUILDINGS[id];
  document.body.dataset.building = id;
  $('b-family').textContent = b.family;
  $('b-name').textContent = id;
  $('b-tags').replaceChildren(...b.tags.map(t => Object.assign(document.createElement('span'), {className: 'tag', textContent: t})));
  $('b-lede').textContent = b.lede;
  $('b-traits').innerHTML = b.metrics.map(([ico, label, value]) =>
    `<div><svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[ico]}</svg><dt>${label}</dt><dd>${value}</dd></div>`).join('');
  $('b-closeup').querySelector('img').src = b.closeup;
  if (b.photo) $('specimen-photo').src = b.photo;
  document.querySelectorAll('.thumb').forEach(t => t.setAttribute('aria-pressed', String(t.dataset.building === id)));
  if (animate) {
    const panel = $('panel');
    panel.animate([{opacity: 0, transform: 'translateX(18px)'}, {opacity: 1, transform: 'none'}], {duration: 520, easing: 'cubic-bezier(.2,.75,.2,1)'});
    $('b-name').animate([{opacity: 0, letterSpacing: '.08em'}, {opacity: 1, letterSpacing: '-.005em'}], {duration: 700, easing: 'cubic-bezier(.2,.75,.2,1)'});
  }
}

document.querySelectorAll('.thumb').forEach(t => t.addEventListener('click', () => {
  const go = () => fill(t.dataset.building, !document.startViewTransition);
  if (document.startViewTransition) document.startViewTransition(go); else go();
}));
fill('4906981', false);

const note = $('load-note'), count = $('loader-count');
let hero = null;
try {
  hero = await initHero($('hero-canvas'), {
    onProgress: f => { count.textContent = String(Math.round(f * 100)); },
    onReady: () => note.classList.add('done'),
    onAngle: a => { $('angle').textContent = Math.round(a) + '°'; },
  });
} catch (error) {
  note.textContent = '当前浏览器无法显示点云，已显示渲染图。';
  document.body.dataset.building = 'pilot';
  $('specimen-photo').src = 'assets/cases/4906981/00007-render.png';
}
$('z-in').onclick = () => hero?.zoom(0.85);
$('z-out').onclick = () => hero?.zoom(1.18);
$('rot-l').onclick = () => hero?.rotate(-45);
$('rot-r').onclick = () => hero?.rotate(45);
$('auto').onclick = () => { const on = hero?.toggleAuto(); $('auto').classList.toggle('on', !!on); $('auto').setAttribute('aria-pressed', String(!!on)); };
$('fs').onclick = () => { const stage = document.querySelector('.stage'); if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen?.(); };
