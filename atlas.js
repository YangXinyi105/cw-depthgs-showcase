// Shared page behaviour: quick search jump, local service status, title reveal and number count-up.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const routes = [
    [/首页|总览|主页|home|overview/i, 'index.html'],
    [/三维|模型|浏览|splat|viewer|3d/i, 'viewer.html'],
    [/复核|标注|照片|对照|review/i, 'review.html'],
    [/档案|项目|采集|版本|验收|交付|分析|ai|archive/i, 'archive.html'],
    [/研究|实验|消融|结果|方法|psnr|指标|research/i, 'research.html'],
  ];
  const search = document.querySelector('.search input');
  search?.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const hit = routes.find(([re]) => re.test(search.value.trim()));
    if (hit) location.href = hit[1]; else search.placeholder = '可输入：三维、复核、档案、研究';
    search.value = '';
  });
  const dot = document.querySelector('.icon-btn .dot');
  if (dot && location.protocol.startsWith('http')) {
    fetch('/api/health', {cache: 'no-store'}).then(r => r.ok ? r.json() : null).then(data => {
      if (data?.status === 'ok') { dot.classList.add('on'); dot.parentElement.title = '本机档案服务在线 · v' + data.version; }
    }).catch(() => { dot.parentElement.title = '未连接档案服务（静态展示模式）'; });
  }
  document.querySelectorAll('.split-title').forEach(node => {
    if (reduce) return;
    const text = node.textContent; node.textContent = '';
    [...text].forEach((ch, i) => { const s = document.createElement('span'); s.className = 'ch'; s.textContent = ch === ' ' ? ' ' : ch; s.style.animationDelay = (0.05 + i * 0.035) + 's'; node.append(s); });
  });
  window.atlasCount = root => (root || document).querySelectorAll('[data-count]').forEach(el => {
    const target = Number(el.dataset.count), dec = Number(el.dataset.decimals || 0), pre = el.dataset.prefix || '', suf = el.dataset.suffix || '';
    const fmt = v => pre + v.toLocaleString('en-US', {minimumFractionDigits: dec, maximumFractionDigits: dec}) + suf;
    if (reduce || !Number.isFinite(target)) { el.textContent = fmt(target); return; }
    const t0 = performance.now();
    const step = now => { const p = Math.min(1, (now - t0) / 1100); el.textContent = fmt(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
  window.atlasCount();
})();
