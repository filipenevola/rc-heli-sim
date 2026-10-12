import { describe, expect, it } from 'vitest';
import { FlightStats, debriefHtml, landingWord, stickWord } from './debrief';
import { HelicopterSim, PHYSICS_DT } from '../sim/physics';
import { HELI_450 } from '../sim/heli-model';
import { Wind } from '../sim/wind';
import { neutralFrame } from '../input/types';

function run(sim: HelicopterSim, ctl: ReturnType<typeof neutralFrame>, seconds: number, stats?: FlightStats) {
  const n = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < n; i++) {
    sim.step(ctl);
    stats?.update(sim, PHYSICS_DT);
  }
}

describe('flight debrief', () => {
  it('grades landings by sink rate', () => {
    expect(landingWord(0.1)).toBe('greaser');
    expect(landingWord(0.4)).toBe('soft');
    expect(landingWord(1.0)).toBe('firm');
    expect(landingWord(2.0)).toBe('hard');
  });

  it('records the touchdown speed and peaks over a flight', () => {
    const sim = new HelicopterSim(HELI_450, new Wind());
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    sim.state.pos.y = 6;
    sim.state.onGround = false;
    const stats = new FlightStats();
    stats.begin(sim);
    ctl.collective = 0.42;
    run(sim, ctl, 2, stats);
    ctl.collective = 0.25; // let it sink
    for (let i = 0; i < 20000 && !sim.state.onGround; i++) {
      sim.step(ctl);
      stats.update(sim, PHYSICS_DT);
    }
    expect(sim.state.onGround).toBe(true);
    expect(sim.state.touchdownSpeed).toBeGreaterThan(0.2);
    expect(sim.state.touchdownSpeed).toBeLessThan(6);
    // Above ~2.2 m/s the skids fold; below, it is just a firm landing.
    expect(sim.state.crashed).toBe(sim.state.touchdownSpeed > 2.8);
    stats.trick('hover-30');
    const d = stats.end(sim, 12, false)!;
    expect(d.maxAltitude).toBeGreaterThan(5.5);
    expect(d.maxG).toBeGreaterThan(1);
    expect(d.touchdown).toBe(sim.state.touchdownSpeed);
    const html = debriefHtml(d, (s) => `${s}s`, (id) => id.toUpperCase());
    expect(html).toContain('Clean flight: 12s');
    expect(html).toContain('Landing:');
    expect(html).toContain('HOVER-30');
    const crashed = debriefHtml({ ...d, crashed: true, crashReason: 'Blade strike' }, (s) => `${s}s`, (id) => id);
    expect(crashed).toContain('Blade strike');
    expect(crashed).not.toContain('Landing:');
  });

  it('reads the stick work: a steady hand is calm, a nervous one is chasing', () => {
    const sim = new HelicopterSim(HELI_450, new Wind());
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    sim.state.pos.y = 6;
    sim.state.onGround = false;
    ctl.collective = 0.4;
    const calm = new FlightStats();
    calm.begin(sim);
    for (let i = 0; i < 15 * 60; i++) {
      ctl.aileron = 0.05 * Math.sin(i / 120); // one slow, smooth correction every ~12 s
      sim.step(ctl, 1 / 60);
      calm.update(sim, 1 / 60, ctl);
    }
    const c = calm.end(sim, 15, false)!;
    expect(stickWord(c.reversalsPerMin!, c.stickRate!)).toBe('calm');
    const nervous = new FlightStats();
    nervous.begin(sim);
    for (let i = 0; i < 15 * 60; i++) {
      ctl.aileron = 0.4 * Math.sign(Math.sin(i / 4)); // a reversal every ~0.2 s
      ctl.elevator = 0.3 * Math.sin(i / 3);
      sim.step(ctl, 1 / 60);
      nervous.update(sim, 1 / 60, ctl);
    }
    const n = nervous.end(sim, 15, false)!;
    expect(n.reversalsPerMin!).toBeGreaterThan(90);
    expect(stickWord(n.reversalsPerMin!, n.stickRate!)).toBe('chasing');
    const html = debriefHtml(n, (s) => `${s}s`, (id) => id);
    expect(html).toContain('chasing');
    expect(html).toContain('reversals/min');
  });
});
