import { it, expect } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from '../src/sim/physics';
import { HELI_MODELS } from '../src/sim/heli-model';
import { Wind } from '../src/sim/wind';
import { buildField } from '../src/sim/world';
import { neutralFrame } from '../src/input/types';

/**
 * Physics cost: one simulated second at 1 kHz must stay far below a real second (phones have ~5x less CPU).
 * A laptop does 40-57x real time; shared CI runners manage about 12x, so the bar is 5x.
 */
it('physics runs at least 5x real time on this machine', () => {
  const { world } = buildField();
  const wind = new Wind();
  wind.speed = 4;
  let worst = 0;
  for (const model of HELI_MODELS) {
    const sim = new HelicopterSim(model, wind, world);
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    for (let i = 0; i < 25000; i++) sim.step(ctl);
    sim.state.pos.y = 10;
    sim.state.onGround = false;
    ctl.collective = 0.4;
    ctl.aileron = 0.2;
    const t0 = performance.now();
    const n = Math.round(5 / PHYSICS_DT);
    for (let i = 0; i < n; i++) sim.step(ctl);
    const ms = performance.now() - t0;
    worst = Math.max(worst, ms / 5000); // ms of CPU per simulated ms
    console.log(`${model.id}: ${(ms / 5).toFixed(1)} ms per simulated second (${(1000 / (ms / 5)).toFixed(0)}x real time)`);
  }
  expect(worst).toBeLessThan(0.2);
});
