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

describe('attitude assist', () => {
  it('self-levels from a 25 degree bank with centred sticks and holds a commanded bank', () => {
    const sim = new HelicopterSim(HELI_450, new Wind());
    sim.assist = 'attitude';
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    sim.state.pos.y = 10;
    sim.state.onGround = false;
    ctl.collective = 0.5;
    const bank = (25 * Math.PI) / 180;
    sim.state.ori = { x: 0, y: 0, z: Math.sin(-bank / 2), w: Math.cos(-bank / 2) }; // rolled right
    run(sim, ctl, 1.5);
    expect(Math.abs(eulerFromQ(sim.state.ori).roll)).toBeLessThan(0.06);
    ctl.aileron = 0.5; // half stick = half of the max angle
    run(sim, ctl, 1.5);
    expect(eulerFromQ(sim.state.ori).roll).toBeGreaterThan(0.5 * sim.attitudeMaxAngle - 0.08);
    expect(eulerFromQ(sim.state.ori).roll).toBeLessThan(0.5 * sim.attitudeMaxAngle + 0.08);
    expect(sim.state.crashed).toBe(false);
  });
});

describe('inverted flight (Idle-Up negative pitch)', () => {
  it('upside down with the collective stick pushed below centre, the rotor holds the heli up', () => {
    const sim = new HelicopterSim(HELI_450, new Wind());
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    sim.state.pos.y = 30;
    sim.state.onGround = false;
    sim.state.vel = { x: 0, y: 0, z: 0 };
    // Roll 180 degrees about the fore/aft axis.
    sim.state.ori = { x: 0, y: 0, z: Math.sin(Math.PI / 2), w: Math.cos(Math.PI / 2) };
    ctl.collective = -0.5; // about -5.5 deg: inverted hover region
    run(sim, ctl, 2);
    expect(sim.telemetry.collectiveDeg).toBeLessThan(-4);
    expect(sim.telemetry.thrust).toBeLessThan(0); // negative along the (now downward-pointing) rotor axis = pushes up
    expect(sim.state.pos.y).toBeGreaterThan(24); // far less than a free fall of 19.6 m
    expect(sim.state.crashed).toBe(false);
    // Normal mode cannot do this: its curve has almost no negative pitch.
    const sim2 = new HelicopterSim(HELI_450, new Wind());
    sim2.state = structuredClone(sim.state);
    const ctl2 = { ...ctl, flightMode: 0 as const };
    run(sim2, ctl2, 1);
    expect(sim2.telemetry.collectiveDeg).toBeGreaterThan(-3);
  });
});

describe('world collisions and landing targets', () => {
  it('a heli set down on the picnic table rests on it and registers a landing', async () => {
    const { buildField } = await import('./world');
    const { world, layout } = buildField();
    const table = layout.platforms.find((p) => p.id === 'table')!;
    const sim = new HelicopterSim(HELI_450, new Wind(), world);
    const ctl = neutralFrame();
    sim.state.pos = { x: table.x + 0.1, y: table.height + 0.2, z: table.z };
    run(sim, ctl, 4);
    expect(sim.state.crashed).toBe(false);
    expect(sim.state.pos.y).toBeGreaterThan(table.height); // sitting on the surface, not on the grass
    expect(sim.state.landed?.target.id).toBe('table');
    expect(sim.state.landed!.offset).toBeLessThan(0.3);
  });

  it('settling onto the lake is a ditching, while the pontoon in it holds the heli up', async () => {
    const { buildField } = await import('./world');
    const { world, layout } = buildField();
    const sim = new HelicopterSim(HELI_450, new Wind(), world);
    const ctl = neutralFrame();
    sim.state.pos = { x: layout.pond.x + 5, y: 0.2, z: layout.pond.z };
    run(sim, ctl, 1);
    expect(sim.state.crashed).toBe(true);
    expect(sim.state.crashReason).toContain('lake');
    const pontoon = layout.platforms.find((p) => p.id === 'pontoon')!;
    const sim2 = new HelicopterSim(HELI_450, new Wind(), world);
    sim2.state.pos = { x: pontoon.x, y: pontoon.height + 0.2, z: pontoon.z };
    run(sim2, ctl, 4);
    expect(sim2.state.crashed).toBe(false);
    expect(sim2.state.landed?.target.id).toBe('pontoon');
  });

  it('every tree crown, billboard and the fence stay out of the water', async () => {
    const { buildField, lakeDistance, FENCE } = await import('./world');
    const { BILLBOARDS } = await import('./ads');
    const { layout } = buildField();
    for (const t of layout.trees) expect(lakeDistance(layout.lake, t.x, t.z)).toBeGreaterThan(1.7 * t.scale);
    for (const b of BILLBOARDS) expect(lakeDistance(layout.lake, b.x, b.z)).toBeGreaterThan(b.width / 2);
    expect(lakeDistance(layout.lake, FENCE.x1, FENCE.z)).toBeGreaterThan(1);
    for (const h of layout.houses) expect(lakeDistance(layout.lake, h.x, h.z)).toBeGreaterThan(Math.hypot(h.w, h.d) / 2);
  });

  it('ground effect comes from the surface under the rotor: the tower pad cushions, the open air beside it does not', async () => {
    const { buildField } = await import('./world');
    const { world, layout } = buildField();
    const tower = layout.platforms.find((p) => p.id === 'tower')!;
    const ge = (x: number) => {
      const sim = new HelicopterSim(HELI_450, new Wind(), world);
      const ctl = neutralFrame();
      ctl.flightMode = 1;
      run(sim, ctl, 6); // spool up on the pad
      sim.state.pos = { x, y: tower.height + 0.35, z: tower.z };
      sim.state.vel = { x: 0, y: 0, z: 0 };
      sim.state.onGround = false;
      sim.step(ctl);
      return sim.telemetry.groundEffect;
    };
    expect(ge(tower.x)).toBeGreaterThan(1.03);
    expect(ge(tower.x + 3)).toBeLessThan(1.01);
  });

  it('flying the rotor into a tree is a crash', async () => {
    const { buildField } = await import('./world');
    const { world, layout } = buildField();
    const tree = layout.trees[0];
    const sim = new HelicopterSim(HELI_450, new Wind(), world);
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    sim.state.pos = { x: tree.x + 1.7 * tree.scale + 0.5, y: 3, z: tree.z };
    sim.state.vel = { x: -4, y: 0, z: 0 };
    sim.state.onGround = false;
    ctl.collective = 0.5;
    run(sim, ctl, 1);
    expect(sim.state.crashed).toBe(true);
    expect(sim.state.crashReason).toContain('tree');
  });
});

