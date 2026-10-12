import * as THREE from 'three';
import { RHO } from '../sim/rotor';
import type { HelicopterSim } from '../sim/physics';

/**
 * Rotor downwash as the scenery feels it: grass flattening, ripples and spray on the lake, dust on the pad.
 * Read-only from the simulation (never feeds back into it), derived from momentum theory:
 * induced velocity vi = sqrt(T / (2 rho A)); the fully developed wake below the disc moves at about 2 vi, then turns
 * into a radial wall jet at the ground. It weakens quickly once the rotor is more than a couple of diameters up,
 * which is why you see the grass react only in a low hover.
 */
export interface RotorWashUniforms {
  /** Rotor hub, world. */
  washPos: { value: THREE.Vector3 };
  /** 0..1 how hard the wake hits the surface right below the rotor. */
  washStrength: { value: number };
  /** Rotor radius, m (sets the footprint of the wash). */
  washRadius: { value: number };
  /** Seconds, for animation. */
  time: { value: number };
  /** Wind velocity on the ground plane (m/s, world x/z). */
  wind: { value: THREE.Vector2 };
}

export const wash: RotorWashUniforms = {
  washPos: { value: new THREE.Vector3(0, -100, 0) },
  washStrength: { value: 0 },
  washRadius: { value: 0.36 },
  time: { value: 0 },
  wind: { value: new THREE.Vector2() },
};

/** Wake speed at the surface, m/s (exposed for particles). */
export let washSpeed = 0;

const hub = new THREE.Vector3();
const q = new THREE.Quaternion();

export function updateWash(sim: HelicopterSim, dt: number, windX: number, windZ: number): void {
  const s = sim.state;
  const m = sim.model;
  q.set(s.ori.x, s.ori.y, s.ori.z, s.ori.w);
  hub.set(m.hubOffset.x, m.hubOffset.y, m.hubOffset.z).applyQuaternion(q).add(new THREE.Vector3(s.pos.x, s.pos.y, s.pos.z));
  const R = m.rotor.radius;
  const area = Math.PI * R * R;
  const T = Math.abs(sim.telemetry.thrust);
  const vi = Math.sqrt(T / (2 * RHO * area));
  // Height above the surface in rotor diameters; the wake is fully contracted by ~1 R and spreads out beyond ~3 D.
  const hD = Math.max(0, hub.y) / (2 * R);
  const reach = Math.exp(-Math.max(0, hD - 0.5) / 1.6);
  // Thrust pointing away from the ground (inverted) blows upward instead: no wash on the surface.
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q).y;
  washSpeed = 2 * vi * reach * Math.max(0, up);
  // 450: ~6.6 m/s in hover at 1 g; normalise so a hover at half a diameter reads ~1.
  const strength = Math.min(1.2, washSpeed / 6);
  const k = 1 - Math.exp(-dt * 8);
  wash.washStrength.value += (strength - wash.washStrength.value) * k;
  wash.washPos.value.copy(hub);
  wash.washRadius.value = R;
  wash.time.value += dt;
  wash.wind.value.set(windX, windZ);
}
