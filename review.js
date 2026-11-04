// 人工复核: coverflow picker over the archived test views (examples), the photos of the project opened in
// 项目档案, then the annotation tool in the review stage.
(() => {
  const $ = id => document.getElementById(id);
  const LABEL = {best_delta: '差值最好', median_delta: '差值中位', worst_delta: '差值最差'};
  const COVER = {all: 'assets/cases/4906981/00000-render.png', '4906981': 'assets/cases/4906981/00007-render.png', '4959323': 'assets/cases/4959323/00008-render.png', pilot: 'assets/cases/pilot/00006-render.png'};
  let cards = [], items = [], active = 0, filter = 'all', mode = 'pair', mounting = null;
  let link = null, project = null, collection = '', dirty = false;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const shown = () => items.filter(it => filter === 'all' || it.building.id === filter);
  document.body.dataset.state = 'pick';

  function layout() {
    const list = shown();
    if (!list.includes(items[active])) active = items.indexOf(list[0]);
    const pos = list.indexOf(items[active]);
    items.forEach((it, i) => {
      const card = cards[i], k = list.indexOf(it), d = k - pos, a = Math.abs(d);
      card.hidden = k < 0 || a > 3;
      card.classList.toggle('is-active', d === 0);
      card.style.setProperty('--x', (d * 36) + '%');
      card.style.setProperty('--z', (-a * 260) + 'px');
      card.style.setProperty('--ry', (d * -30) + 'deg');
      card.style.setProperty('--o', a > 2 ? 0 : 1 - a * 0.25);
      card.style.setProperty('--s', 1 - a * 0.35);
      card.style.zIndex = String(50 - a);
      card.tabIndex = d === 0 ? 0 : -1;
    });
    const {building, view} = items[active];
    const rule = LABEL[view.provenance?.selection] || '测试视角';
    $('pick-family').textContent = 'Test view · ' + rule;
    $('pick-view').textContent = view.id;
    $('pick-tags').replaceChildren(...['建筑 ' + building.id, building.trainingViews + ' 视角', building.iterations + ' 次迭代'].map(t => el('span', 'tag', t)));
    $('pick-select').textContent = rule;
    $('pick-size').textContent = view.width + ' × ' + view.height;
    $('pick-views').textContent = building.trainingViews + ' 张';
    $('pick-iter').textContent = building.iterations + ' 次';
    $('flow-count').textContent = String(pos + 1).padStart(2, '0') + ' / ' + String(list.length).padStart(2, '0');
  }
  function step(n) {
    const list = shown(), pos = list.indexOf(items[active]);
    active = items.indexOf(list[(pos + n + list.length) % list.length]);
    layout();
  }

  function workspaceReady() {
    return new Promise(resolve => {
      const root = $('workspace-root');
      const ready = () => root.dataset.wsReady === 'ready' && root.querySelector('.ws-comparison');
      if (ready()) return resolve(root);
      const obs = new MutationObserver(() => { if (ready()) { obs.disconnect(); resolve(root); } });
      obs.observe(root, {childList: true, subtree: true, attributes: true});
    });
  }
  // Move the tool's parts into the stage once; the tool keeps references to its own elements.
  function mountTool() {
    mounting ||= workspaceReady().then(root => {
      const [selects] = root.querySelectorAll(':scope > .ws-controls');
      $('tool-hidden').append(selects);
      $('stage-pair').append(root.querySelector(':scope > .ws-comparison'));
      $('stage-panel').append(...root.children);
      return root;
    });
    return mounting;
  }
  function choose(select, value) { select.value = value; select.dispatchEvent(new Event('change')); }
  const transition = fn => document.startViewTransition ? document.startViewTransition(fn) : fn();

  async function openReview() {
    const {building, view} = items[active];
    await mountTool();
    const [b, v] = $('tool-hidden').querySelectorAll('select');
    choose(b, building.id); choose(v, view.id);
    $('stage-title').textContent = building.name + ' · ' + view.label;
    $('slider-ref').src = view.reference; $('slider-render').src = view.render;
    const hero = cards[active].querySelector('img');
    hero.style.viewTransitionName = 'review-hero';
    const t = transition(() => {
      hero.style.viewTransitionName = '';
      document.body.dataset.state = 'review'; setMode(mode);
      const target = $('stage-pair').querySelector('img');
      if (target) target.style.viewTransitionName = 'review-hero';
    });
    t?.finished?.finally(() => { const target = $('stage-pair').querySelector('img'); if (target) target.style.viewTransitionName = ''; });
  }
  function syncSave() {
    $('save-project').textContent = dirty ? '保存标注到项目 •' : '保存标注到项目';
    if (dirty) $('save-state').textContent = '有尚未保存到项目的标注';
  }
  async function openProjectPhotos(trigger) {
    if (!project) return;
    const label = trigger.textContent;
    trigger.disabled = true;
    try {
      const detail = await link.projectDetail(project);
      const photos = detail.assets.filter(a => a.kind === 'photo');
      if (!photos.length) throw Error('项目「' + detail.project.name + '」还没有照片，可在项目档案中上传照片或从三维模型截图');
      if (trigger.tagName === 'BUTTON' && !trigger.classList.contains('thumb')) trigger.textContent = '正在读取 ' + photos.length + ' 张照片…';
      const blobs = await Promise.all(photos.map(a => link.assetBlob(project, a)));
      await mountTool();
      const notes = {};
      detail.annotations.forEach(n => (notes[n.asset_id] ||= []).push(n));
      collection = 'project-' + project.id; dirty = false;
      window.cwWorkspace.openCollection({id: collection, name: detail.project.name,
        source: '项目档案「' + detail.project.name + '」中的照片与视角截图，标注可保存回项目。',
        views: photos.map((a, i) => ({id: a.id, label: a.name, url: URL.createObjectURL(blobs[i])})), notes});
      $('save-state').textContent = link.canEditProject(project) ? '' : '只读分享链接：可查看标注，不能保存修改。';
      transition(() => { document.body.dataset.state = 'review'; setMode('pair'); });
    } catch (error) {
      alert(error.message);
    } finally {
      trigger.disabled = false;
      if (!trigger.classList.contains('thumb')) trigger.textContent = label;
    }
  }
  async function saveProject() {
    const button = $('save-project');
    button.disabled = true; $('save-state').textContent = '正在保存到项目…';
    try {
      const detail = await link.saveAnnotations(project, window.cwWorkspace.notesOf(collection));
      dirty = false; syncSave();
      $('save-state').textContent = '已保存到项目「' + detail.project.name + '」，档案版本 ' + detail.project.revision + '。';
    } catch (error) {
      $('save-state').textContent = '保存失败：' + (error instanceof TypeError ? '无法连接项目服务' : error.message);
    } finally { button.disabled = false; }
  }
  function closeReview() { transition(() => { document.body.dataset.state = 'pick'; layout(); }); }
  function setMode(next) {
    mode = next;
    $('stage-pair').hidden = mode !== 'pair';
    $('stage-slider').hidden = mode !== 'slider';
    document.querySelectorAll('#mode-switch button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  }

  async function init() {
    const manifest = await (await fetch('assets/cases/manifest.json', {cache: 'no-cache'})).json();
    manifest.buildings.forEach(building => building.views.forEach(view => items.push({building, view})));
    const flow = $('flow');
    cards = items.map((it, i) => {
      const card = el('button', 'flow-card');
      card.type = 'button';
      card.setAttribute('aria-label', it.building.name + ' ' + it.view.label);
      const ref = el('img'); ref.src = it.view.reference; ref.alt = '';
      const ren = el('img', 'render'); ren.src = it.view.render; ren.alt = '';
      card.append(ref, ren, el('span', 'badge b-tl', it.building.id), el('span', 'badge b-tr', LABEL[it.view.provenance?.selection] || ''),
        el('span', 'badge b-bl', 'View ' + it.view.id), el('span', 'badge b-br', 'CW-DepthGS 渲染'));
      card.addEventListener('click', () => { if (i === active) openReview(); else { active = i; layout(); } });
      flow.append(card);
      return card;
    });
    const seg = $('building-filter');
    [['all', '全部建筑', items.length + ' 个视角'], ...manifest.buildings.map(b => [b.id, b.id, b.views.length + ' 个视角'])].forEach(([id, name, sub]) => {
      const b = el('button', 'thumb'); b.type = 'button'; b.setAttribute('aria-pressed', String(id === 'all'));
      const img = el('img'); img.src = COVER[id] || COVER.all; img.alt = '';
      b.append(img, el('b', '', name), el('i', '', sub));
      b.addEventListener('click', () => { filter = id; seg.querySelectorAll('.thumb').forEach(x => x.setAttribute('aria-pressed', String(x === b))); layout(); });
      seg.append(b);
    });
    const [examples, projectLink] = await Promise.all([import('./examples.js?v=20261103-workflow'), import('./project-link.js?v=20261103-workflow')]);
    link = projectLink; project = link.currentProject();
    seg.querySelectorAll('.thumb').forEach(t => examples.markExample(t));
    if (project) {
      const card = el('button', 'thumb project-thumb'); card.type = 'button';
      card.innerHTML = '<span class="thumb-ico"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8h17v11.5h-17z"/><path d="M2.5 4.5h19V8h-19z"/><path d="M9.5 12h5"/></svg></span>';
      card.append(el('b', '', '当前项目'), el('i', '', project.name || '项目照片'));
      card.title = '打开项目「' + (project.name || '') + '」的照片与视角截图';
      card.addEventListener('click', () => openProjectPhotos(card));
      seg.append(card);
    }
    seg.append(examples.restoreControl());
    // With examples closed, the picker becomes a start screen for project or local photos.
    const start = el('div', 'picker-empty when-no-examples');
    start.append(el('p', '', project ? '打开项目「' + project.name + '」的照片和视角截图，在图上标注问题并保存回项目。' : '在项目档案中打开一个项目后，这里可直接打开它的照片；也可以选择本机现场照片。'));
    const actions = el('div', 'pick-actions');
    if (project) { const open = el('button', 'btn btn-primary', '打开项目照片'); open.type = 'button'; open.onclick = () => openProjectPhotos(open); actions.append(open); }
    const local = el('button', 'btn', '选择本地现场照片'); local.type = 'button';
    local.onclick = async () => { await mountTool(); $('stage-panel').querySelector('input[type=file][multiple]')?.click(); };
    actions.append(local); start.append(actions);
    $('flow').before(start);
    [$('flow'), document.querySelector('.flow-nav'), document.querySelector('.picker .caption'), document.querySelector('.pick-panel')].forEach(n => n?.classList.add('is-example'));
    const intro = el('div', 'pick-panel when-no-examples');
    intro.append(el('p', 'caps', 'Photo review'), el('h1', '', '照片复核'), el('p', 'lede', '打开项目档案中的照片或三维模型截图，在图上标注需要补拍或重建的位置，标注直接保存回项目；也可以选择本机现场照片，标注保存在当前浏览器。'));
    $('stage-panel').before(intro);
    active = Math.max(0, items.findIndex(it => it.building.id === '4906981' && it.view.id === '00007'));
    layout();
    $('prev').onclick = () => step(-1); $('next').onclick = () => step(1);
    $('start').onclick = openReview; $('back').onclick = closeReview;
    $('peek').onclick = () => cards[active].classList.toggle('peek');
    document.querySelectorAll('#mode-switch button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
    addEventListener('keydown', e => {
      if (document.body.dataset.state !== 'pick' || e.target.closest('input,textarea,select')) return;
      if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1);
    });
    let wheelLock = 0;
    flow.addEventListener('wheel', e => { e.preventDefault(); const now = Date.now(); if (now - wheelLock < 420) return; wheelLock = now; step((e.deltaY || e.deltaX) > 0 ? 1 : -1); }, {passive: false});
    const slider = $('stage-slider').querySelector('input');
    slider.addEventListener('input', () => $('stage-slider').style.setProperty('--split', slider.value + '%'));
    // Keep the stage in step with the tool, e.g. after local site photos are opened from the side panel.
    $('workspace-root').addEventListener('ws:view', e => {
      const {building, view} = e.detail;
      $('stage-title').textContent = building.name + ' · ' + view.label;
      $('slider-ref').src = view.reference; $('slider-render').src = view.render;
      const sliderMode = document.querySelector('#mode-switch [data-mode="slider"]');
      sliderMode.disabled = !!building.local;
      sliderMode.title = building.local ? '现场照片没有对应的重建渲染，仅支持并排标注' : '';
      if (building.local && mode === 'slider') setMode('pair');
      // Local photos picked from the start screen open straight into the review stage.
      if (building.local && document.body.dataset.state === 'pick') transition(() => { document.body.dataset.state = 'review'; setMode('pair'); });
      $('save-project').hidden = building.id !== collection || !link?.canEditProject(project);
      syncSave();
    });
    $('workspace-root').addEventListener('ws:notes', e => { if (e.detail.building === collection) { dirty = true; syncSave(); } });
    $('save-project').onclick = saveProject;
    addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
    mountTool();
  }
  init().catch(error => { $('flow').textContent = '案例清单加载失败：' + error.message; });
})();
