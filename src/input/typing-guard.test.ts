// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { installTypingGuard, isTypingTarget } from './typing-guard';

describe('typing guard', () => {
  it('stops game key listeners while typing in a field, but not elsewhere', () => {
    const onTyping = vi.fn();
    installTypingGuard(onTyping);
    const game = vi.fn();
    window.addEventListener('keydown', game);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true }));
    expect(game).not.toHaveBeenCalled();
    expect(onTyping).toHaveBeenCalled();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true }));
    expect(game).toHaveBeenCalledTimes(1);
    // Escape still reaches the game so panels can close from inside a field.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    expect(game).toHaveBeenCalledTimes(2);
  });

  it('treats text-like inputs, textareas, selects and contenteditable as typing targets, not buttons/sliders', () => {
    const mk = (tag: string, type?: string) => {
      const el = document.createElement(tag);
      if (type) (el as HTMLInputElement).type = type;
      document.body.appendChild(el);
      const e = new Event('x');
      Object.defineProperty(e, 'target', { value: el });
      return isTypingTarget(e);
    };
    expect(mk('input')).toBe(true);
    expect(mk('input', 'email')).toBe(true);
    expect(mk('textarea')).toBe(true);
    expect(mk('select')).toBe(true);
    expect(mk('input', 'range')).toBe(false);
    expect(mk('button')).toBe(false);
  });
});
