import type { ControlFrame } from '../input/types';

/** A short spoken correction for teach mode: the axis where the pilot's stick is furthest from the ghost stick. */
export type Cue = 'More collective' | 'Less collective' | 'Nose down' | 'Nose up' | 'Roll right' | 'Roll left' | 'Nose right' | 'Nose left';

/**
 * Compare the pilot's sticks with the hint and return the one correction worth saying, or null when close enough.
 * `threshold` is the stick difference (full throw = 1) that counts as "off".
 */
export function coachCue(ctl: ControlFrame, hint: ControlFrame, threshold = 0.35): Cue | null {
  const diffs: [number, Cue, Cue][] = [
    [hint.collective - ctl.collective, 'More collective', 'Less collective'],
    [hint.elevator - ctl.elevator, 'Nose down', 'Nose up'],
    [hint.aileron - ctl.aileron, 'Roll right', 'Roll left'],
    [hint.rudder - ctl.rudder, 'Nose right', 'Nose left'],
  ];
  let best: [number, Cue, Cue] | null = null;
  for (const d of diffs) if (Math.abs(d[0]) >= threshold && (!best || Math.abs(d[0]) > Math.abs(best[0]))) best = d;
  if (!best) return null;
  return best[0] > 0 ? best[1] : best[2];
}

/** Debounce for spoken cues: the same correction must persist for `holdMs` before it is said, then wait `cooldownMs`. */
export class CueTimer {
  private candidate: Cue | null = null;
  private since = 0;
  private lastSaid = -Infinity;
  constructor(private holdMs = 1500, private cooldownMs = 5000) {}

  /** Feed the current cue every frame; returns the cue to say now, or null. */
  update(cue: Cue | null, now: number): Cue | null {
    if (cue !== this.candidate) { this.candidate = cue; this.since = now; }
    if (!cue) return null;
    if (now - this.since >= this.holdMs && now - this.lastSaid >= this.cooldownMs) {
      this.lastSaid = now;
      this.since = now;
      return cue;
    }
    return null;
  }
}
