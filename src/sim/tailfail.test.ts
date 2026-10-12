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

describe('tail rotor vortex ring (loss of tail effectiveness)', () => {
  it('a sideways slide at the tail wake speed puts the tail into VRS; forward flight does not', () => {
    const sim = new HelicopterSim(HELI_450, new Wind());
    sim.assist = 'attitude';
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    for (let i = 0; i < 25 / PHYSICS_DT; i++) sim.step(ctl);
    const probe = (vx: number, vz: number) => {
      sim.resetInAir(30);
      ctl.collective = 0.35;
      let peak = 0;
      for (let i = 0; i < 1.5 / PHYSICS_DT; i++) {
        sim.state.vel = { x: vx, y: sim.state.vel.y, z: vz }; // hold the slide so the test is about the tail, not the autopilot
        sim.step(ctl);
        if (i > 0.5 / PHYSICS_DT) peak = Math.max(peak, sim.telemetry.tailVrs);
      }
      return peak;
    };
    const sideways = Math.max(...[2, 3, 4, 5, 6, 8].flatMap((v) => [probe(v, 0), probe(-v, 0)]));
    expect(sideways).toBeGreaterThan(0.3);
    expect(probe(0, -8)).toBeLessThan(0.1);
  });
});
