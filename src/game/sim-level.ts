import type { AssistMode } from '../sim/physics';

/**
 * Pilot levels: Beginner / Amateur / Pro. A level is a preset over settings that already exist (assist, rates,
 * expo, wind, random failures); the physics are the same at every level. Rankings never trust the label: a
 * flight is classified from the conditions it was actually flown in, and lands on the hardest board whose
 * requirements it met for the whole flight.
 */
export type SimLevel = 'beginner' | 'amateur' | 'pro';
export const SIM_LEVELS: SimLevel[] = ['beginner', 'amateur', 'pro'];
export const LEVEL_LABEL: Record<SimLevel, string> = { beginner: 'Beginner', amateur: 'Amateur', pro: 'Pro' };
export const LEVEL_BADGE: Record<SimLevel, string> = { beginner: '🟢', amateur: '🟡', pro: '🔴' };

export interface LevelPreset {
  assist: AssistMode;
  /** Cyclic expo and dual rate (aileron and elevator), rudder expo. */
  expo: number;
  rate: number;
  rexpo: number;
  /** Wind at 10 m, m/s, and gustiness 0..1. */
  wind: number;
  gust: number;
  randomFailures: boolean;
}

export const LEVEL_PRESETS: Record<SimLevel, LevelPreset> = {
  beginner: { assist: 'attitude', expo: 0.4, rate: 0.6, rexpo: 0.3, wind: 0, gust: 0, randomFailures: false },
  amateur: { assist: 'rate', expo: 0.3, rate: 0.8, rexpo: 0.2, wind: 2, gust: 0.2, randomFailures: false },
  pro: { assist: 'rate', expo: 0.2, rate: 1, rexpo: 0.1, wind: 4, gust: 0.5, randomFailures: true },
};

export const LEVEL_SUMMARY: Record<SimLevel, string> = {
  beginner: 'Self-levelling assist, soft rates, no wind.',
  amateur: 'Real helicopter behaviour, medium rates, a light breeze.',
  pro: 'Full rates, gusty wind, random tail failures.',
};

/** What the board requirements look at. `wind` is the effective wind (0 indoors). */
export interface FlightConditions {
  assist: AssistMode;
  cyclicRate: number;
  wind: number;
  gust: number;
  randomFailures: boolean;
  trainingGear: boolean;
  /** Someone else had the sticks: rescue (buddy box), a lesson or a replay. */
  helped: boolean;
}

/** Board requirements, a little below the presets so small slider nudges do not drop a level. */
export const PRO_MIN = { cyclicRate: 0.9, wind: 3, gust: 0.4 };
export const AMATEUR_MIN = { cyclicRate: 0.7 };

export function classifyLevel(c: FlightConditions): SimLevel {
  if (c.helped || c.trainingGear || c.assist !== 'rate' || c.cyclicRate < AMATEUR_MIN.cyclicRate) return 'beginner';
  if (c.cyclicRate >= PRO_MIN.cyclicRate && c.wind >= PRO_MIN.wind && c.gust >= PRO_MIN.gust && c.randomFailures) return 'pro';
  return 'amateur';
}

export const levelRank = (l: SimLevel): number => SIM_LEVELS.indexOf(l);
export const minLevel = (a: SimLevel, b: SimLevel): SimLevel => (levelRank(a) <= levelRank(b) ? a : b);
export const isLevel = (v: unknown): v is SimLevel => typeof v === 'string' && (SIM_LEVELS as string[]).includes(v);

/** The preset the current settings match, or 'custom' once the pilot changed something. */
export function presetOf(s: LevelPreset): SimLevel | 'custom' {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  for (const l of SIM_LEVELS) {
    const p = LEVEL_PRESETS[l];
    if (p.assist === s.assist && near(p.expo, s.expo) && near(p.rate, s.rate) && near(p.rexpo, s.rexpo) && near(p.wind, s.wind) && near(p.gust, s.gust) && p.randomFailures === s.randomFailures) return l;
  }
  return 'custom';
}

export type LevelBests = Partial<Record<SimLevel, number>>;

/**
 * Record a clean flight on its board and on every easier one: a Pro flight met the Amateur and Beginner
 * requirements too. Returns true when it beat a record on its own board.
 */
export function recordFlight(bests: LevelBests, level: SimLevel, seconds: number): boolean {
  const beat = seconds > (bests[level] ?? 0);
  for (const l of SIM_LEVELS.slice(0, levelRank(level) + 1)) bests[l] = Math.max(bests[l] ?? 0, seconds);
  return beat;
}

/** Union of two challenge-level maps, keeping the higher level per challenge. */
export function mergeChallengeLevels(a: Record<string, SimLevel>, b: Record<string, SimLevel>): Record<string, SimLevel> {
  const out = { ...a };
  for (const [id, l] of Object.entries(b)) if (isLevel(l) && (!out[id] || levelRank(l) > levelRank(out[id]))) out[id] = l;
  return out;
}
