import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from './physics';
import { HELI_250, HELI_450 } from './heli-model';
import { Wind } from './wind';
import { buildGym, buildSite } from './world';
import { neutralFrame } from '../input/types';

function run(sim: HelicopterSim, ctl: ReturnType<typeof neutralFrame>, seconds: number) {
  const n = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < n; i++) sim.step(ctl);
}

describe('indoor gym', () => {
  it('has walls, a ceiling, bleachers, hoops and two landing targets', () => {
    const { layout, world } = buildGym();
    expect(layout.site).toBe('gym');
    expect(layout.hall?.height).toBe(12);
    expect(layout.platforms.map((p) => p.id)).toEqual(['mat', 'vault']);
    expect(world.windObstacles().length).toBeGreaterThan(0);
    expect(buildSite('field').layout.site).toBe('field');
  });

  it('a micro climbing into the ceiling crashes; one hovering under it does not', () => {
    const { world } = buildGym();
    const up = new HelicopterSim(HELI_250, new Wind(), world);
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(up, ctl, 20);
    up.state.pos.y = 9;
    up.state.onGround = false;
    ctl.collective = 0.9; // full climb into the 12 m ceiling
    run(up, ctl, 4);
    expect(up.state.crashed).toBe(true);
    expect(up.state.crashReason).toMatch(/ceiling/);
    const hover = new HelicopterSim(HELI_250, new Wind(), world);
    const c2 = neutralFrame();
    c2.flightMode = 1;
    c2.collective = -0.05;
    run(hover, c2, 20);
    hover.state.pos.y = 4;
    hover.state.onGround = false;
    c2.collective = 0.4;
    run(hover, c2, 3);
    expect(hover.state.crashed).toBe(false);
  });

  it('flying a 450 sideways into the wall is a crash', () => {
    const { world } = buildGym();
    const sim = new HelicopterSim(HELI_450, new Wind(), world);
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    sim.state.pos.y = 3;
    sim.state.pos.x = 15;
    sim.state.onGround = false;
    sim.state.vel.x = 6;
    ctl.collective = 0.4;
    run(sim, ctl, 2);
    expect(sim.state.crashed).toBe(true);
    expect(sim.state.crashReason).toMatch(/wall|bleachers/);
  });
});
