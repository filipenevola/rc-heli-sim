import { describe, expect, it } from 'vitest';
import { Minimap } from './minimap';

describe('minimap', () => {
  it('covers at least 40 m and grows with the distance to the model', () => {
    expect(Minimap.radiusFor({ x: 0, z: 0 }, { x: 0, z: -6 })).toBe(40);
    expect(Minimap.radiusFor({ x: 0, z: 0 }, { x: 60, z: -80 })).toBeCloseTo(100 * 1.25 + 8);
  });
});
