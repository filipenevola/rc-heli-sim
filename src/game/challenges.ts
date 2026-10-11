import type { HelicopterSim } from '../sim/physics';
import { eulerFromQ, rotate, v3 } from '../sim/math';

/**
 * Challenge mode. Each challenge watches the live simulation and completes when its condition has held
 * for long enough. Points add up into the "challenge" ranking; the "flight" ranking is the longest single
 * flight without a crash (see FlightTimer).
 */
export interface Challenge {
  id: string;
  title: string;
  description: string;
  points: number;
  /** Returns progress 0..1; 1 completes the challenge. Called every frame. */
  check(ctx: ChallengeContext): number;
}

export interface GateSpec { id: string; x: number; y: number; z: number; r: number; order: number }

/** Checkpoint rings for the circuit challenge. Fly through them in order. */
export const GATES: GateSpec[] = [
  { id: 'g1', order: 0, x: -14, y: 5, z: -8, r: 2.2 },
  { id: 'g2', order: 1, x: -8, y: 7, z: -24, r: 2.2 },
  { id: 'g3', order: 2, x: 14, y: 7, z: -24, r: 2.2 },
  { id: 'g4', order: 3, x: 14, y: 5, z: -8, r: 2.2 },
];

export interface ChallengeContext {
  sim: HelicopterSim;
  dt: number;
  /** Seconds since the current flight lifted off (0 on the ground). */
  airTime: number;
  /** Per-challenge scratch state persisted across frames until reset. */
  mem: Record<string, number>;
}

const hoverHeight = (sim: HelicopterSim) => sim.state.pos.y;
const distToPad = (sim: HelicopterSim) => Math.hypot(sim.state.pos.x, sim.state.pos.z + 6);
const slow = (sim: HelicopterSim, v: number) => Math.hypot(sim.state.vel.x, sim.state.vel.y, sim.state.vel.z) < v;

