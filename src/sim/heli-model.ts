import type { V3 } from './math';

/**
 * Physical description of an RC helicopter. All SI units.
 * Body frame (matches three.js Object3D local axes): x = right, y = up, z = backward (forward is -z).
 */
export interface HeliModel {
  id: string;
  name: string;
  mass: number;
  /** Diagonal body inertia [Ixx (pitch, about right axis), Iyy (yaw), Izz (roll, about fore/aft axis)] */
  inertia: V3;

  rotor: RotorParams;
  /** Main rotor hub position relative to CG (body frame). */
  hubOffset: V3;
  /** Hub (head) stiffness: restoring moment per radian of tip-path-plane tilt. Rigid FBL heads are stiff. */
  hubStiffness: number;
  /** Lock number: ratio of aerodynamic to inertial blade forces. Sets how fast the TPP follows cyclic. */
  lockNumber: number;
  /** Max cyclic tip-path-plane command, rad. */
  maxCyclic: number;
  /** Rotor polar inertia (blades + head + motor referred to the main shaft), kg m^2. */
  rotorInertia: number;
  /** Rotor spins clockwise seen from above (true for nearly every RC heli). */
  clockwise: boolean;

  tail: RotorParams;
  /** Tail rotor hub position relative to CG. */
  tailOffset: V3;
  /** Tail gear ratio: tail rpm / main rpm. */
  tailGearRatio: number;
  maxTailPitch: number;

  /** Motor / engine. */
  maxMotorTorque: number;
  /** Usable pack energy, Wh (e.g. 3S 2200 mAh ≈ 24 Wh at 80% depth of discharge ≈ 19 Wh). */
  batteryWh: number;
  /** Governor headspeeds (rad/s) for Normal / Idle-Up 1 / Idle-Up 2. */
  headspeeds: [number, number, number];
  /** Governor spool-up rate, rad/s per second (soft start). */
  spoolRate: number;

  /** Collective pitch curves in degrees for stick -1..1, per flight mode. 5 points each. */
  pitchCurves: [number[], number[], number[]];

  /** Equivalent flat-plate drag areas (m^2) for airflow along body x / y / z. */
  dragArea: V3;
  /** Vertical fin area (yaw weathervane) and horizontal stabiliser area, m^2. */
  finArea: number;
  stabArea: number;

  /** Ground contact points in the body frame (skids, tail, nose, head). */
  contacts: ContactPoint[];

  /** Controller defaults: a modern flybarless (FBL) unit, or a mechanical flybar. */
  controller: ControllerParams;
  /** Training gear fitted (cross of rods with balls): rendered and part of the physics when true. */
  trainingGear?: boolean;
}

export interface RotorParams {
  radius: number;
  chord: number;
  blades: number;
  /** Lift curve slope per rad (typical symmetric RC blade ~5.5). */
  liftSlope: number;
  /** Profile drag coefficient. */
  cd0: number;
  /** Thrust efficiency: tip loss, root cutout, non-uniform inflow. ~0.8 */
  efficiency: number;
}

export interface ContactPoint {
  p: V3;
  /** Soft (skid wire) vs hard (canopy, blades) contact. Hard contacts beyond a speed threshold mean a crash. */
  kind: 'skid' | 'hard';
  /** Training-gear ball: supports the heli like a skid but is not required to sit on a landing target. */
  gear?: boolean;
}

export interface ControllerParams {
  /** 'fbl' = electronic 3-axis stabiliser in rate mode. 'flybar' = mechanical Bell-Hiller flybar, raw tail gyro only. */
  type: 'fbl' | 'flybar';
  /** Max commanded roll/pitch rate at full stick, rad/s. */
  cyclicRate: number;
  /** Max commanded yaw rate at full rudder, rad/s. */
  yawRate: number;
  cyclicP: number;
  cyclicI: number;
  yawP: number;
  yawI: number;
  /** Flybar follow time constant (s) and Bell/Hiller mixing ratio (0 = pure Hiller). */
  flybarTau: number;
  flybarBellRatio: number;
  /** Servo + linkage first-order lag, s. */
  servoTau: number;
  /** Rate-gyro anti-vibration low-pass time constant, s (0 = none). */
  gyroTau: number;
  /** Tail servo slew: seconds to cover its full throw (0 = unlimited). */
  tailThrowTime: number;
  /** Tail gyro + servo-frame transport delay, ms (whole milliseconds at the 1 kHz physics rate). */
  delayMs: number;
}

