import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from './physics';
import { HELI_450 } from './heli-model';
import { Wind } from './wind';
import { neutralFrame } from '../input/types';

function run(sim: HelicopterSim, ctl: ReturnType<typeof neutralFrame>, seconds: number) {
  const n = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < n; i++) sim.step(ctl);
}

describe('dynamic inflow', () => {
  it('thrust overshoots on a quick collective pull, then settles as the inflow builds', () => {
    const sim = new HelicopterSim(HELI_450, new Wind());
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    sim.state.pos.y = 10;
    sim.state.onGround = false;
    ctl.collective = 0.4;
    run(sim, ctl, 2);
    ctl.collective = 0.8;
    let peak = 0;
    for (let i = 0; i < 150; i++) {
      sim.step(ctl);
      peak = Math.max(peak, sim.telemetry.thrust);
    }
    // Hold altitude-ish for the comparison: the climb that follows reduces the steady thrust a little anyway.
    run(sim, ctl, 0.6);
    const settled = sim.telemetry.thrust;
    expect(peak).toBeGreaterThan(settled * 1.08);
    expect(sim.state.crashed).toBe(false);
  });
});
