// Our own trained buildings appear as examples. Visitors can close them site-wide for a clean view
// of their own models; the choice is remembered in this browser and can be undone.
const KEY = 'cw:hide-examples';

export function examplesHidden() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

function apply(hidden) { document.documentElement.toggleAttribute('data-hide-examples', hidden); }
apply(examplesHidden());

export function setExamplesHidden(hidden) {
  try { if (hidden) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch {}
  apply(hidden);
  dispatchEvent(new CustomEvent('cw:examples', {detail: {hidden}}));
}

// Adds the 示例 badge and a close button to an example card (a button or label).
export function markExample(card) {
  card.classList.add('is-example');
  if (card.querySelector('.example-badge')) return;
  const badge = Object.assign(document.createElement('span'), {className: 'example-badge', textContent: '示例'});
  const close = Object.assign(document.createElement('span'), {className: 'example-close', textContent: '×', title: '关闭全部示例', role: 'button', tabIndex: 0});
  close.setAttribute('aria-label', '关闭全部示例');
  const hide = event => { event.preventDefault(); event.stopPropagation(); setExamplesHidden(true); };
  close.addEventListener('click', hide);
  close.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') hide(event); });
  card.append(badge, close);
}

// A small "显示示例" control that appears only while examples are hidden.
export function restoreControl() {
  const button = Object.assign(document.createElement('button'), {type: 'button', className: 'examples-restore', textContent: '显示示例'});
  button.addEventListener('click', () => setExamplesHidden(false));
  return button;
}
