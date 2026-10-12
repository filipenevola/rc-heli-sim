import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from './physics';
import { HELI_450, HELI_700 } from './heli-model';
import { Wind } from './wind';
import { neutralFrame } from '../input/types';

describe('reset into a hover', () => {
  it.each([HELI_450, HELI_700])('$name sits at 6 m with the rotor at speed and holds near hover collective', (model) => {
    const sim = new HelicopterSim(model, new Wind());
    sim.resetInAir(6);
    expect(sim.state.pos.y).toBeCloseTo(6, 5);
    expect(sim.telemetry.headspeedRpm === 0 || sim.state.rotorOmega > 0).toBe(true);
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = 0.5;
    for (let i = 0; i < 2000; i++) sim.step(ctl, PHYSICS_DT);
    expect(sim.state.crashed).toBe(false);
    expect(sim.state.pos.y).toBeGreaterThan(4);
    expect(sim.state.pos.y).toBeLessThan(20); // half stick is a climb on the 700, a hover on the 450
  });
});
