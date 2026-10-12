import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from './physics';
import { HELI_450 } from './heli-model';
import { Wind } from './wind';
import { neutralFrame } from '../input/types';

describe('tail rotor failure', () => {
  it('under power the fuselage spins with the torque; throttle hold stops the spin', () => {
    const sim = new HelicopterSim(HELI_450, new Wind());
    sim.assist = 'attitude';
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    for (let i = 0; i < 25 / PHYSICS_DT; i++) sim.step(ctl);
    sim.resetInAir(40);
    ctl.collective = 0.35;
    for (let i = 0; i < 1 / PHYSICS_DT; i++) sim.step(ctl);
    expect(Math.abs(sim.state.omega.y)).toBeLessThan(0.5);
    sim.failTail();
    for (let i = 0; i < 1.5 / PHYSICS_DT; i++) sim.step(ctl);
    expect(sim.telemetry.tailThrust).toBe(0);
    expect(Math.abs(sim.state.omega.y)).toBeGreaterThan(2); // more than a turn every 3 s, and growing
    ctl.throttleHold = true;
    ctl.collective = -1;
    for (let i = 0; i < 3 / PHYSICS_DT; i++) sim.step(ctl);
    expect(Math.abs(sim.state.omega.y)).toBeLessThan(1.5); // no torque: the spin dies off
    expect(sim.state.crashed).toBe(false);
  });

  it('reset clears the failure', () => {
    const sim = new HelicopterSim(HELI_450, new Wind());
    sim.failTail();
    expect(sim.state.tailFailed).toBe(true);
    sim.reset();
    expect(sim.state.tailFailed).toBe(false);
  });
});
