import { describe, expect, it } from 'vitest';
import { neutralFrame } from './types';
import { DelayLine } from './delay';

describe('radio latency delay line', () => {
  it('returns the frame that is at least the delay old', () => {
    const d = new DelayLine();
    d.delayMs = 20;
    for (let i = 0; i <= 10; i++) {
      const f = neutralFrame();
      f.aileron = i / 10;
      d.push(f, i * 5); // a frame every 5 ms
    }
    expect(d.get(50)!.aileron).toBe(0.6); // 30 ms old frame is the newest at least 20 ms old
    expect(d.get(52)!.aileron).toBe(0.6);
    expect(d.get(55)!.aileron).toBe(0.7);
    d.delayMs = 0;
    expect(d.get(50)!.aileron).toBe(1);
  });

  it('hands out the oldest frame right after start and forgets frames older than a quarter second', () => {
    const d = new DelayLine();
    d.delayMs = 40;
    const f = neutralFrame();
    f.collective = 0.5;
    d.push(f, 1000);
    expect(d.get(1000)!.collective).toBe(0.5);
    for (let t = 1005; t < 1400; t += 5) d.push(neutralFrame(), t);
    expect(d.get(1400)!.collective).toBe(-1);
    expect(d.get(1000)!.collective).toBe(-1); // the 1000 ms frame is gone
  });
});