describe('realism: stall, vortex ring state, battery', () => {
  it('blade stall: beyond ~13 deg the thrust stops growing with collective and torque keeps climbing', async () => {
    const { solveRotor, emptyRotorResult } = await import('./rotor');
    const r = HELI_450.rotor;
    const omega = HELI_450.headspeeds[1];
    const out = emptyRotorResult();
    const t8 = solveRotor(r, (8 * Math.PI) / 180, 0, 0, omega, out).thrust;
    const q8 = out.torque;
    const t12 = solveRotor(r, (12 * Math.PI) / 180, 0, 0, omega, out).thrust;
    const t16 = solveRotor(r, (16 * Math.PI) / 180, 0, 0, omega, out).thrust; // about where the blade reaches 13 deg AoA
    const t22 = solveRotor(r, (22 * Math.PI) / 180, 0, 0, omega, out).thrust;
    const q22 = out.torque;
    expect(t12).toBeGreaterThan(t8);
    expect(t16).toBeGreaterThan(t12);
    expect(t22).toBeLessThan(t16); // past stall: more collective, less thrust
    expect(out.stall).toBeGreaterThan(0.3);
    expect(q22).toBeGreaterThan(q8 * 2.5); // and it costs a lot of torque
  });

  it('vortex ring state: a vertical descent near the induced velocity loses thrust; forward speed clears it', async () => {
    const { solveRotor, emptyRotorResult } = await import('./rotor');
    const r = HELI_450.rotor;
    const omega = HELI_450.headspeeds[1];
    const theta = (6 * Math.PI) / 180;
    const out = emptyRotorResult();
    const hover = solveRotor(r, theta, 0, 0, omega, out).thrust;
    const vi = out.vi;
    const descent = solveRotor(r, theta, -1.1 * vi, 0, omega, out).thrust;
    expect(out.vrs).toBeGreaterThan(0.6);
    expect(descent).toBeLessThan(hover * 0.95);
    solveRotor(r, theta, -1.1 * vi, 12, omega, out);
    expect(out.vrs).toBeLessThan(0.05);
  });

  it('battery: a hover drains the pack and the motor quits at 0%', () => {
    const sim = new HelicopterSim(HELI_450, new Wind());
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 20);
    sim.state.batteryWh = 0.02; // nearly flat
    sim.state.pos.y = 20;
    sim.state.onGround = false;
    ctl.collective = 0.5;
    run(sim, ctl, 6);
    expect(sim.telemetry.battery).toBe(0);
    expect(sim.telemetry.motorPower).toBe(0);
    expect(sim.telemetry.headspeedRpm).toBeLessThan(2500); // spooling down, no power
  });
});

describe('boom strike', () => {
  it('on a flybar head, full cyclic with the disc unloaded over-flaps the blades into the boom', () => {
    const sim = new HelicopterSim(HELI_450_FLYBAR, new Wind());
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    sim.state.pos.y = 60;
    sim.state.onGround = false;
    ctl.collective = -0.4; // pushing negative: the disc pulls the other way
    run(sim, ctl, 1);
    ctl.aileron = 1; // and a big cyclic demand
    run(sim, ctl, 1.5);
    expect(sim.state.crashed).toBe(true);
    expect(sim.state.crashReason).toContain('Boom strike');
    // A flybarless head takes the same abuse.
    const sim3 = new HelicopterSim(HELI_450, new Wind());
    const ctl3 = neutralFrame();
    ctl3.flightMode = 1;
    ctl3.collective = -0.05;
    run(sim3, ctl3, 25);
    sim3.state.pos.y = 80;
    sim3.state.onGround = false;
    ctl3.collective = -0.4;
    run(sim3, ctl3, 1);
    ctl3.aileron = 1;
    run(sim3, ctl3, 1.0);
    expect(sim3.state.crashed).toBe(false);
    // The same cyclic with a loaded disc is a normal roll.
    const sim2 = new HelicopterSim(HELI_450_FLYBAR, new Wind());
    const ctl2 = neutralFrame();
    ctl2.flightMode = 1;
    ctl2.collective = -0.05;
    run(sim2, ctl2, 25);
    sim2.state.pos.y = 60;
    sim2.state.onGround = false;
    ctl2.collective = 0.5;
    run(sim2, ctl2, 1);
    ctl2.aileron = 1;
    run(sim2, ctl2, 0.6);
    expect(sim2.state.crashed).toBe(false);
  });
});
