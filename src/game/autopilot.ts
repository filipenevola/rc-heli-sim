import type { HelicopterSim } from '../sim/physics';
import { eulerFromQ, rotate, v3 } from '../sim/math';
import { pitchFromCurve } from '../sim/heli-model';
import { neutralFrame, type ControlFrame } from '../input/types';

/**
 * A simple pilot that flies the real physics for the lessons. It only moves the four stick axes,
 * exactly like a human would, so what the overlay shows is what is being done.
 *
 * Works with the 'attitude' assist on (stick = bank angle): horizontal position -> wanted velocity ->
 * wanted acceleration -> bank angle -> stick. Altitude is a PD loop on collective around the hover
 * stick position; heading is a P loop on rudder.
 */
export class Autopilot {
  ctl: ControlFrame = neutralFrame();
  /** Horizontal speed limit, m/s. */
  vmax = 3;
  private hoverStick = 0;
  /** Last wanted tilt angles (rad), for turning attitude-style advice into rate-mode stick hints. */
  wantedTiltFwd = 0;
  wantedTiltRight = 0;
  /** Set by goTo(); lets teach mode know the cyclic came from an attitude target rather than an explicit stick command. */
  usedGoTo = false;
  /** Integrators: a hovering heli needs a constant bank against the tail rotor and a collective offset, so P alone leaves an offset. */
  private ix = 0;
  private iz = 0;
  private iy = 0;

  constructor(private sim: HelicopterSim) {}

  /** Collective stick that gives about 5.5 degrees in the current flight mode (close to hover for the 450). */
  private computeHoverStick(mode: 0 | 1 | 2): number {
    const curve = this.sim.model.pitchCurves[mode];
    const target = (5.3 * Math.PI) / 180;
    let lo = -1;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (pitchFromCurve(curve, mid) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  setMode(mode: 0 | 1 | 2): void {
    this.ctl.flightMode = mode;
    this.hoverStick = this.computeHoverStick(mode);
  }

  /** Heading (rad, 0 = facing away from the pilot, positive = nose left) and helpers. */
  get heading(): number {
    return eulerFromQ(this.sim.state.ori).yaw;
  }

  headingToPilot(): number {
    const p = this.sim.state.pos;
    // Yaw convention: yaw = atan2(-fwd.x, -fwd.z). Direction to the pilot (origin): (-p.x, -p.z).
    return Math.atan2(p.x, p.z);
  }

  /** Fly toward a world position and heading. Call every frame; returns the stick frame. */
  goTo(target: { x: number; y: number; z: number }, headingTarget: number | null, opts: { vmax?: number; vzMax?: number } = {}): ControlFrame {
    const s = this.sim.state;
    const g = 9.81;
    const vmax = opts.vmax ?? this.vmax;
    // Integrate position error slowly (only when close, so cruising does not wind up).
    const ex = target.x - s.pos.x;
    const ez = target.z - s.pos.z;
    const near = Math.hypot(ex, ez) < 2;
    const dt = 1 / 60;
    this.ix = near ? Math.max(-1, Math.min(1, this.ix + ex * 0.4 * dt)) : this.ix * 0.98;
    this.iz = near ? Math.max(-1, Math.min(1, this.iz + ez * 0.4 * dt)) : this.iz * 0.98;
    // Wanted horizontal velocity (world), capped.
    let vxW = 1.0 * ex + this.ix;
    let vzW = 1.0 * ez + this.iz;
    const vm = Math.hypot(vxW, vzW);
    if (vm > vmax) { vxW *= vmax / vm; vzW *= vmax / vm; }
    // Wanted acceleration -> tilt angle (small-angle: a = g * tilt).
    const axW = 1.4 * (vxW - s.vel.x);
    const azW = 1.4 * (vzW - s.vel.z);
    // Into body heading frame: forward = -z rotated by yaw. Use the heli's forward/right vectors (flattened).
    const fwd = rotate(s.ori, v3(0, 0, -1));
    const right = rotate(s.ori, v3(1, 0, 0));
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    const rl = Math.hypot(right.x, right.z) || 1;
    const aFwd = (axW * fwd.x + azW * fwd.z) / fl;
    const aRight = (axW * right.x + azW * right.z) / rl;
    const maxTilt = this.sim.attitudeMaxAngle;
    const tiltFwd = Math.max(-0.5, Math.min(0.5, aFwd / g));
    const tiltRight = Math.max(-0.5, Math.min(0.5, aRight / g));
    this.wantedTiltFwd = tiltFwd;
    this.wantedTiltRight = tiltRight;
    this.usedGoTo = true;
    this.ctl.elevator = clamp1(tiltFwd / maxTilt);
    this.ctl.aileron = clamp1(tiltRight / maxTilt);

    // Altitude: PD on collective.
    const vzMax = opts.vzMax ?? 1.5;
    const ey = target.y - s.pos.y;
    if (Math.abs(ey) < 1.5) this.iy = Math.max(-0.3, Math.min(0.3, this.iy + ey * 0.15 * dt));
    const vyWanted = Math.max(-vzMax, Math.min(vzMax, 1.0 * ey));
    this.ctl.collective = clamp1(this.hoverStick + 0.35 * (vyWanted - s.vel.y) + 0.06 * ey + this.iy);

    // Heading.
    if (headingTarget !== null) {
      let err = headingTarget - this.heading;
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      // Positive yaw = nose left; rudder positive = nose right.
      this.ctl.rudder = clamp1(-1.2 * err);
    } else this.ctl.rudder = 0;
    return this.ctl;
  }

  /** Hands off cyclic/rudder, collective at the given stick. */
  hold(collective: number): ControlFrame {
    this.ctl.aileron = 0;
    this.ctl.elevator = 0;
    this.ctl.rudder = 0;
    this.ctl.collective = collective;
    return this.ctl;
  }

  get hover(): number {
    return this.hoverStick;
  }
}

const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));
