import { HELI_450, HELI_450_FLYBAR, HELI_700, type HeliModel, type ContactPoint } from './heli-model';
import type { V3 } from './math';

/**
 * What a pilot knows about their own helicopter: the numbers on the box and the radio. Everything else
 * (inertias, rotor and tail geometry, drag, motor, contact points) is scaled between the 450 and the 700
 * reference models with power laws in rotor radius, then corrected for the stated weight.
 */
export interface CustomSpec {
  name: string;
  /** Main blade length, mm (325 for a 450, 700 for a 700). Rotor radius = blade + grip/hub. */
  bladeMm: number;
  /** All-up weight with battery, g. */
  massG: number;
  /** Battery: cells in series and capacity. */
  cells: number;
  mah: number;
  /** Head speed per flight mode, rpm. */
  headspeedRpm: [number, number, number];
  flybar: boolean;
  /** Main blades: 2 (most helis) or 3 (many 3D machines and scale models). More solidity, more thrust at the same pitch. */
  blades?: 2 | 3;
  /** Electric (default) or a nitro/glow engine with a clutch and a fuel tank. */
  power?: 'electric' | 'nitro';
  /** Fuel tank, ml (nitro only). */
  tankMl?: number;
}

export const DEFAULT_CUSTOM: CustomSpec = { name: 'My heli', bladeMm: 500, massG: 1900, cells: 6, mah: 3300, headspeedRpm: [1900, 2100, 2300], flybar: false, blades: 2, power: 'electric', tankMl: 300 };

const R450 = HELI_450.rotor.radius;
const R700 = HELI_700.rotor.radius;

/** Power-law interpolation between the two references as a function of radius (extrapolates outside). */
function law(v450: number, v700: number, R: number): number {
  if (v450 === 0 || v700 === 0 || Math.sign(v450) !== Math.sign(v700)) return v450 + ((v700 - v450) * (R - R450)) / (R700 - R450);
  const k = Math.log(v700 / v450) / Math.log(R700 / R450);
  return v450 * Math.pow(R / R450, k);
}
const lawV = (a: V3, b: V3, R: number): V3 => ({ x: law(a.x, b.x, R), y: law(a.y, b.y, R), z: law(a.z, b.z, R) });

export function rotorRadiusFromBlade(bladeMm: number): number {
  // Grip + hub add about 10% of blade length plus 10 mm.
  return (bladeMm * 1.1 + 10) / 1000;
}

