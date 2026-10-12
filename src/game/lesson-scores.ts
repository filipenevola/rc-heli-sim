import type { ControlFrame } from '../input/types';

/**
 * Teach-me score: how closely the pilot's sticks followed the ghost stick through a lesson, 0..100. The mean
 * absolute difference over the four axes, weighted toward the cyclic, turned into a percentage; 100 is a perfect
 * trace, 60 is "roughly there", below 40 is flying something else.
 */
export class TeachScore {
  private sum = 0;
  private n = 0;

  reset(): void {
    this.sum = 0;
    this.n = 0;
  }

  /** Feed the pilot's sticks and the ghost's every frame while a step is in progress. */
  add(ctl: ControlFrame, hint: ControlFrame): void {
    const d = 0.3 * Math.abs(ctl.aileron - hint.aileron) + 0.3 * Math.abs(ctl.elevator - hint.elevator) + 0.15 * Math.abs(ctl.rudder - hint.rudder) + 0.25 * Math.abs(ctl.collective - hint.collective);
    this.sum += d;
    this.n++;
  }

  get samples(): number { return this.n; }

  /** 0..100; null before any sample. Full-throw disagreement everywhere scores 0, a mean gap of 0.35 scores ~50. */
  get percent(): number | null {
    if (!this.n) return null;
    const mean = this.sum / this.n;
    return Math.round(Math.max(0, Math.min(100, 100 * (1 - mean / 0.7))));
  }
}

const KEY = 'rc-heli-sim.lesson-scores.v1';

/** Best teach-me score per challenge id on this device. */
export function loadScores(): Record<string, number> {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>) || {};
  } catch {
    return {};
  }
}

/** Record a score; returns true when it is a new best. */
export function saveScore(id: string, pct: number): boolean {
  const all = loadScores();
  const best = all[id] ?? -1;
  if (pct <= best) return false;
  all[id] = pct;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage off */ }
  return true;
}
