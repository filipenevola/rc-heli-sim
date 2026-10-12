import { beforeAll, describe, expect, it } from 'vitest';
import { FlightLog, logbookHtml, fmtAgo, coachTip } from './flightlog';
import type { FlightSummary } from './debrief';

// Node 26 exposes a `localStorage` global that is undefined without --localstorage-file, and that shadows the
// jsdom one, so give the tests a plain in-memory Storage.
beforeAll(() => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
});

const flight = (over: Partial<FlightSummary>): FlightSummary => ({ seconds: 30, crashed: false, crashReason: '', maxAltitude: 5, maxSpeed: 4, maxG: 1.2, minG: 0.9, vrsSeconds: 0, stallSeconds: 0, batteryUsed: 0.05, touchdown: 0.4, tricks: [], ...over });

describe('logbook', () => {
  it('stores flights, survives a reload and reports progress', () => {
    localStorage.clear();
    const log = new FlightLog();
    for (let i = 0; i < 12; i++) log.add(flight({ touchdown: 1.5, crashed: i % 3 === 0, crashReason: 'Blade strike' }), 'A');
    for (let i = 0; i < 10; i++) log.add(flight({ touchdown: 0.3 }), 'B');
    const again = new FlightLog();
    expect(again.entries.length).toBe(22);
    const st = again.stats();
    expect(st.flights).toBe(22);
    expect(st.recentClean).toBe(1);
    expect(st.earlierClean).toBeLessThan(1);
    expect(st.recentTouchdown).toBeCloseTo(0.3, 5);
    expect(st.earlierTouchdown).toBeCloseTo(1.5, 5);
    const html = logbookHtml(again, (s) => `${s}s`);
    expect(html).toContain('Last 10 flights: 100% clean');
    expect(html).toContain('soft 0.3 m/s');
    expect(html).toContain('Blade strike');
    expect(fmtAgo(Date.now() - 5 * 60000)).toBe('5 min ago');
  });

  it('names the most common recent crash and gives one tip', () => {
    localStorage.clear();
    const log = new FlightLog();
    expect(coachTip(log)).toBeNull();
    log.add(flight({ crashed: true, crashReason: 'Blade strike' }), 'A');
    log.add(flight({ crashed: true, crashReason: 'Hard landing: 3.1 m/s onto the ground. The skids folded.' }), 'A');
    log.add(flight({ crashed: true, crashReason: 'Blade strike' }), 'A');
    log.add(flight({}), 'A');
    const c = coachTip(log)!;
    expect(c.reason).toBe('Blade strike');
    expect(c.tip).toContain('drift');
    expect(logbookHtml(log, (s) => `${s}s`)).toContain('Most of your recent crashes');
  });

  it('merges the account copy without duplicates, newest first', () => {
    localStorage.clear();
    const log = new FlightLog();
    const a = log.add(flight({}), 'A');
    const added = log.merge([
      { ...a }, // same timestamp: ignored
      { at: a.at - 1000, model: 'B', seconds: 40, crashed: false, reason: '', touchdown: 0.5, maxAltitude: 6, maxSpeed: 3, maxG: 1.1, tricks: [] },
      { at: a.at + 1000, model: 'C', seconds: 12, crashed: true, reason: 'Blade strike', touchdown: 0, maxAltitude: 2, maxSpeed: 1, maxG: 1, tricks: ['x'] },
      { junk: true },
    ]);
    expect(added).toBe(2);
    expect(log.entries.map((e) => e.model)).toEqual(['C', 'A', 'B']);
    expect(new FlightLog().entries.length).toBe(3);
  });

  it('keeps at most sixty entries', () => {
    localStorage.clear();
    const log = new FlightLog();
    for (let i = 0; i < 70; i++) log.add(flight({}), 'A');
    expect(log.entries.length).toBe(60);
  });
});