const rpm = (n: number) => (n * 2 * Math.PI) / 60;

/** 450-class electric (think T-Rex 450 / Blade 450). The classic trainer size. */
export const HELI_450: HeliModel = {
  id: '450-fbl',
  name: '450 Electric (flybarless)',
  mass: 0.78,
  inertia: { x: 0.0105, y: 0.0125, z: 0.0042 },
  rotor: { radius: 0.36, chord: 0.032, blades: 2, liftSlope: 5.5, cd0: 0.012, efficiency: 0.82 },
  hubOffset: { x: 0, y: 0.1, z: 0 },
  hubStiffness: 22,
  lockNumber: 4.2,
  maxCyclic: (10 * Math.PI) / 180,
  rotorInertia: 0.0045,
  clockwise: true,
  tail: { radius: 0.065, chord: 0.02, blades: 2, liftSlope: 5.5, cd0: 0.015, efficiency: 0.8 },
  tailOffset: { x: 0, y: 0.04, z: 0.52 },
  tailGearRatio: 4.7,
  maxTailPitch: (32 * Math.PI) / 180,
  maxMotorTorque: 2.4,
  batteryWh: 19,
  headspeeds: [rpm(2500), rpm(2750), rpm(3000)],
  spoolRate: 45,
  pitchCurves: [
    [-2, 2.5, 5.5, 8.5, 11],
    [-11, -5.5, 0, 5.5, 11],
    [-12, -6, 0, 6, 12],
  ],
  dragArea: { x: 0.022, y: 0.03, z: 0.012 },
  finArea: 0.0035,
  stabArea: 0.0025,
  contacts: [
    { p: { x: -0.085, y: -0.115, z: -0.16 }, kind: 'skid' },
    { p: { x: 0.085, y: -0.115, z: -0.16 }, kind: 'skid' },
    { p: { x: -0.085, y: -0.115, z: 0.14 }, kind: 'skid' },
    { p: { x: 0.085, y: -0.115, z: 0.14 }, kind: 'skid' },
    { p: { x: 0, y: -0.02, z: 0.56 }, kind: 'hard' }, // tail boom end
    { p: { x: 0, y: -0.03, z: -0.22 }, kind: 'hard' }, // nose
    { p: { x: 0, y: 0.13, z: 0 }, kind: 'hard' }, // rotor head
    { p: { x: 0, y: 0.1, z: 0.6 }, kind: 'hard' }, // tail fin top
  ],
  controller: {
    type: 'fbl',
    cyclicRate: (380 * Math.PI) / 180,
    yawRate: (520 * Math.PI) / 180,
    cyclicP: 0.015,
    cyclicI: 0.45,
    yawP: 0.27,
    yawI: 0.54,
    flybarTau: 0.14,
    flybarBellRatio: 0.45,
    servoTau: 0.018,
    gyroTau: 0.003,
    tailThrowTime: 0.08,
    delayMs: 3,
  },
};

/** Same airframe with a mechanical flybar: softer, more damped, slower. Good first trainer. */
export const HELI_450_FLYBAR: HeliModel = {
  ...HELI_450,
  id: '450-flybar',
  name: '450 Electric (flybar trainer)',
  hubStiffness: 12,
  lockNumber: 3.6,
  headspeeds: [rpm(2400), rpm(2600), rpm(2800)],
  controller: { ...HELI_450.controller, type: 'flybar', yawP: 0.24, yawI: 0.48 },
};

