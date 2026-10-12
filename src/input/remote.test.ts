import { describe, expect, it } from 'vitest';
import { RemoteInput } from './remote';

describe('phone radio input', () => {
  it('is unavailable until a frame arrives, then holds the latest sticks', () => {
    const r = new RemoteInput();
    expect(r.available()).toBe(false);
    r.apply({ a: 0.25, e: -0.5, r: 1.4, c: -0.2, m: 1, h: 0 });
    expect(r.available()).toBe(true);
    const f = r.poll(0);
    expect(f.aileron).toBe(0.25);
    expect(f.elevator).toBe(-0.5);
    expect(f.rudder).toBe(1); // clamped
    expect(f.collective).toBe(-0.2);
    expect(f.flightMode).toBe(1);
    expect(f.throttleHold).toBe(false);
  });

  it('fails safe after the timeout: cyclic and rudder centre, collective holds, source unavailable', () => {
    const r = new RemoteInput();
    r.failsafeMs = 50;
    r.apply({ a: 0.8, e: 0.3, r: -0.4, c: 0.1, m: 2, h: 1 });
    const t0 = performance.now();
    while (performance.now() - t0 < 80) { /* wait past the failsafe */ }
    expect(r.available()).toBe(false);
    const f = r.poll(0);
    expect(f.aileron).toBe(0);
    expect(f.elevator).toBe(0);
    expect(f.rudder).toBe(0);
    expect(f.collective).toBe(0.1);
    expect(f.flightMode).toBe(2);
    expect(f.throttleHold).toBe(true);
  });

  it('only counts changed sticks as activity, so a quiet phone does not steal the input', () => {
    const r = new RemoteInput();
    r.apply({ a: 0, e: 0, r: 0, c: -1, m: 0, h: 0 });
    const a1 = r.lastActivity();
    r.apply({ a: 0, e: 0, r: 0, c: -1, m: 0, h: 0 });
    expect(r.lastActivity()).toBe(a1);
    r.apply({ a: 0.1, e: 0, r: 0, c: -1, m: 0, h: 0 });
    expect(r.lastActivity()).toBeGreaterThanOrEqual(a1);
  });

  it('carries the rescue switch and fires a reset once per counter change', () => {
    const r = new RemoteInput();
    let resets = 0;
    r.onReset = () => resets++;
    r.apply({ a: 0, e: 0, r: 0, c: -1, m: 0, h: 0, x: 1, rs: 0 });
    expect(r.poll(0).rescue).toBe(true);
    r.apply({ a: 0, e: 0, r: 0, c: -1, m: 0, h: 0, x: 0, rs: 0 });
    expect(r.poll(0).rescue).toBe(false);
    expect(resets).toBe(0); // the first counter value is only a baseline
    r.apply({ a: 0, e: 0, r: 0, c: -1, m: 0, h: 0, x: 0, rs: 1 });
    r.apply({ a: 0, e: 0, r: 0, c: -1, m: 0, h: 0, x: 0, rs: 1 });
    expect(resets).toBe(1);
    r.apply({ a: 0, e: 0, r: 0, c: -1, m: 0, h: 0 });
    expect(r.poll(0).rescue).toBeUndefined();
  });
});
