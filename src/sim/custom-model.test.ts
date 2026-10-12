import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from './physics';
import { buildCustomModel, normalizeSpec, rotorRadiusFromBlade } from './custom-model';
import { HELI_450, HELI_700 } from './heli-model';
import { Wind } from './wind';
import { neutralFrame } from '../input/types';

function run(sim: HelicopterSim, ctl: ReturnType<typeof neutralFrame>, seconds: number) {
  const n = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < n; i++) sim.step(ctl);
}

describe('custom helicopter from the numbers on the box', () => {
  it('a three-blade head makes more thrust at the same pitch and carries more rotor inertia', () => {
    const two = buildCustomModel(normalizeSpec({ bladeMm: 500, massG: 1900, cells: 6, mah: 3300, headspeedRpm: [1900, 2100, 2300], blades: 2 }));
    const three = buildCustomModel(normalizeSpec({ bladeMm: 500, massG: 1900, cells: 6, mah: 3300, headspeedRpm: [1900, 2100, 2300], blades: 3 }));
    expect(three.rotor.blades).toBe(3);
    expect(three.rotorInertia).toBeGreaterThan(two.rotorInertia);
    const hover = (m: typeof two) => {
      const sim = new HelicopterSim(m, new Wind());
      const ctl = neutralFrame();
      ctl.flightMode = 1;
      ctl.collective = -0.05;
      run(sim, ctl, 25);
      sim.state.pos.y = 8;
      sim.state.onGround = false;
      ctl.collective = 0.3;
      run(sim, ctl, 1.5);
      return sim.state.vel.y;
    };
    expect(hover(three)).toBeGreaterThan(hover(two));
  });

  it('reproduces the references at their own size', () => {
    const m450 = buildCustomModel(normalizeSpec({ bladeMm: 325, massG: 780, cells: 6, mah: 2200, headspeedRpm: [2500, 2750, 3000] }));
    expect(m450.rotor.radius).toBeCloseTo(HELI_450.rotor.radius, 1);
    expect(m450.maxMotorTorque).toBeCloseTo(HELI_450.maxMotorTorque, 0);
    const m700 = buildCustomModel(normalizeSpec({ bladeMm: 700, massG: 3400, cells: 12, mah: 5000, headspeedRpm: [1500, 1700, 1900] }));
    expect(m700.rotor.radius).toBeCloseTo(HELI_700.rotor.radius, 1);
    expect(m700.inertia.x).toBeCloseTo(HELI_700.inertia.x, 1);
  });

  it.each([
    ['380', 360, 1000, 4, 1300, [2800, 3100, 3300]],
    ['550', 550, 2500, 6, 4000, [1900, 2100, 2300]],
    ['600', 600, 3000, 12, 3300, [1700, 1900, 2100]],
    ['800', 800, 5200, 12, 5000, [1300, 1500, 1650]],
  ] as [string, number, number, number, number, [number, number, number]][])('a %s-class heli spools, hovers and lands', (_n, blade, massG, cells, mah, hs) => {
    const model = buildCustomModel(normalizeSpec({ name: 'test', bladeMm: blade, massG, cells, mah, headspeedRpm: hs }));
    expect(rotorRadiusFromBlade(blade)).toBeGreaterThan(0.1);
    const sim = new HelicopterSim(model, new Wind());
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    expect(sim.telemetry.headspeedRpm).toBeGreaterThan(0.9 * hs[1]);
    sim.state.pos.y = 8;
    sim.state.onGround = false;
    // Find a collective that holds height roughly: the hover stick should exist between 0.1 and 0.7.
    let hoverCol = -1;
    for (const col of [0.2, 0.3, 0.4, 0.5, 0.6]) {
      const probe = new HelicopterSim(model, new Wind());
      const c = neutralFrame();
      c.flightMode = 1;
      c.collective = -0.05;
      run(probe, c, 25);
      probe.state.pos.y = 8;
      probe.state.onGround = false;
      c.collective = col;
      run(probe, c, 2);
      if (probe.state.vel.y > -0.5) { hoverCol = col; break; }
    }
    expect(hoverCol).toBeGreaterThan(0);
    expect(hoverCol).toBeLessThan(0.7);
    ctl.collective = hoverCol;
    run(sim, ctl, 4);
    expect(sim.state.crashed).toBe(false);
    expect(sim.state.pos.y).toBeGreaterThan(2);
  });
});
