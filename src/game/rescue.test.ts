import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from '../sim/physics';
import { HELI_450 } from '../sim/heli-model';
import { Wind } from '../sim/wind';
import { neutralFrame } from '../input/types';
import { eulerFromQ, qFromAxisAngle } from '../sim/math';
import { Rescue } from './rescue';

describe('rescue (buddy box)', () => {
  it('rolls a banked, sinking heli level and holds a hover, then hands the sticks back', () => {
    const sim = new HelicopterSim(HELI_450, new Wind());
    sim.assist = 'rate';
    const pilot = neutralFrame();
    pilot.flightMode = 1;
    pilot.collective = -0.05;
    for (let i = 0; i < 25 / PHYSICS_DT; i++) sim.step(pilot);
    // A mess: 60° bank at 12 m, sinking at 4 m/s, drifting sideways.
    sim.resetInAir(12);
    sim.state.ori = qFromAxisAngle({ x: 0, y: 0, z: 1 }, (60 * Math.PI) / 180);
    sim.state.vel = { x: 3, y: -4, z: 1 };
    pilot.collective = -0.3; // the pilot has frozen with the collective low
    const rescue = new Rescue(sim);
    expect(rescue.engage()).toBe(true);
    expect(sim.assist).toBe('attitude');
    const frameDt = 1 / 60;
    const steps = Math.round(frameDt / PHYSICS_DT);
    for (let f = 0; f < 60 * 8; f++) {
      const ctl = rescue.update(pilot);
      for (let i = 0; i < steps; i++) sim.step(ctl);
    }
    const e = eulerFromQ(sim.state.ori);
    expect(sim.state.crashed).toBe(false);
    expect(Math.abs(e.roll)).toBeLessThan(0.12);
    expect(Math.abs(e.pitch)).toBeLessThan(0.12);
    expect(Math.hypot(sim.state.vel.x, sim.state.vel.y, sim.state.vel.z)).toBeLessThan(0.6);
    expect(sim.state.pos.y).toBeGreaterThan(3);
    rescue.release();
    expect(sim.assist).toBe('rate');
    expect(rescue.update(pilot)).toBe(pilot);
  });

  it('does nothing on the ground or after a crash', () => {
    const sim = new HelicopterSim(HELI_450, new Wind());
    const rescue = new Rescue(sim);
    expect(rescue.engage()).toBe(false);
    expect(rescue.active).toBe(false);
  });
});
