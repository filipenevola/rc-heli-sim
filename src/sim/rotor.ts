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
  const tip = Math.max(omega * r.radius, 1e-3);
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
  let lambdaI = Math.sign(ctTheta) * Math.sqrt(Math.abs(ctTheta) / 2 + 1e-6);
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
  const ct = ctTheta - (ke * (lambdaI + lambdaC)) / 2;
  const lambda = lambdaI + lambdaC;
  const dyn = RHO * area * tip * tip;
  const cq = ct * lambda + (sigma * r.cd0 * (1 + 4.6 * mu2)) / 8;
  out.thrust = dyn * ct;
  out.torque = dyn * r.radius * cq;
  out.hForce = dyn * ((sigma * r.cd0 * mu) / 4 + Math.abs(ct) * mu * 0.5);
  out.lambda = lambda;
  out.mu = mu;
  out.vi = lambdaI * tip;
  return out;
}

export const emptyRotorResult = (): RotorResult => ({ thrust: 0, torque: 0, hForce: 0, lambda: 0, mu: 0, vi: 0 });
