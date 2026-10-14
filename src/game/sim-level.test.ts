import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from '../sim/physics';
import { HELI_450 } from '../sim/heli-model';
import { Wind } from '../sim/wind';
import { neutralFrame } from '../input/types';
import { ChallengeTracker } from './challenges';
import { Rescue } from './rescue';
import { LEVEL_PRESETS, SIM_LEVELS, classifyLevel, mergeChallengeLevels, minLevel, presetOf, recordFlight, type FlightConditions, type LevelBests, type SimLevel } from './sim-level';

const conditionsOf = (l: SimLevel, extra: Partial<FlightConditions> = {}): FlightConditions => {
  const p = LEVEL_PRESETS[l];
  return { assist: p.assist, cyclicRate: p.rate, wind: p.wind, gust: p.gust, randomFailures: p.randomFailures, trainingGear: false, helped: false, ...extra };
};

describe('pilot levels', () => {
  it('each preset qualifies for its own board and is recognised as itself', () => {
    for (const l of SIM_LEVELS) {
      expect(classifyLevel(conditionsOf(l))).toBe(l);
      expect(presetOf(LEVEL_PRESETS[l])).toBe(l);
    }
    expect(presetOf({ ...LEVEL_PRESETS.pro, expo: 0.55 })).toBe('custom');
  });

  it('classifies Custom setups by what they actually fly with, never by the label', () => {
    // Pro settings with the self-levelling assist switched on: Beginner board.
    expect(classifyLevel(conditionsOf('pro', { assist: 'attitude' }))).toBe('beginner');
    // Pro without random failures, or in calm air: Amateur board.
    expect(classifyLevel(conditionsOf('pro', { randomFailures: false }))).toBe('amateur');
    expect(classifyLevel(conditionsOf('pro', { wind: 0 }))).toBe('amateur');
    // Training gear, a rescue or a lesson: Beginner whatever else is set.
    expect(classifyLevel(conditionsOf('pro', { trainingGear: true }))).toBe('beginner');
    expect(classifyLevel(conditionsOf('pro', { helped: true }))).toBe('beginner');
    // Soft rates in rate mode are still Beginner; small nudges below a preset keep the board.
    expect(classifyLevel(conditionsOf('amateur', { cyclicRate: 0.5 }))).toBe('beginner');
    expect(classifyLevel(conditionsOf('amateur', { cyclicRate: 0.75 }))).toBe('amateur');
    expect(classifyLevel(conditionsOf('pro', { cyclicRate: 0.95, wind: 3.5 }))).toBe('pro');
    expect(minLevel('pro', 'amateur')).toBe('amateur');
  });

  it('records a flight on its board and every easier one', () => {
    const bests: LevelBests = { beginner: 300 };
    expect(recordFlight(bests, 'pro', 120)).toBe(true);
    expect(bests).toEqual({ beginner: 300, amateur: 120, pro: 120 });
    expect(recordFlight(bests, 'amateur', 100)).toBe(false);
    expect(bests).toEqual({ beginner: 300, amateur: 120, pro: 120 });
  });

  it('merges challenge levels keeping the higher one', () => {
    expect(mergeChallengeLevels({ a: 'pro', b: 'beginner' }, { a: 'amateur', b: 'amateur', c: 'pro' })).toEqual({ a: 'pro', b: 'amateur', c: 'pro' });
  });
});

describe('challenge levels', () => {
  /** Hover for `seconds` with the rescue holding the sticks: enough for First hover. */
  function hover(sim: HelicopterSim, tracker: ChallengeTracker, seconds: number): void {
    const rescue = new Rescue(sim);
    rescue.engage();
    const pilot = neutralFrame();
    const steps = Math.round(1 / 60 / PHYSICS_DT);
    let air = 0;
    for (let f = 0; f < 60 * seconds; f++) {
      const ctl = rescue.update(pilot);
      for (let i = 0; i < steps; i++) sim.step(ctl);
      air += 1 / 60;
      tracker.update(sim, 1 / 60, air);
    }
    rescue.release();
  }

  it('stamps the level a challenge is first flown at and upgrades it when flown again higher', () => {
    const sim = new HelicopterSim(HELI_450, new Wind());
    sim.resetInAir(5);
    const tracker = new ChallengeTracker();
    let level: SimLevel = 'beginner';
    tracker.currentLevel = () => level;
    const completed: string[] = [];
    const ups: [string, SimLevel][] = [];
    tracker.onComplete = (c) => completed.push(c.id);
    tracker.onLevelUp = (c, l) => ups.push([c.id, l]);
    hover(sim, tracker, 12);
    expect(completed).toContain('first-hover');
    expect(tracker.levels['first-hover']).toBe('beginner');
    // Same level again: a done challenge is not re-flown.
    hover(sim, tracker, 12);
    expect(ups).toEqual([]);
    level = 'pro';
    hover(sim, tracker, 12);
    expect(ups).toContainEqual(['first-hover', 'pro']);
    expect(tracker.levels['first-hover']).toBe('pro');
    expect(completed.filter((id) => id === 'first-hover')).toHaveLength(1);
  });

  it('treats completions from before levels as Beginner', () => {
    const tracker = new ChallengeTracker(['first-hover'], {});
    expect(tracker.levels['first-hover']).toBeUndefined();
    tracker.currentLevel = () => 'amateur';
    const sim = new HelicopterSim(HELI_450, new Wind());
    sim.resetInAir(5);
    const ups: string[] = [];
    tracker.onLevelUp = (c) => ups.push(c.id);
    hover(sim, tracker, 12);
    expect(ups).toContain('first-hover');
  });
});
