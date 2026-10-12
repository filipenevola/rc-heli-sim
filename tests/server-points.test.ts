import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHALLENGES, TOTAL_POINTS } from '../src/game/challenges';

/** The rankings server keeps its own points table (it scores without the client). It must mirror the challenges. */
describe('server points table', () => {
  it('matches the client challenges id for id and point for point', () => {
    const src = readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
    const block = src.match(/const POINTS = \{([\s\S]*?)\};/)![1];
    const server = new Map<string, number>();
    for (const m of block.matchAll(/'?([a-z0-9-]+)'?:\s*(\d+)/g)) server.set(m[1], Number(m[2]));
    const client = new Map(CHALLENGES.map((c) => [c.id, c.points]));
    const missing = [...client.keys()].filter((id) => !server.has(id));
    const extra = [...server.keys()].filter((id) => !client.has(id));
    const wrong = [...client.entries()].filter(([id, p]) => server.has(id) && server.get(id) !== p).map(([id]) => id);
    expect({ missing, extra, wrong }).toEqual({ missing: [], extra: [], wrong: [] });
    expect([...server.values()].reduce((a, b) => a + b, 0)).toBe(TOTAL_POINTS);
  });
});
