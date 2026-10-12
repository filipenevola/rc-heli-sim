// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { neutralFrame } from '../input/types';
import { TeachScore, loadScores, saveScore } from './lesson-scores';

beforeAll(() => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, get length() { return mem.size; } };
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
});

describe('teach-me score', () => {
  it('is 100 for a perfect trace, lower for a sloppy one, 0 when everything is full-throw wrong', () => {
    const s = new TeachScore();
    expect(s.percent).toBeNull();
    const ctl = neutralFrame();
    const hint = neutralFrame();
    for (let i = 0; i < 100; i++) s.add(ctl, hint);
    expect(s.percent).toBe(100);
    s.reset();
    hint.aileron = 0.4; // a steady 0.4 gap on one cyclic axis: 0.3 * 0.4 = 0.12 mean -> ~83
    for (let i = 0; i < 100; i++) s.add(ctl, hint);
    expect(s.percent).toBeGreaterThan(75);
    expect(s.percent).toBeLessThan(90);
    s.reset();
    ctl.aileron = -1; ctl.elevator = -1; ctl.rudder = -1; ctl.collective = -1;
    hint.aileron = 1; hint.elevator = 1; hint.rudder = 1; hint.collective = 1;
    s.add(ctl, hint);
    expect(s.percent).toBe(0);
  });

  it('keeps the best score per lesson', () => {
    expect(saveScore('first-hover', 70)).toBe(true);
    expect(saveScore('first-hover', 60)).toBe(false);
    expect(saveScore('first-hover', 85)).toBe(true);
    expect(loadScores()['first-hover']).toBe(85);
  });
});
