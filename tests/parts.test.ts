import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PARTS, PART_GROUPS, partsFor } from '../src/game/parts';

describe('parts catalogue (Hangar)', () => {
  it('has unique ids, known groups and text for every part', () => {
    const ids = PARTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PARTS) {
      expect(PART_GROUPS.map((g) => g.id)).toContain(p.group);
      expect(p.name.length).toBeGreaterThan(2);
      expect(p.what.length).toBeGreaterThan(20);
    }
  });

  it('every part the 3D model builds has a catalogue entry, and every entry is built', () => {
    const src = readFileSync('src/render/heli-mesh.ts', 'utf8');
    const used = new Set([...src.matchAll(/\b(?:piece|mesh|tube|rod|link|ball)\('([a-z-]+)'/g)].map((m) => m[1]));
    const known = new Set(PARTS.map((p) => p.id));
    for (const id of used) expect(known, `catalogue is missing "${id}"`).toContain(id);
    for (const id of known) expect(used, `the model never builds "${id}"`).toContain(id);
  });

  it('flybar-only parts are hidden on flybarless machines and the variants apply', () => {
    const fbl = partsFor('fbl');
    const fb = partsFor('flybar');
    expect(fbl.find((p) => p.id === 'flybar')).toBeUndefined();
    expect(fb.find((p) => p.id === 'flybar')).toBeDefined();
    expect(fbl.find((p) => p.id === 'tail-drive')!.name).toBe('Torque tube');
    expect(fb.find((p) => p.id === 'tail-drive')!.name).toBe('Tail drive belt');
    expect(fbl.find((p) => p.id === 'gyro')!.name).toBe('Flybarless unit');
    const nitro = partsFor('fbl', 'nitro');
    expect(nitro.find((p) => p.id === 'motor')).toBeUndefined();
    expect(nitro.find((p) => p.id === 'engine')).toBeDefined();
    expect(nitro.find((p) => p.id === 'battery')!.name).toBe('Receiver battery');
    expect(partsFor('fbl').find((p) => p.id === 'training-gear')).toBeUndefined();
    expect(partsFor('fbl', 'electric', true).find((p) => p.id === 'training-gear')).toBeDefined();
  });
});
