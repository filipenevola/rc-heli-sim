import { describe, expect, it } from 'vitest';
import { HelicopterSim, PHYSICS_DT } from './physics';
import { HELI_450_FLYBAR, withTrainingGear } from './heli-model';
import { Wind } from './wind';
import { neutralFrame } from '../input/types';

function run(sim: HelicopterSim, ctl: ReturnType<typeof neutralFrame>, seconds: number) {
  const n = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < n; i++) sim.step(ctl);
}

/** The classic beginner tip-over: skids barely on the grass, a fistful of aileron, then the collective dumped. */
function sloppyLanding(gear: boolean) {
  const model = gear ? withTrainingGear(HELI_450_FLYBAR) : HELI_450_FLYBAR;
  const sim = new HelicopterSim(model, new Wind());
  const ctl = neutralFrame();
  ctl.flightMode = 1;
  ctl.collective = -0.05;
  run(sim, ctl, 25);
  sim.state.pos.y = 1.0;
  sim.state.onGround = false;
  ctl.collective = 0.05;
  run(sim, ctl, 0.5);
  ctl.aileron = 1;
  run(sim, ctl, 0.5);
  ctl.aileron = 0;
  ctl.collective = -0.6;
  run(sim, ctl, 4);
  return sim;
}

describe('training gear', () => {
  it('adds mass, drag and four wide contact points', () => {
    const g = withTrainingGear(HELI_450_FLYBAR);
    expect(g.mass).toBeGreaterThan(HELI_450_FLYBAR.mass);
    expect(g.contacts.length).toBe(HELI_450_FLYBAR.contacts.length + 4);
    expect(g.trainingGear).toBe(true);
    expect(HELI_450_FLYBAR.trainingGear).toBeUndefined();
  });

  it('still hovers (the extra weight is within the rotor margin)', () => {
    const sim = new HelicopterSim(withTrainingGear(HELI_450_FLYBAR), new Wind());
    const ctl = neutralFrame();
    ctl.flightMode = 1;
    ctl.collective = -0.05;
    run(sim, ctl, 25);
    sim.state.pos.y = 5;
    sim.state.onGround = false;
    ctl.collective = 0.45;
    run(sim, ctl, 3);
    expect(sim.state.crashed).toBe(false);
    expect(sim.state.pos.y).toBeGreaterThan(2);
  });

  it('a fistful of aileron on the ground tips a bare heli over but not one on training gear', () => {
    const bare = sloppyLanding(false);
    const geared = sloppyLanding(true);
    expect(bare.state.crashed).toBe(true);
    expect(bare.state.crashReason).toContain('Blade strike');
    expect(geared.state.crashed).toBe(false);
  });
});