export function buildCustomModel(spec: CustomSpec): HeliModel {
  const R = rotorRadiusFromBlade(spec.bladeMm);
  const k = R / R450;
  const massRef = law(HELI_450.mass, HELI_700.mass, R);
  const mass = Math.max(0.1, spec.massG / 1000);
  const mk = mass / massRef; // heavier or lighter than a typical heli of this size
  const base = R < 0.55 ? HELI_450 : HELI_700;
  const flybar = spec.flybar ? HELI_450_FLYBAR.controller : null;
  const rpm = (n: number) => (n * 2 * Math.PI) / 60;
  const contacts: ContactPoint[] = HELI_450.contacts.map((c) => ({ ...c, p: { x: c.p.x * k, y: c.p.y * k, z: c.p.z * k } }));
  const inertia = lawV(HELI_450.inertia, HELI_700.inertia, R);
  return {
    id: 'custom',
    name: spec.name || 'My heli',
    mass,
    inertia: { x: inertia.x * mk, y: inertia.y * mk, z: inertia.z * mk },
    rotor: {
      radius: R,
      chord: law(HELI_450.rotor.chord, HELI_700.rotor.chord, R),
      blades: spec.blades === 3 ? 3 : 2,
      liftSlope: law(HELI_450.rotor.liftSlope, HELI_700.rotor.liftSlope, R),
      cd0: law(HELI_450.rotor.cd0, HELI_700.rotor.cd0, R),
      efficiency: law(HELI_450.rotor.efficiency, HELI_700.rotor.efficiency, R),
    },
    hubOffset: lawV(HELI_450.hubOffset, HELI_700.hubOffset, R),
    hubStiffness: law(HELI_450.hubStiffness, HELI_700.hubStiffness, R) * mk,
    lockNumber: law(HELI_450.lockNumber, HELI_700.lockNumber, R),
    maxCyclic: base.maxCyclic,
    rotorInertia: law(HELI_450.rotorInertia, HELI_700.rotorInertia, R) * (spec.blades === 3 ? 1.5 : 1),
    clockwise: true,
    tail: {
      radius: law(HELI_450.tail.radius, HELI_700.tail.radius, R),
      chord: law(HELI_450.tail.chord, HELI_700.tail.chord, R),
      blades: 2,
      liftSlope: 5.5,
      cd0: law(HELI_450.tail.cd0, HELI_700.tail.cd0, R),
      efficiency: 0.8,
    },
    tailOffset: lawV(HELI_450.tailOffset, HELI_700.tailOffset, R),
    tailGearRatio: law(HELI_450.tailGearRatio, HELI_700.tailGearRatio, R),
    maxTailPitch: base.maxTailPitch,
    maxMotorTorque: law(HELI_450.maxMotorTorque, HELI_700.maxMotorTorque, R) * Math.pow(mk, 1.5),
    batteryWh: spec.power === 'nitro' ? Math.max(50, spec.tankMl ?? 300) : Math.max(1, (spec.cells * 3.7 * spec.mah) / 1000) * 0.8,
    power: spec.power === 'nitro' ? 'nitro' : 'electric',
    // Glow engines peak a little above the Idle-Up 1 head speed, so the pilot's chosen head speeds sit on the fat part of the curve.
    nitroPeakHeadRpm: spec.power === 'nitro' ? spec.headspeedRpm[1] * 1.08 : undefined,
    headspeeds: [rpm(spec.headspeedRpm[0]), rpm(spec.headspeedRpm[1]), rpm(spec.headspeedRpm[2])],
    spoolRate: law(HELI_450.spoolRate, HELI_700.spoolRate, R),
    pitchCurves: base.pitchCurves.map((c) => [...c]) as [number[], number[], number[]],
    dragArea: lawV(HELI_450.dragArea, HELI_700.dragArea, R),
    finArea: law(HELI_450.finArea, HELI_700.finArea, R),
    stabArea: law(HELI_450.stabArea, HELI_700.stabArea, R),
    contacts,
    controller: {
      ...(flybar ?? base.controller),
      // Yaw and cyclic loop gains follow the reference nearest in size; the flybar variant keeps its own feel.
      yawP: law(HELI_450.controller.yawP, HELI_700.controller.yawP, R) * (flybar ? 0.9 : 1),
      yawI: law(HELI_450.controller.yawI, HELI_700.controller.yawI, R) * (flybar ? 0.9 : 1),
      cyclicRate: law(HELI_450.controller.cyclicRate, HELI_700.controller.cyclicRate, R),
      yawRate: law(HELI_450.controller.yawRate, HELI_700.controller.yawRate, R),
      servoTau: law(HELI_450.controller.servoTau, HELI_700.controller.servoTau, R),
    },
  };
}

/** Sanity limits for the form. */
export function normalizeSpec(s: Partial<CustomSpec>): CustomSpec {
  const n = (v: unknown, d: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : d));
  const hs = Array.isArray(s.headspeedRpm) ? s.headspeedRpm : DEFAULT_CUSTOM.headspeedRpm;
  return {
    name: String(s.name ?? DEFAULT_CUSTOM.name).slice(0, 40) || DEFAULT_CUSTOM.name,
    bladeMm: n(s.bladeMm, DEFAULT_CUSTOM.bladeMm, 150, 900),
    massG: n(s.massG, DEFAULT_CUSTOM.massG, 100, 9000),
    cells: n(s.cells, DEFAULT_CUSTOM.cells, 1, 14),
    mah: n(s.mah, DEFAULT_CUSTOM.mah, 100, 20000),
    headspeedRpm: [n(hs[0], 1900, 600, 4500), n(hs[1], 2100, 600, 4500), n(hs[2], 2300, 600, 4500)],
    flybar: Boolean(s.flybar),
    blades: Number(s.blades) === 3 ? 3 : 2,
    power: s.power === 'nitro' ? 'nitro' : 'electric',
    tankMl: n(s.tankMl, 300, 50, 2000),
  };
}
