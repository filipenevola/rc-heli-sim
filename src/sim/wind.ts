import { v3, type V3 } from './math';

/**
 * Steady wind plus low-frequency gusts and a small turbulence component. Deterministic given the seed
 * so a session can be replayed. World frame; y is up.
 */
export class Wind {
  /** Mean wind speed, m/s, and the direction it blows FROM (compass degrees, 0 = from -z "north"). */
  speed = 0;
  fromDeg = 0;
  gustiness = 0.3;
  private t0 = 0;

  constructor(private seed = 1) {}

  at(_pos: V3, time: number): V3 {
    if (this.speed <= 0) return v3();
    const t = time + this.t0 + this.seed * 100;
    // Sum of a few incommensurate sines gives a plausible gust spectrum without allocations.
    const gust = 1 + this.gustiness * (0.5 * Math.sin(t * 0.37) + 0.3 * Math.sin(t * 1.13 + 1) + 0.2 * Math.sin(t * 2.9 + 2));
    const dirWobble = 0.25 * this.gustiness * Math.sin(t * 0.21 + 0.5);
    const rad = (this.fromDeg * Math.PI) / 180 + dirWobble;
    const speed = this.speed * gust;
    // Wind FROM direction d blows toward d + 180.
    const vx = -Math.sin(rad) * speed;
    const vz = Math.cos(rad) * speed;
    const vy = 0.15 * this.gustiness * speed * Math.sin(t * 1.7 + 3);
    return v3(vx, vy, vz);
  }
}
