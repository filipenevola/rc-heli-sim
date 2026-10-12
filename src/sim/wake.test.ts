import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from './physics';
import { HELI_450 } from './heli-model';
import { Wind } from './wind';
import { neutralFrame } from '../input/types';
import { v3 } from './math';

function run(sim: HelicopterSim, ctl: ReturnType<typeof neutralFrame>, seconds: number) {
  const n = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < n; i++) sim.step(ctl);
}

/** Hover in a steady headwind of `v` m/s (same airflow as forward flight at v), attitude held level. */
function hoverInWind(v: number) {
  const wind = new Wind();
  wind.speed = v;
  wind.fromDeg = 0; // from the front: the airflow of forward flight
  wind.gustiness = 0;
  const sim = new HelicopterSim(HELI_450, wind);
  const ctl = neutralFrame();
  ctl.flightMode = 1;
  ctl.collective = -0.05;
  run(sim, ctl, 25);
  sim.state.pos.y = 10;
  sim.state.onGround = false;
  sim.assist = 'attitude';
  ctl.collective = 0.4;
  run(sim, ctl, 3);
  return sim;
}

describe('main-rotor wake at the tail', () => {
  it('misses the tail in a hover, hits it in slow forward flight, passes it at speed', () => {
    expect(hoverInWind(0).telemetry.wake).toBeLessThan(0.05);
    expect(hoverInWind(3).telemetry.wake).toBeGreaterThan(0.3);
    expect(hoverInWind(6).telemetry.wake).toBeLessThan(hoverInWind(3).telemetry.wake);
    expect(hoverInWind(3).state.crashed).toBe(false);
  });

  it('is a nose-up disturbance (download on the stabiliser) when the wake arrives', () => {
    // Trimmed hover in calm air, rate mode; then the wind steps to 3 m/s from the front and we read the
    // pitch moment direction over the first moments: nose up (positive pitch rate about +x).
    const wind = new Wind();
    wind.gustiness = 0;
    const sim = new HelicopterSim(HELI_450, wind);
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    sim.state.pos.y = 10;
    sim.state.onGround = false;
    ctl.collective = 0.4;
    run(sim, ctl, 1);
    sim.state.vel = v3();
    sim.state.omega = v3();
    wind.speed = 3;
    wind.fromDeg = 0;
    let sumPitchRate = 0;
    for (let i = 0; i < 300; i++) {
      sim.step(ctl);
      sumPitchRate += sim.state.omega.x;
    }
    expect(sim.telemetry.wake).toBeGreaterThan(0.1);
    expect(sumPitchRate / 300).toBeGreaterThan(0);
  });
});

describe('skid friction', () => {
  it('a resting heli slides farther along its skids than across them', () => {
    function shove(dir: 'along' | 'across') {
      const sim = new HelicopterSim(HELI_450, new Wind());
      const ctl = neutralFrame();
      run(sim, ctl, 1); // settle on the skids, rotor stopped
      const s = sim.state;
      if (dir === 'along') s.vel.z = 1.5;
      else s.vel.x = 1.5;
      const x0 = s.pos.x;
      const z0 = s.pos.z;
      run(sim, ctl, 2);
      return Math.hypot(s.pos.x - x0, s.pos.z - z0);
    }
    const along = shove('along');
    const across = shove('across');
    expect(along).toBeGreaterThan(across * 1.3);
    expect(across).toBeGreaterThan(0.05);
  });
});
