import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from '../sim/physics';
import { HELI_450 } from '../sim/heli-model';
import { Wind } from '../sim/wind';
import { buildSite } from '../sim/world';
import { siteFor } from '../site';
import { ChallengeTracker, FlightTimer } from './challenges';
import { LESSONS, LessonRunner } from './lessons';

/** Every lesson must complete its own challenge on the real physics, without crashing. */
describe.each(LESSONS)('lesson $challengeId', (lesson) => {
  it('completes the challenge', () => {
    const { world } = buildSite(siteFor(lesson.challengeId));
    const sim = new HelicopterSim(HELI_450, new Wind(), world);
    sim.assist = 'attitude';
    const tracker = new ChallengeTracker();
    const timer = new FlightTimer();
    const runner = new LessonRunner(lesson, sim);
    const frameDt = 1 / 60;
    const stepsPerFrame = Math.round(frameDt / PHYSICS_DT);
    let elapsed = 0;
    while (!runner.finished && elapsed < 400) {
      const ctl = runner.update(frameDt);
      for (let i = 0; i < stepsPerFrame; i++) sim.step(ctl);
      timer.update(sim, frameDt);
      tracker.update(sim, frameDt, timer.flying ? timer.airTime : 0);
      elapsed += frameDt;
    }
    expect(runner.failed, `step ${runner.stepIndex}`).toBeNull();
    expect(sim.state.crashed).toBe(false);
    if (!lesson.challengeId.startsWith('endurance')) expect([...tracker.completed]).toContain(lesson.challengeId);
  });
});
