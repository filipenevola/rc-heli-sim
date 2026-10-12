import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from './physics';
import { HELI_450, HELI_450_FLYBAR, HELI_700, HELI_250, applySetup, type HeliModel } from './heli-model';
import { Wind } from './wind';
import { neutralFrame } from '../input/types';

function run(sim: HelicopterSim, ctl: ReturnType<typeof neutralFrame>, seconds: number) {
  const n = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < n; i++) sim.step(ctl);
}

/** Hover, blip the rudder, and measure the residual rates 1.5-3 s later: a stable setup is quiet, a wagging one is not. */
function residual(model: HeliModel) {
  const sim = new HelicopterSim(model, new Wind());
  const ctl = neutralFrame();
  ctl.flightMode = 1;
  ctl.collective = -0.05;
  run(sim, ctl, 25);
  sim.state.pos.y = 10;
  sim.state.onGround = false;
  ctl.collective = 0.4;
  run(sim, ctl, 2);
  ctl.rudder = 0.5;
  run(sim, ctl, 0.2);
  ctl.rudder = 0;
  let yaw = 0;
  let roll = 0;
  let wag = 0;
  const n = Math.round(3 / PHYSICS_DT);
  for (let i = 0; i < n; i++) {
    sim.step(ctl);
    if (i > n / 2) {
      yaw = Math.max(yaw, Math.abs(sim.state.omega.y));
      roll = Math.max(roll, Math.abs(sim.state.omega.z));
      wag = Math.max(wag, sim.telemetry.wag);
    }
  }
  return { yaw, roll, wag, crashed: sim.state.crashed };
}

describe('controller gains with sensor filter, servo slew and delay', () => {
  it.each([HELI_450, HELI_450_FLYBAR, HELI_700, HELI_250])('$name is quiet at factory gains', (model) => {
    const r = residual(model);
    expect(r.crashed).toBe(false);
    expect(r.yaw).toBeLessThan(0.15);
    expect(r.roll).toBeLessThan(0.15);
    expect(r.wag).toBeLessThan(0.3);
  });

  it('too much tail gyro gain wags the tail (450 at 300%), a sensible increase does not (160%)', () => {
    const wagging = residual(applySetup(HELI_450, { gyroGainPct: 300 }));
    expect(wagging.yaw).toBeGreaterThan(1);
    expect(wagging.wag).toBeGreaterThan(0.5); // the HUD warning and the tail flutter key off this
    expect(residual(applySetup(HELI_450, { gyroGainPct: 160 })).yaw).toBeLessThan(0.15);
  });
});