/** Angle between the heli nose and the direction toward the pilot (at the origin), rad. */
function noseToPilot(sim: HelicopterSim): number {
  const fwd = rotate(sim.state.ori, v3(0, 0, -1));
  const dx = -sim.state.pos.x;
  const dz = -sim.state.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  const dot = (fwd.x * dx + fwd.z * dz) / len / (Math.hypot(fwd.x, fwd.z) || 1);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function hold(ctx: ChallengeContext, key: string, ok: boolean, seconds: number): number {
  ctx.mem[key] = ok ? (ctx.mem[key] ?? 0) + ctx.dt : 0;
  return Math.min(1, (ctx.mem[key] ?? 0) / seconds);
}

const landing = (id: string, title: string, points: number, description: string): Challenge => ({
  id: `land-${id}`,
  title,
  description,
  points,
  check: ({ sim }) => (sim.state.landed?.target.id === id ? 1 : 0),
});

export const CHALLENGES: Challenge[] = [
  {
    id: 'first-hover',
    title: 'First hover',
    description: 'Hold the helicopter above 1 m for 10 seconds.',
    points: 10,
    check: (ctx) => hold(ctx, 'h', hoverHeight(ctx.sim) > 1 && !ctx.sim.state.crashed, 10),
  },
  {
    id: 'hover-box',
    title: 'Hover in the box',
    description: 'Hover between 1 and 4 m, within 4 m of the pad, for 30 seconds.',
    points: 20,
    check: (ctx) => hold(ctx, 'h', hoverHeight(ctx.sim) > 1 && hoverHeight(ctx.sim) < 4 && distToPad(ctx.sim) < 4 && !ctx.sim.state.crashed, 30),
  },
  {
    id: 'nose-in',
    title: 'Nose-in hover',
    description: 'Hover 15 seconds between 1 and 5 m with the nose pointing at you (within 35°). Everything feels reversed.',
    points: 40,
    check: (ctx) => hold(ctx, 'h', hoverHeight(ctx.sim) > 1 && hoverHeight(ctx.sim) < 5 && noseToPilot(ctx.sim) < (35 * Math.PI) / 180 && !ctx.sim.state.crashed, 15),
  },
  landing('table', 'Picnic table landing', 25, 'Land on the picnic table, all four skids inside the ring.'),
  landing('truck', 'Pickup bed landing', 30, 'Land in the bed of the pickup truck. Mind the cab.'),
  landing('pontoon', 'Pontoon landing', 35, 'Land on the pontoon in the middle of the pond.'),
  landing('tower', 'Tower pad landing', 60, 'Land on the 7 m tower pad. Small, high, no ground effect.'),
  {
    id: 'circuit',
    title: 'Gate circuit',
    description: 'Fly through the four rings in order (yellow is next). Start again from the first ring if you crash.',
    points: 50,
    check: (ctx) => {
      const s = ctx.sim.state;
      if (s.crashed) ctx.mem.next = 0;
      const next = GATES[ctx.mem.next ?? 0];
      if (!next) return 1;
      const d = Math.hypot(s.pos.x - next.x, s.pos.y - next.y, s.pos.z - next.z);
      if (d < next.r) ctx.mem.next = (ctx.mem.next ?? 0) + 1;
      return (ctx.mem.next ?? 0) / GATES.length;
    },
  },
  {
    id: 'roll',
    title: 'Roll it',
    description: 'Above 8 m, roll fully through inverted and recover to level without crashing.',
    points: 70,
    check: (ctx) => {
      const s = ctx.sim.state;
      const e = eulerFromQ(s.ori);
      if (s.crashed || s.pos.y < 3) { ctx.mem.phase = 0; return 0; }
      const phase = ctx.mem.phase ?? 0;
      if (phase === 0 && s.pos.y > 8 && Math.abs(e.roll) < 0.3) ctx.mem.phase = 1; // level and high enough
      else if (phase === 1 && Math.abs(e.roll) > 2.8) ctx.mem.phase = 2; // inverted
      else if (phase === 2 && Math.abs(e.roll) < 0.35 && s.pos.y > 3) return 1; // back to level, still flying
      return (ctx.mem.phase ?? 0) / 3;
    },
  },
  {
    id: 'autorotation',
    title: 'Autorotation',
    description: 'From above 25 m, switch throttle hold on and land upright touching down slower than 1.5 m/s.',
    points: 80,
    check: (ctx) => {
      const s = ctx.sim.state;
      const hold = ctx.sim.lastControls?.throttleHold ?? false;
      if (s.crashed) { ctx.mem.armed = 0; return 0; }
      if (hold && s.pos.y > 25 && !s.onGround) ctx.mem.armed = 1;
      if (!hold) ctx.mem.armed = 0;
      if (ctx.mem.armed && s.onGround && slow(ctx.sim, 1.5)) {
        const e = eulerFromQ(s.ori);
        if (Math.abs(e.roll) < 0.4 && Math.abs(e.pitch) < 0.4) return 1;
      }
      return ctx.mem.armed ? 0.5 : 0;
    },
  },
  {
    id: 'endurance-5',
    title: 'Five minutes up',
    description: 'Stay airborne for five minutes without crashing.',
    points: 40,
    check: (ctx) => Math.min(1, ctx.airTime / 300),
  },
  {
    id: 'endurance-15',
    title: 'Fifteen minutes up',
    description: 'Fifteen minutes in the air in one flight.',
    points: 100,
    check: (ctx) => Math.min(1, ctx.airTime / 900),
  },
];

export const TOTAL_POINTS = CHALLENGES.reduce((a, c) => a + c.points, 0);

export class ChallengeTracker {
  completed = new Set<string>();
  progress: Record<string, number> = {};
  private mem: Record<string, Record<string, number>> = {};
  /** Fired when a challenge completes. */
  onComplete: ((c: Challenge) => void) | null = null;

  constructor(completed: string[] = []) {
    for (const id of completed) this.completed.add(id);
  }

  get points(): number {
    return CHALLENGES.filter((c) => this.completed.has(c.id)).reduce((a, c) => a + c.points, 0);
  }

  /** Gate index the circuit is waiting for (for the renderer to highlight). */
  get nextGate(): number {
    return this.mem.circuit?.next ?? 0;
  }

  update(sim: HelicopterSim, dt: number, airTime: number): void {
    for (const c of CHALLENGES) {
      if (this.completed.has(c.id)) continue;
      const mem = (this.mem[c.id] ??= {});
      const p = c.check({ sim, dt, airTime, mem });
      this.progress[c.id] = p;
      if (p >= 1) {
        this.completed.add(c.id);
        this.onComplete?.(c);
      }
    }
  }

  resetTransient(): void {
    this.mem = {};
  }
}

/** Measures single flights: from lift-off until the model is back on the ground or crashed. */
export class FlightTimer {
  airTime = 0;
  flying = false;
  /** Longest clean flight this session, s. */
  best = 0;
  onFlightEnd: ((seconds: number, crashed: boolean) => void) | null = null;

  update(sim: HelicopterSim, dt: number): void {
    const s = sim.state;
    const airborne = !s.onGround && !s.crashed && s.pos.y > 0.3;
    if (!this.flying && airborne) {
      this.flying = true;
      this.airTime = 0;
    } else if (this.flying) {
      if (s.crashed) {
        this.end(true);
      } else if (s.onGround && Math.hypot(s.vel.x, s.vel.y, s.vel.z) < 0.3) {
        // Count the landing as the end of a clean flight once it has settled.
        this.settle += dt;
        if (this.settle > 1.5) this.end(false);
        this.airTime += dt;
      } else {
        this.settle = 0;
        this.airTime += dt;
      }
    }
  }

  private settle = 0;

  private end(crashed: boolean): void {
    this.flying = false;
    this.settle = 0;
    if (!crashed && this.airTime > this.best) this.best = this.airTime;
    this.onFlightEnd?.(this.airTime, crashed);
    this.airTime = 0;
  }
}
