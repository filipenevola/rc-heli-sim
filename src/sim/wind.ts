import { v3, type V3 } from './math';

/**
 * Steady wind plus low-frequency gusts and a small turbulence component. Deterministic given the seed
 * so a session can be replayed. World frame; y is up.
 */
export interface WindObstacle {
  x: number;
  z: number;
  /** Footprint radius and height, m. */
  r: number;
  h: number;
}

export class Wind {
  /** Mean wind speed at 10 m, m/s, and the direction it blows FROM (compass degrees, 0 = from -z "north"). */
  speed = 0;
  fromDeg = 0;
  gustiness = 0.3;
  private t0 = 0;
  /** Trees and buildings: their wakes are slower and rougher downwind. */
  obstacles: WindObstacle[] = [];

  constructor(private seed = 1) {}

  /**
   * Local wind at a point. Three real-field effects on top of the gusty mean:
   *  - boundary layer: the wind near the ground is weaker than at 10 m (log profile); a hover at skid height
   *    sits in calmer air than a pass at tree height,
   *  - obstacle wakes: downwind of a tree or a house, within a few obstacle heights, the mean drops and the
   *    turbulence rises: hovering in the lee of the barn is a different job from the open field,
   *  - turbulence: short-period random-ish gusts, stronger in wakes and with gustiness.
   */
  at(pos: V3, time: number): V3 {
    if (this.speed <= 0) return v3();
    const t = time + this.t0 + this.seed * 100;
    const rad0 = (this.fromDeg * Math.PI) / 180;
    // Unit vector the wind blows toward.
    const dx = -Math.sin(rad0);
    const dz = Math.cos(rad0);
    // Log boundary layer, roughness length 0.05 m (grass), referenced to 10 m.
    const z = Math.max(0.3, pos.y);
    const profile = Math.log(z / 0.05) / Math.log(10 / 0.05);
    // Wakes: for each obstacle, how far downwind (along the wind) and how far across the point is.
    let shelter = 0;
    let rough = 0;
    for (const o of this.obstacles) {
      const rx = pos.x - o.x;
      const rz = pos.z - o.z;
      const along = rx * dx + rz * dz; // >0 downwind
      if (along < 0 || along > 6 * o.h) continue;
      const across = Math.abs(rx * dz - rz * dx);
      const width = o.r + 0.35 * along;
      if (across > width || pos.y > o.h + 0.3 * along) continue;
      const decay = 1 - along / (6 * o.h);
      const lateral = 1 - across / width;
      const w = decay * lateral;
      shelter = Math.max(shelter, 0.7 * w);
      rough = Math.max(rough, w);
    }
    const base = this.speed * profile * (1 - shelter);
    // Sum of a few incommensurate sines gives a plausible gust spectrum without allocations.
    const gust = 1 + this.gustiness * (0.5 * Math.sin(t * 0.37) + 0.3 * Math.sin(t * 1.13 + 1) + 0.2 * Math.sin(t * 2.9 + 2));
    const dirWobble = 0.25 * this.gustiness * Math.sin(t * 0.21 + 0.5) + 0.6 * rough * Math.sin(t * 4.1 + pos.x * 0.7);
    const rad = rad0 + dirWobble;
    // Turbulence: faster components, scaled by gustiness and wake roughness, position-dependent so it is not global.
    const turb = (0.12 * this.gustiness + 0.35 * rough) * this.speed * profile;
    const tx = turb * Math.sin(t * 5.3 + pos.z * 0.9) * Math.sin(t * 1.9 + 0.7);
    const tz = turb * Math.sin(t * 4.7 + pos.x * 1.1 + 2) * Math.sin(t * 2.3);
    const ty = turb * 0.6 * Math.sin(t * 6.1 + pos.x * 0.5 + pos.z * 0.4);
    const speed = base * gust;
    // Wind FROM direction d blows toward d + 180.
    const vx = -Math.sin(rad) * speed + tx;
    const vz = Math.cos(rad) * speed + tz;
    const vy = 0.15 * this.gustiness * speed * Math.sin(t * 1.7 + 3) + ty;
    return v3(vx, vy, vz);
  }
}
