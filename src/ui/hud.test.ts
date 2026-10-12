// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Hud } from './hud';

describe('HUD toasts', () => {
  it('wires data-action buttons to onAction and closes the toast', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const hud = new Hud(root);
    const seen: string[] = [];
    hud.onAction = (id) => seen.push(id);
    hud.notify('<b>Clean flight</b><br><button data-action="replay-flight">Replay</button>', 1000);
    const btn = root.querySelector<HTMLButtonElement>('button[data-action]')!;
    expect(btn).toBeTruthy();
    btn.click();
    expect(seen).toEqual(['replay-flight']);
    expect((root.querySelector('.toast') as HTMLElement).style.display).toBe('none');
  });
});
