import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from './physics';
import { HELI_450, HELI_450_FLYBAR, HELI_700, type HeliModel } from './heli-model';
import { Wind } from './wind';
import { neutralFrame, type ControlFrame } from '../input/types';
import { eulerFromQ } from './math';

function run(sim: HelicopterSim, ctl: ControlFrame, seconds: number) {
  const n = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < n; i++) sim.step(ctl);
}

function spoolUp(model: HeliModel) {
  const sim = new HelicopterSim(model, new Wind());
  const ctl = neutralFrame();
  ctl.flightMode = 1; // idle-up: governor holds full headspeed, pitch -11..+11
  ctl.collective = -0.05; // ~0 deg collective while spooling
  run(sim, ctl, 25);
  return { sim, ctl };
}

describe.each([HELI_450, HELI_450_FLYBAR, HELI_700])('$name', (model) => {
  it('rests on its skids with the rotor stopped', () => {
    const sim = new HelicopterSim(model, new Wind());
    run(sim, neutralFrame(), 3);
    expect(sim.state.crashed).toBe(false);
    expect(sim.state.onGround).toBe(true);
    expect(Math.abs(sim.state.vel.y)).toBeLessThan(0.05);
    const e = eulerFromQ(sim.state.ori);
    expect(Math.abs(e.roll)).toBeLessThan(0.05);
    expect(Math.abs(e.pitch)).toBeLessThan(0.05);
  });

  it('governor reaches headspeed and the heli stays on the ground at zero collective', () => {
    const { sim } = spoolUp(model);
    const target = (model.headspeeds[1] * 60) / (2 * Math.PI);
    expect(sim.telemetry.headspeedRpm).toBeGreaterThan(target * 0.97);
    expect(sim.state.crashed).toBe(false);
    expect(sim.state.onGround).toBe(true);
  });

  it('lifts off with positive collective and hovers at a plausible pitch (4-7 deg)', () => {
    const { sim, ctl } = spoolUp(model);
    // Bisection on collective stick for a trimmed hover (thrust == weight) using a frozen aerodynamic probe.
    let lo = 0;
    let hi = 1;
    let hoverStick = 0.5;
    for (let i = 0; i < 20; i++) {
      hoverStick = (lo + hi) / 2;
      ctl.collective = hoverStick;
      const probe = new HelicopterSim(model, new Wind());
      probe.state = structuredClone(sim.state);
      probe.state.pos.y = 5; // out of ground effect
      run(probe, ctl, 1.5);
      if (probe.state.vel.y > 0) hi = hoverStick;
      else lo = hoverStick;
    }
    ctl.collective = hoverStick;
    expect(sim.telemetry.collectiveDeg).toBeLessThan(0.5);
    const probe = new HelicopterSim(model, new Wind());
    probe.state = structuredClone(sim.state);
    probe.state.pos.y = 5;
    run(probe, ctl, 2);
    expect(probe.telemetry.collectiveDeg).toBeGreaterThan(3.0);
    expect(probe.telemetry.collectiveDeg).toBeLessThan(7.5);
    expect(probe.state.crashed).toBe(false);
  });

  it('a hover with centred sticks does not tumble within 10 s', () => {
    const { sim, ctl } = spoolUp(model);
    sim.state.pos.y = 5;
    sim.state.onGround = false;
    ctl.collective = 0.5;
    run(sim, ctl, 10);
    const e = eulerFromQ(sim.state.ori);
    expect(sim.state.crashed).toBe(false);
    expect(Math.abs(e.roll)).toBeLessThan(0.6);
    expect(Math.abs(e.pitch)).toBeLessThan(0.6);
  });

  it('right aileron rolls right, forward elevator pitches nose down, right rudder yaws right', () => {
    for (const [axis, sign, read] of [
      ['aileron', 1, (s: HelicopterSim) => eulerFromQ(s.state.ori).roll],
      ['elevator', 1, (s: HelicopterSim) => -eulerFromQ(s.state.ori).pitch],
      ['rudder', 1, (s: HelicopterSim) => -eulerFromQ(s.state.ori).yaw],
    ] as const) {
      const { sim, ctl } = spoolUp(model);
      sim.state.pos.y = 5;
      sim.state.onGround = false;
      ctl.collective = 0.5;
      run(sim, ctl, 1);
      const before = read(sim);
      ctl[axis] = 0.4 * sign;
      run(sim, ctl, 0.25);
      expect(read(sim) - before, axis).toBeGreaterThan(0.05);
    }
  });

  it('throttle hold from altitude: rotor keeps turning in descent (autorotation) then it hits the ground', () => {
    const { sim, ctl } = spoolUp(model);
    sim.state.pos.y = 40;
    sim.state.onGround = false;
    ctl.collective = 0.5;
    run(sim, ctl, 1);
    ctl.throttleHold = true;
    ctl.collective = -0.6; // negative-ish collective keeps the disc driven
    run(sim, ctl, 2.5);
    const rpmAfter = sim.telemetry.headspeedRpm;
    expect(rpmAfter).toBeGreaterThan(0.4 * ((model.headspeeds[1] * 60) / (2 * Math.PI)));
    expect(sim.state.vel.y).toBeLessThan(-3);
  });

  it('a blade strike crashes the heli', () => {
    const { sim, ctl } = spoolUp(model);
    sim.state.pos.y = 0.3;
    sim.state.onGround = false;
    ctl.collective = 0.3;
    ctl.aileron = 1;
    run(sim, ctl, 1.5);
    expect(sim.state.crashed).toBe(true);
  });
});
