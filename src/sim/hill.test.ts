import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from './physics';
import { HELI_450 } from './heli-model';
import { Wind } from './wind';
import { HILL_TERRAIN, buildHill, buildSite } from './world';
import { neutralFrame } from '../input/types';
import { qFromAxisAngle, qmul } from './math';

function run(sim: HelicopterSim, ctl: ReturnType<typeof neutralFrame>, seconds: number) {
  const n = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < n; i++) sim.step(ctl);
}

/** Put a spooled-down heli at rest on the terrain with the given heading, skids just touching. */
function placeOnSlope(sim: HelicopterSim, x: number, z: number, yaw: number) {
  const s = sim.state;
  const skid = -Math.min(...sim.model.contacts.filter((c) => c.kind === 'skid').map((c) => c.p.y));
  const n = sim.world.groundNormal(x, z, { x: 0, y: 1, z: 0 });
  // Orientation: yaw about y, then tilt the body so its up vector matches the ground normal.
  const yawQ = qFromAxisAngle({ x: 0, y: 1, z: 0 }, yaw);
  const tilt = Math.acos(Math.min(1, n.y));
  const al = Math.hypot(n.z, n.x) || 1;
  const tiltQ = qFromAxisAngle({ x: n.z / al, y: 0, z: -n.x / al }, tilt);
  s.ori = qmul(tiltQ, yawQ);
  s.pos = { x, y: HILL_TERRAIN.heightAt(x, z) + skid / n.y + 0.01, z };
  s.vel = { x: 0, y: 0, z: 0 };
  s.omega = { x: 0, y: 0, z: 0 };
}

describe('hillside terrain', () => {
  it('is flat at the pad, 10° on the slope mark and 20° on the bank mark', () => {
    const { layout, world } = buildHill();
    expect(layout.site).toBe('hill');
    expect(buildSite('hill').layout.site).toBe('hill');
    expect(world.groundAt(0, -6)).toBe(0);
    expect(world.slopeDeg(0, -6)).toBeLessThan(0.5);
    const slope = layout.hill!.marks[0];
    const bank = layout.hill!.marks[1];
    expect(world.groundAt(slope.x, slope.z)).toBeGreaterThan(2);
    expect(world.slopeDeg(slope.x, slope.z)).toBeGreaterThan(9);
    expect(world.slopeDeg(slope.x, slope.z)).toBeLessThan(11);
    expect(world.slopeDeg(bank.x, bank.z)).toBeGreaterThan(18.5);
    expect(world.slopeDeg(bank.x, bank.z)).toBeLessThan(21);
    expect(world.groundTargets.map((g) => g.id)).toEqual(['slope', 'bank']);
  });

  it('a heli set down across the 10° slope stays put and counts as landed on the mark', () => {
    const { world } = buildHill();
    const sim = new HelicopterSim(HELI_450, new Wind(), world);
    const ctl = neutralFrame();
    ctl.collective = -1;
    placeOnSlope(sim, 0, -34, Math.PI / 2); // nose along the contour (east), skids across the fall line
    const start = { ...sim.state.pos };
    run(sim, ctl, 4);
    expect(sim.state.crashed).toBe(false);
    expect(Math.hypot(sim.state.pos.x - start.x, sim.state.pos.z - start.z)).toBeLessThan(0.05);
    expect(sim.state.landed?.target.id).toBe('slope');
    expect(sim.telemetry.altitude).toBeLessThan(0.2);
  });

  it('a heli set down nose-uphill on the 20° bank slides down on its skids', () => {
    const { world } = buildHill();
    const sim = new HelicopterSim(HELI_450, new Wind(), world);
    const ctl = neutralFrame();
    ctl.collective = -1;
    placeOnSlope(sim, 40, -8, -Math.PI / 2); // nose pointing uphill (+x): skids along the fall line
    const start = { ...sim.state.pos };
    run(sim, ctl, 4);
    expect(sim.state.pos.x).toBeLessThan(start.x - 0.5);
    const across = new HelicopterSim(HELI_450, new Wind(), world);
    placeOnSlope(across, 40, -8, 0); // nose along the contour: skids across the fall line hold
    const s0 = { ...across.state.pos };
    run(across, ctl, 4);
    expect(across.state.crashed).toBe(false);
    expect(Math.hypot(across.state.pos.x - s0.x, across.state.pos.z - s0.z)).toBeLessThan(0.1);
    expect(across.state.landed?.target.id).toBe('bank');
  });

  it('wind climbing the slope has upwash on the windward face and none over the flat', () => {
    const wind = new Wind();
    wind.speed = 5;
    wind.fromDeg = 180; // from the south, blowing toward -z: up the 10° slope
    wind.gustiness = 0;
    wind.terrain = HILL_TERRAIN;
    const onSlope = wind.at({ x: 0, y: HILL_TERRAIN.heightAt(0, -40) + 3, z: -40 }, 10);
    const flat = wind.at({ x: 0, y: 3, z: 0 }, 10);
    expect(onSlope.y).toBeGreaterThan(0.4);
    expect(Math.abs(flat.y)).toBeLessThan(0.05);
  });

  it('a hover over the slope reports height above the ground, and a rotor into the hillside is a blade strike', () => {
    const { world } = buildHill();
    const sim = new HelicopterSim(HELI_450, new Wind(), world);
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    sim.state.pos = { x: 0, y: HILL_TERRAIN.heightAt(0, -60) + 1, z: -60 };
    sim.state.onGround = false;
    ctl.collective = 0.45;
    run(sim, ctl, 0.2);
    expect(sim.telemetry.altitude).toBeLessThan(1.6);
    expect(sim.telemetry.altitude).toBeGreaterThan(0.3);
    // Fly straight into the rising ground at speed.
    sim.state.vel = { x: 0, y: 0, z: -8 };
    sim.state.pos = { x: 0, y: HILL_TERRAIN.heightAt(0, -60) + 0.5, z: -60 };
    run(sim, ctl, 2);
    expect(sim.state.crashed).toBe(true);
  });
});

describe('dynamic rollover', () => {
  it('pushing the cyclic into the hill with a skid planted rolls the heli over, and says so', () => {
    const { world } = buildHill();
    const sim = new HelicopterSim(HELI_450, new Wind(), world);
    sim.assist = 'rate';
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    placeOnSlope(sim, 40, -8, 0); // across the 20° bank, uphill skid on the right (+x)
    run(sim, ctl, 8); // spool up on the slope
    ctl.collective = 0.15; // light on the skids
    ctl.aileron = 1; // full cyclic into the hill
    run(sim, ctl, 3);
    expect(sim.state.crashed).toBe(true);
    expect(sim.state.crashReason).toMatch(/Dynamic rollover/);
  });
});
