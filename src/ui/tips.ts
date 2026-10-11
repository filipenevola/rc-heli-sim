/**
 * Mini help for icon buttons. Desktop: hover shows the tip (and the native title stays as a fallback).
 * Touch: long-press (0.5 s) shows the tip and swallows the click, so the button's action does not fire.
 * Any element with a `data-tip` attribute inside the container gets this.
 */
export function attachTips(container: HTMLElement): void {
  const bubble = document.createElement('div');
  bubble.className = 'tip-bubble';
  bubble.style.display = 'none';
  document.body.appendChild(bubble);

  let hoverTimer: number | null = null;
  let pressTimer: number | null = null;
  let suppressClick = false;

  const show = (el: HTMLElement) => {
    const tip = el.dataset.tip;
    if (!tip) return;
    bubble.textContent = tip;
    bubble.style.display = '';
    const r = el.getBoundingClientRect();
    bubble.style.left = `${Math.max(8, Math.min(window.innerWidth - bubble.offsetWidth - 8, r.left))}px`;
    bubble.style.top = `${r.bottom + 8}px`;
  };
  const hide = () => {
    bubble.style.display = 'none';
  };
  const target = (e: Event) => (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]') ?? null;

  container.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = target(e);
    if (!el) return;
    hoverTimer = window.setTimeout(() => show(el), 400);
  }, true);
  container.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
    hide();
  }, true);
  container.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const el = target(e);
    if (!el) return;
    suppressClick = false;
    pressTimer = window.setTimeout(() => {
      suppressClick = true;
      show(el);
    }, 500);
  }, true);
  const endPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    if (suppressClick) window.setTimeout(hide, 2500);
  };
  container.addEventListener('pointerup', endPress, true);
  container.addEventListener('pointercancel', endPress, true);
  container.addEventListener('click', (e) => {
    if (suppressClick) {
      e.stopImmediatePropagation();
      e.preventDefault();
      suppressClick = false;
    }
  }, true);
  window.addEventListener('pointerdown', (e) => {
    if (!target(e)) hide();
  }, true);
}
