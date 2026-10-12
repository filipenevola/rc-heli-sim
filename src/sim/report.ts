import { G, HelicopterSim, PHYSICS_DT } from './physics';
import type { HeliModel } from './heli-model';
import { RHO, solveRotor, type RotorResult } from './rotor';
import { Wind } from './wind';
import { World } from './world';
import { neutralFrame } from '../input/types';
import { Autopilot } from '../game/autopilot';

/**
 * The numbers a rotorcraft engineer would check first, computed from the same rotor model the sim flies.
 * Shown in the manual so the physics can be compared with published figures for real models of each class.
 */
export interface PhysicsReport {
  model: string;
  massKg: number;
  /** Rotor disc area, m², and disc loading, N/m². */
  discAreaM2: number;
  discLoading: number;
  /** Tip speed at the Idle-Up 1 head speed, m/s. */
  tipSpeed: number;
  headRpm: number;
  /** Rotor solidity and blade loading coefficient CT/σ in the hover. */
  solidity: number;
  ctSigma: number;
  /** Collective pitch that hovers (flown, with the fuselage download), degrees; and the rotor-alone trim. */
  hoverPitchDeg: number;
  rotorTrimPitchDeg: number;
  /** Momentum-theory induced velocity through the disc in the hover, m/s (the VRS reference speed). */
  inducedVelocity: number;
  /** Shaft power the main rotor needs to hover, W, and the ideal (induced-only) power. */
  hoverRotorPowerW: number;
  idealPowerW: number;
  figureOfMerit: number;
  /** Power drawn in the hover as flown (motor electrical, or engine shaft for nitro): tail and drive losses included, W. */
  hoverTotalPowerW: number;
  /** Hover endurance on the pack / tank, minutes. */
  hoverEnduranceMin: number;
  /** Steady vertical climb at full collective in Idle-Up 1, m/s (flown in the sim). */
  maxClimb: number;
  /** Vertical autorotation: steady sink at collective bottom with the motor off, m/s, and the head speed it settles at, fraction of Idle-Up 1. */
  autoSink: number;
  autoHeadSpeedFrac: number;
}

const blank = (): RotorResult => ({ thrust: 0, torque: 0, hForce: 0, lambda: 0, mu: 0, vi: 0, vrs: 0, stall: 0, lambdaIState: Number.NaN });

/** Analytic part: trim the rotor for hover with the blade-element/momentum solver. */
function hoverTrim(model: HeliModel, omega: number): { thetaDeg: number; torque: number; vi: number } {
  const need = model.mass * G;
  let lo = 0;
  let hi = 0.3;
  const out = blank();
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    out.lambdaIState = Number.NaN;
    solveRotor(model.rotor, mid, 0, 0, omega, out);
    if (out.thrust < need) lo = mid;
    else hi = mid;
  }
  const theta = (lo + hi) / 2;
  out.lambdaIState = Number.NaN;
  solveRotor(model.rotor, theta, 0, 0, omega, out);
  return { thetaDeg: (theta * 180) / Math.PI, torque: out.torque, vi: out.vi };
}

/** Flown part: a trimmed hover, a full-collective climb and a vertical autorotation, each a few seconds of the real sim. */
function flown(model: HeliModel): { hoverPitchDeg: number; hoverPowerW: number; maxClimb: number; autoSink: number; autoHeadSpeedFrac: number } {
  const sim = new HelicopterSim(model, new Wind(), new World());
  sim.assist = 'attitude';
  const ctl = neutralFrame();
  ctl.flightMode = 1;
  // Hover: the demo pilot holds 10 m for 8 s; the last 2 s give the trimmed collective and the power draw
  // (fuselage download, tail rotor and drive losses included, as the battery sees them).
  sim.resetInAir(10);
  const ap = new Autopilot(sim);
  ap.setMode(1);
  let pitchSum = 0;
  let powerSum = 0;
  let hn = 0;
  const frameSteps = Math.round(1 / 60 / PHYSICS_DT);
  for (let f = 0; f < 8 * 60; f++) {
    const c = ap.goTo({ x: 0, y: 10, z: -6 }, 0);
    for (let i = 0; i < frameSteps; i++) sim.step(c);
    if (f >= 6 * 60) { pitchSum += sim.telemetry.collectiveDeg; powerSum += sim.telemetry.motorPower; hn++; }
  }
  const hoverPitchDeg = pitchSum / hn;
  const hoverPowerW = powerSum / hn;
  // Climb: from a hover at 10 m, collective to the top for 4 s; take the last second's mean vertical speed.
  sim.resetInAir(10);
  ctl.collective = 1;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < 4 / PHYSICS_DT; i++) {
    sim.step(ctl);
    if (i > 3 / PHYSICS_DT) { sum += sim.state.vel.y; n++; }
  }
  const maxClimb = sum / n;
  // Autorotation: from 150 m, hold on and collective at the bottom; after 6 s the sink and head speed are steady.
  sim.resetInAir(150);
  ctl.collective = -1;
  ctl.throttleHold = true;
  sum = 0;
  n = 0;
  let rpmSum = 0;
  for (let i = 0; i < 7 / PHYSICS_DT; i++) {
    sim.step(ctl);
    if (i > 6 / PHYSICS_DT) { sum += sim.state.vel.y; rpmSum += sim.state.rotorOmega; n++; }
  }
  return { hoverPitchDeg, hoverPowerW, maxClimb, autoSink: -sum / n, autoHeadSpeedFrac: rpmSum / n / model.headspeeds[1] };
}

export function physicsReport(model: HeliModel): PhysicsReport {
  const r = model.rotor;
  const omega = model.headspeeds[1];
  const area = Math.PI * r.radius * r.radius;
  const thrust = model.mass * G;
  const trim = hoverTrim(model, omega);
  const tip = omega * r.radius;
  const solidity = (r.blades * r.chord) / (Math.PI * r.radius);
  const ct = thrust / (RHO * area * tip * tip);
  const idealPowerW = thrust * Math.sqrt(thrust / (2 * RHO * area));
  const hoverRotorPowerW = trim.torque * omega;
  const f = flown(model);
  const hoverTotalPowerW = f.hoverPowerW;
  const energyWh = model.power === 'nitro' ? model.batteryWh * 0.9 : model.batteryWh; // fuel: ml at ~0.9 Wh useful each on a glow engine
  return {
    model: model.name,
    massKg: model.mass,
    discAreaM2: area,
    discLoading: thrust / area,
    tipSpeed: tip,
    headRpm: (omega * 60) / (2 * Math.PI),
    solidity,
    ctSigma: ct / solidity,
    hoverPitchDeg: f.hoverPitchDeg,
    rotorTrimPitchDeg: trim.thetaDeg,
    inducedVelocity: trim.vi,
    hoverRotorPowerW,
    idealPowerW,
    figureOfMerit: idealPowerW / hoverRotorPowerW,
    hoverTotalPowerW,
    hoverEnduranceMin: (energyWh * 60) / hoverTotalPowerW,
    maxClimb: f.maxClimb,
    autoSink: f.autoSink,
    autoHeadSpeedFrac: f.autoHeadSpeedFrac,
  };
}
