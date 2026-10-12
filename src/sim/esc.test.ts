import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from './physics';
import { HELI_450, applySetup } from './heli-model';
import { Wind } from './wind';
import { neutralFrame } from '../input/types';
import { eulerFromQ } from './math';

function run(sim: HelicopterSim, ctl: ReturnType<typeof neutralFrame>, seconds: number) {
  const n = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < n; i++) sim.step(ctl);
}

function hover(model = HELI_450) {
  const sim = new HelicopterSim(model, new Wind());
  const ctl = neutralFrame();
  ctl.flightMode = 1;
  ctl.collective = -0.05;
  run(sim, ctl, 25);
  sim.state.pos.y = 10;
  sim.state.onGround = false;
  ctl.collective = 0.4;
  run(sim, ctl, 2);
  return { sim, ctl };
}

describe('ESC governor off', () => {
  it('spools to roughly the nominal head speed and droops under a collective pull', () => {
    const gov = hover();
    const open = hover(applySetup(HELI_450, { governor: false, idleUpThrottlePct: 90 }));
    const nominal = (HELI_450.headspeeds[1] * 60) / (2 * Math.PI);
    expect(open.sim.telemetry.headspeedRpm).toBeGreaterThan(0.85 * nominal);
    expect(open.sim.telemetry.headspeedRpm).toBeLessThan(1.1 * nominal);
    const before = open.sim.telemetry.headspeedRpm;
    open.ctl.collective = 0.9;
    gov.ctl.collective = 0.9;
    run(open.sim, open.ctl, 1);
    run(gov.sim, gov.ctl, 1);
    const droop = 1 - open.sim.telemetry.headspeedRpm / before;
    const govDroop = 1 - gov.sim.telemetry.headspeedRpm / nominal;
    expect(droop).toBeGreaterThan(0.04);
    expect(govDroop).toBeLessThan(droop);
  });
});

describe('rate-mode tail gyro', () => {
  it('lets the heading swing with a collective change where heading hold does not', () => {
    const drift = (model: typeof HELI_450) => {
      const { sim, ctl } = hover(model);
      const yaw0 = eulerFromQ(sim.state.ori).yaw;
      ctl.collective = 0.9;
      run(sim, ctl, 1.5);
      let d = eulerFromQ(sim.state.ori).yaw - yaw0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return Math.abs(d);
    };
    const hh = drift(HELI_450);
    const rate = drift(applySetup(HELI_450, { gyroMode: 'rate' }));
    expect(hh).toBeLessThan(0.15);
    expect(rate).toBeGreaterThan(hh * 3);
    expect(rate).toBeGreaterThan(0.2);
  });
});
