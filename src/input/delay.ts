import type { ControlFrame } from './types';

/**
 * The radio link: a 2.4 GHz transmitter frames the sticks every ~7-20 ms and the receiver/FBL adds a few more,
 * so what the swashplate sees trails the thumbs by 15-40 ms. Small, but it is part of why a real model feels a
 * touch "softer" than a sim with zero latency. A ring of time-stamped frames; `get` returns the newest frame at
 * least `delayMs` old (or the oldest kept, right after start).
 */
export class DelayLine {
  private buf: { t: number; f: ControlFrame }[] = [];
  delayMs = 20;

  push(f: ControlFrame, now: number): void {
    this.buf.push({ t: now, f: { ...f } });
    // Keep a quarter second; more than any sensible delay.
    while (this.buf.length > 2 && now - this.buf[0].t > 250) this.buf.shift();
  }

  get(now: number): ControlFrame | null {
    if (!this.buf.length) return null;
    const target = now - this.delayMs;
    let out = this.buf[0].f;
    for (const e of this.buf) { if (e.t <= target) out = e.f; else break; }
    return out;
  }

  clear(): void { this.buf = []; }
}
