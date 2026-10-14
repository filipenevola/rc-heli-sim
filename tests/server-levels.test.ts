import { describe, expect, it } from 'vitest';
import { LEVELS, cleanBests, mergeChallengeLevels, proCount } from '../server/levels.mjs';
import { SIM_LEVELS } from '../src/game/sim-level';

describe('server pilot levels', () => {
  it('uses the same levels as the client', () => {
    expect(LEVELS).toEqual(SIM_LEVELS);
  });

  it('cascades bests down the boards and counts a legacy best as Beginner', () => {
    expect(cleanBests({ pro: 90 }, 0, 1000)).toEqual({ beginner: 90, amateur: 90, pro: 90 });
    expect(cleanBests(undefined, 400, 1000)).toEqual({ beginner: 400, amateur: 0, pro: 0 });
    expect(cleanBests({ beginner: 'x', amateur: -5, pro: 5000 }, 0, 1000)).toEqual({ beginner: 1000, amateur: 1000, pro: 1000 });
  });

  it('merges challenge levels, dropping unknown ids and levels', () => {
    const ids = new Set(['a', 'b']);
    expect(mergeChallengeLevels({ a: 'amateur' }, { a: 'pro', b: 'god', zz: 'pro' }, ids)).toEqual({ a: 'pro' });
    expect(proCount({ a: 'pro', b: 'pro' }, ['a'])).toBe(1);
  });
});
