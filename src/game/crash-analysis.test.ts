import { describe, expect, it } from 'vitest';
import { analyseCrash } from './crash-analysis';
import { neutralFrame } from '../input/types';
import type { ReplayFrame } from './replay-file';

/** Build 2 s of frames from a per-frame function. */
function frames(n: number, f: (i: number) => Omit<Partial<ReplayFrame>, 'ctl'> & { ctl?: Partial<ReplayFrame['ctl']> }): ReplayFrame[] {
  return Array.from({ length: n }, (_, i) => {
    const o = f(i);
    return { pos: o.pos ?? { x: 0, y: 1, z: -6 }, ori: o.ori ?? { x: 0, y: 0, z: 0, w: 1 }, a1: 0, b1: 0, rotorOmega: 280, ctl: { ...neutralFrame(), ...(o.ctl ?? {}) } };
  });
}

describe('crash analysis', () => {
  it('spots an inverted low arrival', () => {
    const fr = frames(120, (i) => ({ pos: { x: 0, y: 8 - i * 0.06, z: -6 }, ori: i > 100 ? { x: 1, y: 0, z: 0, w: 0 } : { x: 0, y: 0, z: 0, w: 1 } }));
    expect(analyseCrash(fr)).toMatch(/Inverted below 5 m/);
  });

  it('spots a late flare', () => {
    // Sinking at 5 m/s with the collective low, pulled only in the last 0.3 s.
    const fr = frames(120, (i) => ({ pos: { x: 0, y: 10 - i * (5 / 60), z: -6 }, ctl: { collective: i > 100 ? 1 : -0.5 } }));
    expect(analyseCrash(fr)).toMatch(/collective came up too late/);
  });

  it('spots full cyclic near the ground, and drift at touchdown', () => {
    const cyc = frames(120, (i) => ({ pos: { x: 0, y: 1.2, z: -6 }, ctl: { aileron: i > 95 ? 1 : 0, collective: 0 } }));
    expect(analyseCrash(cyc)).toMatch(/Full cyclic near the ground/);
    const drift = frames(120, (i) => ({ pos: { x: i * 0.05, y: 0.5, z: -6 }, ctl: { collective: 0 } }));
    expect(analyseCrash(drift)).toMatch(/drift/);
  });

  it('says nothing for a clean record or too few frames', () => {
    expect(analyseCrash(frames(10, () => ({})))).toBeNull();
    expect(analyseCrash(frames(120, () => ({ pos: { x: 0, y: 3, z: -6 }, ctl: { collective: 0 } })))).toBeNull();
  });
});
