import type { RotorParams } from './heli-model';

export const RHO = 1.225; // sea level air density, kg/m^3

export interface RotorResult {
  /** Thrust along the rotor normal, N. */
  thrust: number;
  /** Shaft torque required (positive = rotor absorbs power; negative = autorotation drives the rotor), N m. */
  torque: number;
  /** In-plane "H-force" drag magnitude opposing in-plane airflow, N. */
  hForce: number;
  /** Total inflow ratio through the disc (positive = flow downward through the disc). */
  lambda: number;
  /** Advance ratio. */
  mu: number;
  /** Induced velocity through the disc, m/s (positive = down through the disc). */
  vi: number;
  /** 0..1 how deep into the vortex-ring state the rotor is (settling with power). */
  vrs: number;
  /** 0..1 how much of the blade is stalled (collective too high for the head speed). */
  stall: number;
}

/**
 * Combined blade-element / momentum-theory rotor model (uniform inflow, Glauert).
 * This is the standard textbook model (Johnson / Leishman / Padfield) and captures what matters
 * for training feel: collective-to-thrust with inflow, translational lift, power/torque that goes
 * negative in descent (autorotation), and tail rotor behaviour under yaw rate.
 *
 * @param theta   blade collective pitch, rad
 * @param vAlong  air velocity component along the thrust axis (positive = climbing into the thrust direction), m/s
 * @param vPlane  in-plane airspeed magnitude, m/s
 * @param omega   rotor angular speed, rad/s
 */
export function solveRotor(r: RotorParams, theta: number, vAlong: number, vPlane: number, omega: number, out: RotorResult): RotorResult {
  // Floor the tip speed at 1 m/s: a stopped rotor then yields negligible forces and finite inflow ratios,
  // instead of dividing airspeed by ~zero and feeding nonsense into the flapping equations.
  const tip = Math.max(omega * r.radius, 1.0);
  const area = Math.PI * r.radius * r.radius;
  const sigma = (r.blades * r.chord) / (Math.PI * r.radius);
  const mu = vPlane / tip;
  const lambdaC = vAlong / tip; // climb inflow ratio
  const mu2 = mu * mu;
  const k = (sigma * r.liftSlope) / 2;

  // Newton iteration on the induced inflow: f(x) = 2 x sqrt(mu^2 + (x + lambdaC)^2) - C_T(x) = 0.
  // (A plain fixed-point iteration diverges for high-solidity rotors such as tail rotors.)
  const ke = k * r.efficiency;
  const ctTheta = ke * theta * (1 / 3 + mu2 / 2);
  // Exact hover induced inflow for this collective (2 l^2 + (ke/2) l - ctTheta = 0), used as the VRS reference and
  // as the Newton starting point.
  const b = ke / 2;
  const lambdaIHover = ctTheta > 0 ? (-b + Math.sqrt(b * b + 8 * ctTheta)) / 4 : 0;
  let lambdaI = Math.sign(ctTheta) * Math.max(lambdaIHover, Math.sqrt(Math.abs(ctTheta) / 2 + 1e-6));
  for (let i = 0; i < 12; i++) {
    const lam = lambdaI + lambdaC;
    const S = Math.max(Math.sqrt(mu2 + lam * lam), 0.01);
    const ct = ctTheta - (ke * lam) / 2;
    const f = 2 * lambdaI * S - ct;
    const df = 2 * S + (2 * lambdaI * lam) / S + ke / 2;
    lambdaI -= f / Math.max(df, 1e-3);
    // Vortex-ring region: momentum theory breaks down; keep things bounded.
    if (lambdaI > 0.3) lambdaI = 0.3;
    if (lambdaI < -0.3) lambdaI = -0.3;
  }
  let ct = ctTheta - (ke * (lambdaI + lambdaC)) / 2;
  const lambda = lambdaI + lambdaC;
  const dyn = RHO * area * tip * tip;

  // Blade stall. Mean blade angle of attack (at the 3/4-radius station) is roughly theta - lambda/0.75.
  // Past ~13 deg the lift curve rolls over and drag climbs: pulling more collective at a low head speed
  // gives less thrust and bogs the rotor, which is exactly what bites beginners who "pull up" too hard.
  const alpha = Math.abs(theta - lambda / 0.75);
  const alphaStall = (13 * Math.PI) / 180;
  let stall = 0;
  let cdExtra = 0;
  if (alpha > alphaStall) {
    // Lift coefficient plateaus at the stall angle, then decays ~35% over the next 10 degrees (airfoil post-stall).
    stall = Math.min(1, (alpha - alphaStall) / ((10 * Math.PI) / 180));
    ct *= (alphaStall / alpha) * (1 - 0.5 * stall);
    cdExtra = 0.3 * stall * stall + 0.05 * stall; // separated flow drags hard
  }

  // Vortex ring state (settling with power): descending at roughly the induced velocity with little forward
  // speed, the rotor re-ingests its own wake. Thrust drops and gets rough; more collective makes it worse.
  // Momentum theory has no answer here, so this is the empirical envelope (Johnson): worst around Vz ~ -1.2 vi,
  // gone above ~0.3 mu or outside 0.4..1.8 vi of descent.
  let vrs = 0;
  if (lambdaC < 0 && lambdaIHover > 0.005) {
    const ratio = -lambdaC / lambdaIHover; // descent rate over the hover induced velocity
    const depth = Math.max(0, 1 - Math.abs(ratio - 1.1) / 0.7); // peaks at 1.1 vi, zero outside 0.4..1.8 vi
    const forward = Math.max(0, 1 - mu / 0.08); // forward flight blows the wake away (gone above ~8 m/s for a 450)
    vrs = depth * forward;
    ct *= 1 - 0.35 * vrs;
  }

  const cq = ct * lambda + (sigma * (r.cd0 + cdExtra) * (1 + 4.6 * mu2)) / 8;
  out.thrust = dyn * ct;
  out.torque = dyn * r.radius * cq;
  out.hForce = dyn * ((sigma * r.cd0 * mu) / 4 + Math.abs(ct) * mu * 0.5);
  out.lambda = lambda;
  out.mu = mu;
  out.vi = lambdaI * tip;
  out.vrs = vrs;
  out.stall = stall;
  return out;
}

export const emptyRotorResult = (): RotorResult => ({ thrust: 0, torque: 0, hForce: 0, lambda: 0, mu: 0, vi: 0, vrs: 0, stall: 0 });
