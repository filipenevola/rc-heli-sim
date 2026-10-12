import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from '../sim/physics';
import { HELI_MODELS } from '../sim/heli-model';
import { Wind } from '../sim/wind';
import { buildSite } from '../sim/world';
import { siteFor } from '../site';
import { ChallengeTracker, FlightTimer } from './challenges';
import { LESSONS, LessonRunner } from './lessons';
import { CHALLENGES } from './challenges';

for (const model of HELI_MODELS) {
  // 3D on a flybar trainer boom-strikes (by design); the game runs those lessons on the flybarless 450.
  // A micro cannot autorotate (no rotor energy) and the demo's hold entry boom-strikes a flybar; the game runs
  // that lesson on the flybarless 450 too.
  const lessons = LESSONS.filter((l) => !(model.controller.type === 'flybar' && CHALLENGES.find((c) => c.id === l.challengeId)?.level === '3D'))
    .filter((l) => !((model.rotor.radius < 0.3 || model.controller.type === 'flybar') && l.challengeId === 'autorotation'));
  describe.each(lessons)(`show-me on ${model.name}: $challengeId`, (lesson) => {
    it('completes without crashing', () => {
      const { world } = buildSite(siteFor(lesson.challengeId));
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
