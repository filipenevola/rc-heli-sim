import { describe, expect, it } from 'vitest';
import { HELI_450 } from '../sim/heli-model';
import { Wind } from '../sim/wind';
import { buildSite } from '../sim/world';
import { LESSONS } from './lessons';
import { recordGhost } from './ghost';

describe('ghost recording', () => {
  it('pre-flies a lesson quickly and yields frames for every step', () => {
    const { world } = buildSite('field');
    const lesson = LESSONS.find((l) => l.challengeId === 'first-hover')!;
    const t0 = performance.now();
    const frames = recordGhost(lesson, HELI_450, world, new Wind());
    const ms = performance.now() - t0;
    expect(frames.length).toBe(lesson.steps.length);
    expect(frames.every((f) => f.length > 5)).toBe(true);
    expect(ms).toBeLessThan(20000); // a laptop does this in ~2 s; shared CI runners take ~5 s
  });
});