/** 700-class 3D machine. Heavier, more authority, higher blade tip speed. */
export const HELI_700: HeliModel = {
  id: '700-fbl',
  name: '700 Electric 3D (flybarless)',
  mass: 3.4,
  inertia: { x: 0.19, y: 0.24, z: 0.075 },
  rotor: { radius: 0.78, chord: 0.055, blades: 2, liftSlope: 5.2, cd0: 0.011, efficiency: 0.7 },
  hubOffset: { x: 0, y: 0.16, z: 0 },
  hubStiffness: 180,
  lockNumber: 5,
  maxCyclic: (11 * Math.PI) / 180,
  rotorInertia: 0.11,
  clockwise: true,
  tail: { radius: 0.145, chord: 0.035, blades: 2, liftSlope: 5.5, cd0: 0.014, efficiency: 0.8 },
  tailOffset: { x: 0, y: 0.06, z: 1.05 },
  tailGearRatio: 4.5,
  maxTailPitch: (30 * Math.PI) / 180,
  maxMotorTorque: 24,
  batteryWh: 190, // 12S 5000 mAh at 80%
  headspeeds: [rpm(1500), rpm(1700), rpm(1900)],
  spoolRate: 25,
  pitchCurves: [
    [-2, 2.5, 5.5, 8.5, 11],
    [-12, -6, 0, 6, 12],
    [-13, -6.5, 0, 6.5, 13],
  ],
  dragArea: { x: 0.08, y: 0.11, z: 0.045 },
  finArea: 0.012,
  stabArea: 0.009,
  contacts: [
    { p: { x: -0.16, y: -0.2, z: -0.3 }, kind: 'skid' },
    { p: { x: 0.16, y: -0.2, z: -0.3 }, kind: 'skid' },
    { p: { x: -0.16, y: -0.2, z: 0.26 }, kind: 'skid' },
    { p: { x: 0.16, y: -0.2, z: 0.26 }, kind: 'skid' },
    { p: { x: 0, y: -0.03, z: 1.12 }, kind: 'hard' },
    { p: { x: 0, y: -0.05, z: -0.42 }, kind: 'hard' },
    { p: { x: 0, y: 0.2, z: 0 }, kind: 'hard' },
    { p: { x: 0, y: 0.18, z: 1.18 }, kind: 'hard' },
  ],
  controller: {
    type: 'fbl',
    cyclicRate: (420 * Math.PI) / 180,
    yawRate: (560 * Math.PI) / 180,
    cyclicP: 0.015,
    cyclicI: 0.5,
    yawP: 0.255,
    yawI: 0.51,
    flybarTau: 0.16,
    flybarBellRatio: 0.45,
    servoTau: 0.02,
    gyroTau: 0.003,
    tailThrowTime: 0.08,
    delayMs: 3,
  },
};

/** 250-class collective-pitch micro (think Blade 230 S / 250 CFX): light, twitchy, flies in the garden. */
export const HELI_250: HeliModel = {
  id: '250-fbl',
  name: '250 Micro CP (flybarless)',
  mass: 0.21,
  inertia: { x: 0.0009, y: 0.0011, z: 0.00035 },
  rotor: { radius: 0.2, chord: 0.022, blades: 2, liftSlope: 5.3, cd0: 0.014, efficiency: 0.78 },
  hubOffset: { x: 0, y: 0.065, z: 0 },
  hubStiffness: 3.5,
  lockNumber: 3.8,
  maxCyclic: (11 * Math.PI) / 180,
  rotorInertia: 0.0005,
  clockwise: true,
  tail: { radius: 0.038, chord: 0.012, blades: 2, liftSlope: 5.3, cd0: 0.018, efficiency: 0.75 },
  tailOffset: { x: 0, y: 0.025, z: 0.3 },
  tailGearRatio: 4.5,
  maxTailPitch: (35 * Math.PI) / 180,
  maxMotorTorque: 0.45,
  batteryWh: 5.5, // 3S 800 mAh at 80%
  headspeeds: [rpm(3600), rpm(4000), rpm(4300)],
  spoolRate: 90,
  pitchCurves: [
    [-2, 2.5, 5.5, 8.5, 11],
    [-12, -6, 0, 6, 12],
    [-13, -6.5, 0, 6.5, 13],
  ],
  dragArea: { x: 0.008, y: 0.012, z: 0.005 },
  finArea: 0.0012,
  stabArea: 0.0009,
  contacts: [
    { p: { x: -0.05, y: -0.07, z: -0.09 }, kind: 'skid' },
    { p: { x: 0.05, y: -0.07, z: -0.09 }, kind: 'skid' },
    { p: { x: -0.05, y: -0.07, z: 0.08 }, kind: 'skid' },
    { p: { x: 0.05, y: -0.07, z: 0.08 }, kind: 'skid' },
    { p: { x: 0, y: -0.01, z: 0.33 }, kind: 'hard' },
    { p: { x: 0, y: -0.02, z: -0.13 }, kind: 'hard' },
    { p: { x: 0, y: 0.085, z: 0 }, kind: 'hard' },
    { p: { x: 0, y: 0.06, z: 0.35 }, kind: 'hard' },
  ],
  controller: {
    type: 'fbl',
    cyclicRate: (420 * Math.PI) / 180,
    yawRate: (600 * Math.PI) / 180,
    cyclicP: 0.012,
    cyclicI: 0.4,
    yawP: 0.24,
    yawI: 0.54,
    flybarTau: 0.12,
    flybarBellRatio: 0.45,
    servoTau: 0.014,
    gyroTau: 0.003,
    tailThrowTime: 0.06,
    delayMs: 3,
  },
};

