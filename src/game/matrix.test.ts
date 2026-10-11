import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from '../sim/physics';
import { HELI_MODELS } from '../sim/heli-model';
import { Wind } from '../sim/wind';
import { buildField } from '../sim/world';
import { ChallengeTracker, FlightTimer } from './challenges';
import { LESSONS, LessonRunner } from './lessons';

for (const model of HELI_MODELS) {
  describe.each(LESSONS)(`show-me on ${model.name}: $challengeId`, (lesson) => {
    it('completes without crashing', () => {
      const { world } = buildField();
      const sim = new HelicopterSim(model, new Wind(), world);
      sim.assist = 'attitude';
      const tracker = new ChallengeTracker();
      const timer = new FlightTimer();
      const runner = new LessonRunner(lesson, sim, 'show');
      const frameDt = 1 / 60;
      const n = Math.round(frameDt / PHYSICS_DT);
      let elapsed = 0;
      while (!runner.finished && elapsed < 400) {
        const ctl = runner.update(frameDt);
        for (let i = 0; i < n; i++) sim.step(ctl);
        timer.update(sim, frameDt);
        tracker.update(sim, frameDt, timer.flying ? timer.airTime : 0);
        elapsed += frameDt;
      }
      expect(runner.failed, `step ${runner.stepIndex}`).toBeNull();
      if (!lesson.challengeId.startsWith('endurance')) expect([...tracker.completed]).toContain(lesson.challengeId);
    });
  });
}
