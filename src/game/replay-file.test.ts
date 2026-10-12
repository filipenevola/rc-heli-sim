import { describe, expect, it } from 'vitest';
import { parseFlight, serializeFlight, type ReplayFrame } from './replay-file';

const frame = (i: number): ReplayFrame => ({ pos: { x: i * 0.123456, y: 1 + i * 0.01, z: -6 }, ori: { x: 0, y: 0.70710678, z: 0, w: 0.70710678 }, a1: 0.0123456, b1: -0.0045, rotorOmega: 288.123, ctl: { aileron: 0.1, elevator: -0.2, rudder: 0, collective: 0.33333, flightMode: 1, throttleHold: false } });

describe('saved flights', () => {
  it('round-trips frames with millimetre rounding', () => {
    const frames = Array.from({ length: 20 }, (_, i) => frame(i));
    const text = serializeFlight(frames, '450 Electric', '0.45.0', new Date('2026-10-12T00:00:00Z'));
    expect(text.length).toBeLessThan(20 * 260);
    const back = parseFlight(text);
    expect(back.model).toBe('450 Electric');
    expect(back.frames.length).toBe(20);
    expect(back.frames[3].pos.x).toBeCloseTo(3 * 0.123456, 3);
    expect(back.frames[3].ctl.collective).toBeCloseTo(0.333, 3);
    expect(back.frames[3].ctl.flightMode).toBe(1);
  });

  it('rejects files that are not flights', () => {
    expect(() => parseFlight('{"hello":1}')).toThrow(/Not a saved/);
    expect(() => parseFlight(JSON.stringify({ format: 'rc-heli-sim-flight', frames: [frame(0)] }))).toThrow(/too short/);
  });
});
