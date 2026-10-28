// 研究结果: chapter tabs, previous/next, arrow keys and wheel switch one slide at a time.
(() => {
  const slides = [...document.querySelectorAll('.slide')];
  const thumbs = [...document.querySelectorAll('.research-page .thumb')];
  const count = document.getElementById('slide-count');
  let index = Math.max(0, slides.findIndex(s => s.dataset.slide === location.hash.slice(1)));

  function show(next, animate = true, remember = true) {
    next = (next + slides.length) % slides.length;
    const dir = next > index ? 'next' : 'prev';
    const swap = () => {
      slides.forEach((s, i) => { s.hidden = i !== next; });
      thumbs.forEach((t, i) => t.setAttribute('aria-pressed', String(i === next)));
      count.textContent = String(next + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
      slides[next].scrollTop = 0;
      index = next;
      // Writing the hash while the page is still loading makes the browser jump to that section on narrow screens.
      if (remember) history.replaceState(null, '', '#' + slides[next].dataset.slide);
    };
    document.documentElement.dataset.dir = dir;
    if (animate && document.startViewTransition && next !== index) document.startViewTransition(swap); else swap();
  }
  thumbs.forEach((t, i) => t.addEventListener('click', () => show(i)));
  document.getElementById('slide-prev').onclick = () => show(index - 1);
  document.getElementById('slide-next').onclick = () => show(index + 1);
  addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') show(index + 1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') show(index - 1);
  });
  // Wheel turns the page only when the current slide is scrolled to its edge.
  let lock = 0;
  document.querySelector('.slides').addEventListener('wheel', e => {
    const s = slides[index], atEnd = s.scrollTop + s.clientHeight >= s.scrollHeight - 2, atTop = s.scrollTop <= 0;
    if ((e.deltaY > 0 && !atEnd) || (e.deltaY < 0 && !atTop)) return;
    e.preventDefault();
    if (Date.now() - lock < 700) return;
    lock = Date.now();
    show(index + (e.deltaY > 0 ? 1 : -1));
  }, {passive: false});
  show(index, false, false);
})();
