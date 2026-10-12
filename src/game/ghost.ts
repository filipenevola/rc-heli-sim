import { HelicopterSim, PHYSICS_DT } from '../sim/physics';
import type { HeliModel } from '../sim/heli-model';
import { Wind } from '../sim/wind';
import type { World } from '../sim/world';
import { LessonRunner, type Lesson } from './lessons';
import type { Q, V3 } from '../sim/math';

export interface GhostFrame { pos: V3; ori: Q; a1: number; b1: number; rotorOmega: number }

/**
 * The demo pilot's flight for a lesson, pre-computed in a hidden simulation and stored per step, so Teach me
 * can show a translucent "ghost" of what the current step is supposed to look like while the player flies it.
 * One lesson is a few seconds of simulation at 1 kHz; cheap enough to do when the lesson starts.
 */
export function recordGhost(lesson: Lesson, model: HeliModel, world: World, wind: Wind): GhostFrame[][] {
  const sim = new HelicopterSim(model, new Wind(), world);
  sim.wind.speed = wind.speed;
  sim.wind.fromDeg = wind.fromDeg;
  sim.wind.gustiness = wind.gustiness;
  sim.wind.obstacles = wind.obstacles;
  sim.assist = 'attitude';
  const runner = new LessonRunner(lesson, sim, 'show');
  const frameDt = 1 / 60;
  const n = Math.round(frameDt / PHYSICS_DT);
  const perStep: GhostFrame[][] = lesson.steps.map(() => []);
  let elapsed = 0;
  let k = 0;
  while (!runner.finished && elapsed < 240) {
    const step = runner.stepIndex;
    const ctl = runner.update(frameDt);
    for (let i = 0; i < n; i++) sim.step(ctl);
    elapsed += frameDt;
    if (k++ % 3 === 0 && perStep[step]) {
      const s = sim.state;
      perStep[step].push({ pos: { ...s.pos }, ori: { ...s.ori }, a1: s.a1, b1: s.b1, rotorOmega: s.rotorOmega });
    }
    if (sim.state.crashed) break;
  }
  return perStep;
}