export const HELI_MODELS: HeliModel[] = [HELI_450_FLYBAR, HELI_450, HELI_700, HELI_250];

/** Pilot-adjustable radio/model setup, like the model memory of a transmitter. All optional overrides. */
export interface ModelSetup {
  /** Pitch curve end points and centre per flight mode, degrees: [low, mid, high]. */
  pitch?: [number, number, number][];
  /** Head speed per flight mode as a percentage of the model default. */
  headspeedPct?: number[];
  /** Tail gyro gain percentage (100 = default). */
  gyroGainPct?: number;
  /** Cyclic rate (stick-full roll/pitch rate) percentage. */
  cyclicRatePct?: number;
}

/**
 * Training gear: a cross of carbon rods with foam balls, as every instructor fits to a first heli. It makes
 * tip-overs almost impossible (wide, soft contact points), adds weight and drag, and slows the roll/pitch
 * response a little. The physics gets all of that, so what you learn with it transfers honestly.
 */
export function withTrainingGear(base: HeliModel): HeliModel {
  const R = base.rotor.radius;
  const arm = 0.95 * R; // rods reach almost to the disc edge
  const skidY = Math.min(...base.contacts.filter((c) => c.kind === 'skid').map((c) => c.p.y));
  const ballY = skidY - 0.02;
  const balls: ContactPoint[] = [
    { p: { x: arm, y: ballY, z: 0 }, kind: 'skid', gear: true },
    { p: { x: -arm, y: ballY, z: 0 }, kind: 'skid', gear: true },
    { p: { x: 0, y: ballY, z: arm }, kind: 'skid', gear: true },
    { p: { x: 0, y: ballY, z: -arm }, kind: 'skid', gear: true },
  ];
  const extra = 0.12 * base.mass;
  return {
    ...base,
    id: `${base.id}+gear`,
    name: `${base.name} + training gear`,
    trainingGear: true,
    mass: base.mass + extra,
    inertia: { x: base.inertia.x + extra * arm * arm * 0.5, y: base.inertia.y + extra * arm * arm, z: base.inertia.z + extra * arm * arm * 0.5 },
    dragArea: { x: base.dragArea.x * 1.3, y: base.dragArea.y * 1.5, z: base.dragArea.z * 1.3 },
    contacts: [...base.contacts, ...balls],
  };
}

/** A model with the pilot's setup applied. The base definitions are never mutated. */
export function applySetup(base: HeliModel, setup: ModelSetup | undefined): HeliModel {
  if (!setup) return base;
  const m: HeliModel = { ...base, controller: { ...base.controller }, headspeeds: [...base.headspeeds] as [number, number, number], pitchCurves: base.pitchCurves.map((c) => [...c]) as [number[], number[], number[]] };
  if (setup.pitch) {
    setup.pitch.forEach((p, i) => {
      if (!p) return;
      const [lo, mid, hi] = p;
      m.pitchCurves[i] = [lo, (lo + mid) / 2, mid, (mid + hi) / 2, hi];
    });
  }
  if (setup.headspeedPct) setup.headspeedPct.forEach((pct, i) => { if (pct) m.headspeeds[i] = base.headspeeds[i] * (pct / 100); });
  if (setup.gyroGainPct) {
    m.controller.yawP = base.controller.yawP * (setup.gyroGainPct / 100);
    m.controller.yawI = base.controller.yawI * (setup.gyroGainPct / 100);
  }
  if (setup.cyclicRatePct) m.controller.cyclicRate = base.controller.cyclicRate * (setup.cyclicRatePct / 100);
  return m;
}

export function pitchFromCurve(curve: number[], stick: number): number {
  const t = ((Math.max(-1, Math.min(1, stick)) + 1) / 2) * (curve.length - 1);
  const i = Math.min(curve.length - 2, Math.floor(t));
  const f = t - i;
  return ((curve[i] * (1 - f) + curve[i + 1] * f) * Math.PI) / 180;
}
