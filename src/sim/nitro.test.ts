import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from './physics';
import { buildCustomModel, normalizeSpec } from './custom-model';
import { Wind } from './wind';
import { neutralFrame } from '../input/types';

function run(sim: HelicopterSim, ctl: ReturnType<typeof neutralFrame>, seconds: number) {
  const n = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < n; i++) sim.step(ctl);
}

const nitro50 = () => buildCustomModel(normalizeSpec({ name: 'Nitro .50', bladeMm: 600, massG: 3300, cells: 2, mah: 2000, headspeedRpm: [1500, 1750, 1900], power: 'nitro', tankMl: 350 }));

describe('nitro engine', () => {
  it('spools through the clutch, holds head speed, hovers and burns fuel with load', () => {
    const sim = nitro50() && new HelicopterSim(nitro50(), new Wind());
    expect(sim.model.power).toBe('nitro');
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    expect(sim.telemetry.headspeedRpm).toBeGreaterThan(1600);
    const fuel0 = sim.telemetry.battery;
    sim.state.pos.y = 8;
    sim.state.onGround = false;
    ctl.collective = 0.45;
    run(sim, ctl, 20);
    expect(sim.state.crashed).toBe(false);
    expect(sim.state.pos.y).toBeGreaterThan(2);
    const burnt = fuel0 - sim.telemetry.battery;
    expect(burnt).toBeGreaterThan(0.01); // ~0.5 ml/s of a 350 ml tank over 20 s
    expect(burnt).toBeLessThan(0.1);
  });

  it('throttle hold drops the clutch: the rotor freewheels while the engine idles, then the head comes back', () => {
    const sim = new HelicopterSim(nitro50(), new Wind());
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    sim.state.pos.y = 90;
    sim.state.onGround = false;
    ctl.throttleHold = true;
    ctl.collective = -0.6;
    run(sim, ctl, 2);
    expect(sim.telemetry.motorPower).toBeLessThan(1);
    expect(sim.telemetry.headspeedRpm).toBeGreaterThan(900); // autorotating, not stopped
    ctl.throttleHold = false;
    ctl.collective = 0.2;
    run(sim, ctl, 4);
    expect(sim.telemetry.headspeedRpm).toBeGreaterThan(1100); // climbing back through the governor ramp
  });

  it('an empty tank stops the engine', () => {
    const sim = new HelicopterSim(nitro50(), new Wind());
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    sim.state.batteryWh = 0.01;
    sim.state.pos.y = 20;
    sim.state.onGround = false;
    ctl.collective = 0.4;
    run(sim, ctl, 3);
    expect(sim.telemetry.battery).toBe(0);
    expect(sim.telemetry.motorPower).toBeLessThan(1);
  });
});

describe('nitro needle', () => {
  const hover = (needlePct: number, seconds: number) => {
    const m = { ...nitro50(), needle: needlePct / 100 };
    const sim = new HelicopterSim(m, new Wind());
    sim.assist = 'attitude';
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    sim.state.pos.y = 8;
    sim.state.onGround = false;
    ctl.collective = 0.45;
    const fuel0 = sim.telemetry.battery;
    run(sim, ctl, seconds);
    return { sim, burnt: fuel0 - sim.telemetry.battery };
  };

  it('right on the needle the engine stays cool; rich burns more fuel', () => {
    const ok = hover(100, 20);
    expect(ok.sim.telemetry.engineHeat).toBe(0);
    expect(ok.sim.state.engineDead).toBe(false);
    const rich = hover(125, 20);
    expect(rich.sim.state.engineDead).toBe(false);
    expect(rich.burnt).toBeGreaterThan(ok.burnt * 1.15);
  });

  it('a lean needle under load heats the engine until it quits, and the rotor winds down', () => {
    const lean = hover(85, 45);
    expect(lean.sim.state.engineDead).toBe(true);
    expect(lean.sim.telemetry.headspeedRpm).toBeLessThan(1500);
  });
});
