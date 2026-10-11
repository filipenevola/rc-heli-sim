import { it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from '../src/sim/physics';
import { HELI_MODELS } from '../src/sim/heli-model';
import { Wind } from '../src/sim/wind';
import { buildField } from '../src/sim/world';
import { rotate, v3, eulerFromQ } from '../src/sim/math';
import { ChallengeTracker, FlightTimer } from '../src/game/challenges';
import { LESSONS, LessonRunner } from '../src/game/lessons';
it('trace', () => {
  const id = process.env.TRACE ?? 'stall-turn';
  const from = Number(process.env.FROM ?? 3);
  const { world } = buildField();
  const model = HELI_MODELS.find((m) => m.id === (process.env.MODEL ?? '450-fbl'))!;
  const sim = new HelicopterSim(model, new Wind(), world);
  sim.assist = 'attitude';
  const tracker = new ChallengeTracker(); const timer = new FlightTimer();
  const runner = new LessonRunner(LESSONS.find((l) => l.challengeId === id)!, sim, 'show');
  const frameDt = 1 / 60; const n = Math.round(frameDt / PHYSICS_DT);
  let elapsed = 0, lastStep = -1, lastPrint = 0;
  while (!runner.finished && elapsed < 200) {
    const ctl = runner.update(frameDt);
    for (let i = 0; i < n; i++) sim.step(ctl);
    timer.update(sim, frameDt); tracker.update(sim, frameDt, timer.flying ? timer.airTime : 0);
    elapsed += frameDt;
    if (runner.stepIndex !== lastStep) { console.log('t', elapsed.toFixed(1), 'step', runner.stepIndex); lastStep = runner.stepIndex; }
    if (runner.stepIndex >= from && elapsed - lastPrint > 0.25) { lastPrint = elapsed; const s = sim.state; const fwd = rotate(s.ori, v3(0,0,-1)); const up = rotate(s.ori, v3(0,1,0)); console.log('  t', elapsed.toFixed(2), 'y', s.pos.y.toFixed(1), 'vxz', Math.hypot(s.vel.x, s.vel.z).toFixed(1), 'vy', s.vel.y.toFixed(1), 'fwd.y', fwd.y.toFixed(2), 'up.y', up.y.toFixed(2), 'yaw', eulerFromQ(s.ori).yaw.toFixed(2), 'col', ctl.collective.toFixed(2), 'ele', ctl.elevator.toFixed(2), 'ail', ctl.aileron.toFixed(2), 'rud', ctl.rudder.toFixed(2), 'rpm', sim.telemetry.headspeedRpm.toFixed(0), 'prog', (tracker.progress[id] ?? 0).toFixed(2), 'mem', JSON.stringify((tracker as any).mem[id])); }
  }
  console.log('completed', [...tracker.completed], 'failed', runner.failed, 'crashed', sim.state.crashed, sim.state.crashReason);
});
