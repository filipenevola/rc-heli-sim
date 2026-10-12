import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from '../sim/physics';
import { HELI_450 } from '../sim/heli-model';
import { Wind } from '../sim/wind';
import { buildSite } from '../sim/world';
import { siteFor } from '../site';
import { ChallengeTracker, FlightTimer } from './challenges';
import { LESSONS, LessonRunner } from './lessons';

/**
 * Teach mode sanity: a "player" that simply follows the ghost-stick hint must get through the lesson
 * in rate mode (the default for real flying). This proves the hints are achievable and that steps advance
 * on the player's flying, not the demo's.
 */
describe.each(LESSONS.filter((l) => !l.challengeId.startsWith('endurance')))('teach $challengeId', (lesson) => {
  it('a player following the hints completes the lesson', () => {
    const { world } = buildSite(siteFor(lesson.challengeId));
    const sim = new HelicopterSim(HELI_450, new Wind(), world);
    sim.assist = 'rate';
    const tracker = new ChallengeTracker();
    const timer = new FlightTimer();
    const runner = new LessonRunner(lesson, sim, 'teach');
    const frameDt = 1 / 60;
    const n = Math.round(frameDt / PHYSICS_DT);
    let elapsed = 0;
    let ctl = { ...runner.hint };
    while (!runner.finished && !runner.crashed && elapsed < 400) {
      runner.coach(frameDt, ctl);
      // A human lags a little and is a bit smoother than the hint: first-order follow.
      const h = runner.hint;
      const k = 0.5;
      ctl = {
        aileron: ctl.aileron + (h.aileron - ctl.aileron) * k,
        elevator: ctl.elevator + (h.elevator - ctl.elevator) * k,
        rudder: ctl.rudder + (h.rudder - ctl.rudder) * k,
        collective: ctl.collective + (h.collective - ctl.collective) * k,
        flightMode: h.flightMode,
        throttleHold: h.throttleHold,
      };
      for (let i = 0; i < n; i++) sim.step(ctl);
      timer.update(sim, frameDt);
      tracker.update(sim, frameDt, timer.flying ? timer.airTime : 0);
      elapsed += frameDt;
    }
    expect(runner.crashed, `crashed at step ${runner.stepIndex}`).toBe(false);
    expect(runner.finished, `stuck at step ${runner.stepIndex} after ${elapsed.toFixed(0)}s`).toBe(true);
    expect([...tracker.completed]).toContain(lesson.challengeId);
  });
});
