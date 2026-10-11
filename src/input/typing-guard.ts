/**
 * Keep game hotkeys out of text fields.
 *
 * The sim listens for keys on `window` (sticks on WASD/arrows, R reset, H hold, M mute, C camera, 1/2/3 modes,
 * U/F UI, ? help). Any of those typed into a name, email or code field must go to the field, not the game.
 *
 * `installTypingGuard()` adds ONE capture-phase listener, registered before every other handler, that stops
 * keyboard events whose target is editable from reaching the game listeners. Because it runs in the capture
 * phase on `window` and uses stopImmediatePropagation, no other window/document listener sees the event,
 * while the input element itself still receives it normally (the event continues down to the target).
 *
 * `isTypingTarget(e)` is the same test for code that wants to check explicitly.
 */
export function isTypingTarget(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || !(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    // Buttons, checkboxes and sliders are controls, not typing targets; everything else takes text.
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file'].includes(type);
  }
  return false;
}

export function installTypingGuard(onTyping?: () => void): void {
  const guard = (e: KeyboardEvent) => {
    if (!isTypingTarget(e)) return;
    // Escape is allowed through so panels can still be closed from inside a field.
    if (e.key === 'Escape') return;
    e.stopImmediatePropagation();
    onTyping?.();
  };
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    window.addEventListener(type, guard, { capture: true });
  }
}
