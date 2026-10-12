import type { HelicopterSim } from '../sim/physics';
import { eulerFromQ, rotate, v3 } from '../sim/math';

/**
 * Challenge mode. Each challenge watches the live simulation and completes when its condition has held
 * for long enough. Points add up into the "challenge" ranking; the "flight" ranking is the longest single
 * flight without a crash (see FlightTimer).
 */
export type Level = 'Beginner' | 'Intermediate' | 'Advanced' | '3D';

export interface Challenge {
  id: string;
  title: string;
  description: string;
  points: number;
  level: Level;
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

/** Figure-eight course: two pylons at x = ±9, z = -16; six rings trace the 8 (crossing in the middle). */
export const EIGHT_GATES: GateSpec[] = [
  { id: 'e1', order: 0, x: 0, y: 4, z: -16, r: 2.2 },
  { id: 'e2', order: 1, x: 9, y: 4, z: -10, r: 2.2 },
  { id: 'e3', order: 2, x: 15, y: 4, z: -16, r: 2.2 },
  { id: 'e4', order: 3, x: 9, y: 4, z: -22, r: 2.2 },
  { id: 'e5', order: 4, x: -9, y: 4, z: -10, r: 2.2 },
  { id: 'e6', order: 5, x: -15, y: 4, z: -16, r: 2.2 },
  { id: 'e7', order: 6, x: -9, y: 4, z: -22, r: 2.2 },
];

/** Signed angle from the nose to the pilot: positive when the pilot is to the heli's left. */
export function pilotSide(sim: HelicopterSim): number {
  const fwd = rotate(sim.state.ori, v3(0, 0, -1));
  const dx = -sim.state.pos.x;
  const dz = -sim.state.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  // 2D cross product (fwd × toPilot) in the ground plane; y-up right-handed: positive = pilot on the left.
  return (fwd.z * dx - fwd.x * dz) / len / (Math.hypot(fwd.x, fwd.z) || 1);
}

/** Heading-like angle that stays meaningful when the nose points up or down: azimuth of the body-up vector then. */
export function azimuth(sim: HelicopterSim): number {
  const fwd = rotate(sim.state.ori, v3(0, 0, -1));
  const up = rotate(sim.state.ori, v3(0, 1, 0));
  const v = Math.abs(fwd.y) > 0.6 ? up : fwd;
  return Math.atan2(-v.x, -v.z);
}

/** Signed small-angle difference a - b in (-pi, pi]. */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function gateSequence(gates: GateSpec[], ctx: ChallengeContext): number {
  const s = ctx.sim.state;
  if (s.crashed) ctx.mem.next = 0;
  const next = gates[ctx.mem.next ?? 0];
  if (!next) return 1;
  const d = Math.hypot(s.pos.x - next.x, s.pos.y - next.y, s.pos.z - next.z);
  if (d < next.r) ctx.mem.next = (ctx.mem.next ?? 0) + 1;
  return (ctx.mem.next ?? 0) / gates.length;
}

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

const landing = (id: string, title: string, points: number, description: string, level: Level = 'Intermediate'): Challenge => ({
  id: `land-${id}`,
  title,
  description,
  points,
  level,
  check: ({ sim }) => (sim.state.landed?.target.id === id ? 1 : 0),
});

export const CHALLENGES: Challenge[] = [
  {
    id: 'first-hover',
    level: 'Beginner',
    title: 'First hover',
    description: 'Hold the helicopter above 1 m for 10 seconds.',
    points: 10,
    check: (ctx) => hold(ctx, 'h', hoverHeight(ctx.sim) > 1 && !ctx.sim.state.crashed, 10),
  },
  {
    id: 'hover-box',
    level: 'Beginner',
    title: 'Hover in the box',
    description: 'Hover between 1 and 4 m, within 4 m of the pad, for 30 seconds.',
    points: 20,
    check: (ctx) => hold(ctx, 'h', hoverHeight(ctx.sim) > 1 && hoverHeight(ctx.sim) < 4 && distToPad(ctx.sim) < 4 && !ctx.sim.state.crashed, 30),
  },
  {
    id: 'nose-in',
    level: 'Intermediate',
    title: 'Nose-in hover',
    description: 'Hover 15 seconds between 1 and 5 m with the nose pointing at you (within 35°). Everything feels reversed.',
    points: 40,
    check: (ctx) => hold(ctx, 'h', hoverHeight(ctx.sim) > 1 && hoverHeight(ctx.sim) < 5 && noseToPilot(ctx.sim) < (35 * Math.PI) / 180 && !ctx.sim.state.crashed, 15),
  },
  landing('table', 'Picnic table landing', 25, 'Land on the picnic table, all four skids inside the ring.', 'Beginner'),
  landing('truck', 'Pickup bed landing', 30, 'Land in the bed of the pickup truck. Mind the cab.'),
  landing('pontoon', 'Pontoon landing', 35, 'Land on the pontoon in the middle of the pond.'),
  landing('tower', 'Tower pad landing', 60, 'Land on the 7 m tower pad. Small, high, no ground effect.', 'Advanced'),
  landing('container', 'Container roof landing', 35, 'Parking lot: land on the shipping container\'s roof, 2.6 m up, narrow, with no ground effect to float on.'),
  landing('mat', 'Mat stack landing', 15, 'Gym: land on the stack of mats, all four skids inside the ring.', 'Beginner'),
  landing('vault', 'Vault box landing', 30, 'Gym: land on the vault box, a 1.2 m square with nothing to spare.'),
  landing('slope', 'Slope landing (10°)', 40, 'Hillside: set down inside the ring on the 10° slope. Uphill skid first, then ease the collective down; the heli sits tilted, that is fine.'),
  landing('bank', 'Bank landing (20°)', 70, 'Hillside: the 20° bank. Skids across the fall line (nose along the hill), or it slides; land one skid at a time and never push the cyclic into the slope once a skid is down.', 'Advanced'),
  {
    id: 'circuit',
    level: 'Intermediate',
    title: 'Gate circuit',
    description: 'Fly through the four rings in order (yellow is next). Start again from the first ring if you crash.',
    points: 50,
    check: (ctx) => gateSequence(GATES, ctx),
  },
  {
    id: 'roll',
    level: '3D',
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
    level: 'Advanced',
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
    level: 'Beginner',
    title: 'Five minutes up',
    description: 'Stay airborne for five minutes without crashing.',
    points: 40,
    check: (ctx) => Math.min(1, ctx.airTime / 300),
  },
  {
    id: 'endurance-15',
    level: 'Intermediate',
    title: 'Fifteen minutes up',
    description: 'Fifteen minutes in the air in one flight.',
    points: 100,
    check: (ctx) => Math.min(1, ctx.airTime / 900),
  },


  // ---- The classic progression: hover in every orientation, pirouettes, figure eights, precision ----
  {
    id: 'side-in-left',
    level: 'Beginner',
    title: 'Side-in hover (nose left)',
    description: 'Hover 15 s between 1 and 5 m with the nose pointing to YOUR left, so you see the heli from its right side.',
    points: 20,
    check: (ctx) => hold(ctx, 'h', hoverHeight(ctx.sim) > 1 && hoverHeight(ctx.sim) < 5 && !ctx.sim.state.crashed && Math.abs(noseToPilot(ctx.sim) - Math.PI / 2) < (30 * Math.PI) / 180 && pilotSide(ctx.sim) < 0, 15),
  },
  {
    id: 'side-in-right',
    level: 'Beginner',
    title: 'Side-in hover (nose right)',
    description: 'Hover 15 s between 1 and 5 m with the nose pointing to YOUR right.',
    points: 20,
    check: (ctx) => hold(ctx, 'h', hoverHeight(ctx.sim) > 1 && hoverHeight(ctx.sim) < 5 && !ctx.sim.state.crashed && Math.abs(noseToPilot(ctx.sim) - Math.PI / 2) < (30 * Math.PI) / 180 && pilotSide(ctx.sim) > 0, 15),
  },
  {
    id: 'elevator',
    level: 'Beginner',
    title: 'Elevator',
    description: 'Within 4 m of the pad: hover at 1–2 m for 3 s, climb to 6–8 m and hold 3 s, come back down to 1–2 m and hold 3 s. Collective control without drifting.',
    points: 25,
    check: (ctx) => {
      const s = ctx.sim.state;
      if (s.crashed || distToPad(ctx.sim) > 4) { ctx.mem.phase = 0; ctx.mem.t = 0; return 0; }
      const h = hoverHeight(ctx.sim);
      const phase = ctx.mem.phase ?? 0;
      const inBand = phase === 1 ? h > 6 && h < 8 : h > 1 && h < 2;
      ctx.mem.t = inBand ? (ctx.mem.t ?? 0) + ctx.dt : 0;
      if ((ctx.mem.t ?? 0) >= 3) {
        ctx.mem.phase = phase + 1;
        ctx.mem.t = 0;
        if (ctx.mem.phase >= 3) return 1;
      }
      return (ctx.mem.phase ?? 0) / 3;
    },
  },
  {
    id: 'spot-landing',
    level: 'Beginner',
    title: 'Spot landing',
    description: 'After at least 20 s in the air, land on the helipad within 50 cm of the centre of the H.',
    points: 20,
    check: (ctx) => {
      const s = ctx.sim.state;
      if (ctx.airTime > 20) ctx.mem.flew = 1;
      if (s.crashed) ctx.mem.flew = 0;
      if (ctx.mem.flew && s.landed?.target.id === 'pad' && s.landed.offset < 0.5) return 1;
      return ctx.mem.flew ? 0.5 : Math.min(0.5, ctx.airTime / 40);
    },
  },
  {
    id: 'pirouette',
    level: 'Intermediate',
    title: 'Pirouette',
    description: 'One full slow 360° turn on the spot (either direction) between 1 and 5 m, staying within 2 m of where you started. Keep the cyclic working as the orientation changes.',
    points: 30,
    check: (ctx) => {
      const s = ctx.sim.state;
      const e = eulerFromQ(s.ori);
      const h = hoverHeight(ctx.sim);
      if (s.crashed || h < 1 || h > 5) { ctx.mem.acc = 0; ctx.mem.has = 0; return 0; }
      if (!ctx.mem.has) { ctx.mem.has = 1; ctx.mem.x = s.pos.x; ctx.mem.z = s.pos.z; ctx.mem.yaw = e.yaw; ctx.mem.acc = 0; }
      if (Math.hypot(s.pos.x - ctx.mem.x, s.pos.z - ctx.mem.z) > 2) { ctx.mem.has = 0; return 0; }
      let d = e.yaw - ctx.mem.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      ctx.mem.yaw = e.yaw;
      // Accumulate in the direction already started; a reversal restarts the count.
      const acc = (ctx.mem.acc ?? 0) + d;
      if (Math.sign(acc) !== Math.sign(ctx.mem.acc ?? acc) && Math.abs(ctx.mem.acc ?? 0) > 0.3) ctx.mem.acc = d;
      else ctx.mem.acc = acc;
      return Math.min(1, Math.abs(ctx.mem.acc) / (2 * Math.PI));
    },
  },
  {
    id: 'figure-eight',
    level: 'Intermediate',
    title: 'Figure eight',
    description: 'Fly the seven rings of the figure-eight course in order (yellow is next), crossing the middle twice. Round, even circles.',
    points: 50,
    check: (ctx) => gateSequence(EIGHT_GATES, ctx),
  },
  {
    id: 'loop',
    level: '3D',
    title: 'Loop',
    description: 'Above 10 m, pull a full loop: nose up through inverted and back to level, no crash. Collective positive going up, reduced over the top.',
    points: 70,
    check: (ctx) => {
      const s = ctx.sim.state;
      if (s.crashed || s.pos.y < 3) { ctx.mem.phase = 0; return 0; }
      const fwd = rotate(s.ori, v3(0, 0, -1));
      const up = rotate(s.ori, v3(0, 1, 0));
      const phase = ctx.mem.phase ?? 0;
      if (phase === 0 && s.pos.y > 10 && up.y > 0.9) ctx.mem.phase = 1; // level and high
      else if (phase === 1 && fwd.y > 0.7) ctx.mem.phase = 2; // nose pointing up: it is a loop, not a roll
      else if (phase === 2 && up.y < -0.6) ctx.mem.phase = 3; // over the top, inverted
      else if (phase === 3 && up.y > 0.85 && Math.abs(fwd.y) < 0.4) return 1;
      return (ctx.mem.phase ?? 0) / 4;
    },
  },
  {
    id: 'inverted-hover',
    level: '3D',
    title: 'Inverted hover',
    description: 'Hover upside down for 10 s above 5 m (Idle-Up, collective below centre). The hardest hover there is.',
    points: 90,
    check: (ctx) => {
      const s = ctx.sim.state;
      const up = rotate(s.ori, v3(0, 1, 0));
      return hold(ctx, 'h', !s.crashed && s.pos.y > 5 && up.y < -0.85 && Math.hypot(s.vel.x, s.vel.y, s.vel.z) < 2.5, 10);
    },
  },
  {
    id: 'nose-in-circuit',
    level: 'Advanced',
    title: 'Nose-in circuit',
    description: 'Fly the four-ring circuit with the nose pointing at you the whole way (within 45°). Backwards and sideways flight with reversed controls.',
    points: 80,
    check: (ctx) => {
      const ok = noseToPilot(ctx.sim) < (45 * Math.PI) / 180;
      if (!ok && ctx.sim.state.pos.y > 1.5) { ctx.mem.next = 0; return 0; }
      return gateSequence(GATES, ctx);
    },
  },
  // ---- The hard stuff ----
  {
    id: 'landing-streak',
    level: 'Beginner',
    title: 'Three clean landings',
    description: 'Three flights in a row, each at least 10 s in the air, each ending with a landing on the helipad. No crash, no Reset in between.',
    points: 30,
    check: (ctx) => {
      const s = ctx.sim.state;
      if (s.crashed) { ctx.mem.count = 0; ctx.mem.flew = 0; return 0; }
      if (ctx.airTime > 10) ctx.mem.flew = 1;
      if (ctx.mem.flew && s.landed?.target.id === 'pad' && !ctx.mem.counted) {
        ctx.mem.count = (ctx.mem.count ?? 0) + 1;
        ctx.mem.counted = 1;
        ctx.mem.flew = 0;
      }
      if (!s.landed) ctx.mem.counted = 0;
      return Math.min(1, (ctx.mem.count ?? 0) / 3);
    },
  },
  {
    id: 'crosswind-landing',
    level: 'Intermediate',
    title: 'Crosswind landing',
    description: 'With the wind at 4 m/s or more (Settings → Wind), fly for 15 s and land on the helipad within 60 cm of the H. Nose into wind helps; expect the lee of the trees to be rough.',
    points: 40,
    check: (ctx) => {
      const s = ctx.sim.state;
      if (s.crashed) { ctx.mem.flew = 0; return 0; }
      if (ctx.airTime > 15 && ctx.sim.wind.speed >= 4) ctx.mem.flew = 1;
      if (ctx.mem.flew && s.landed?.target.id === 'pad' && s.landed.offset < 0.6 && ctx.sim.wind.speed >= 4) return 1;
      return ctx.mem.flew ? 0.5 : ctx.sim.wind.speed >= 4 ? Math.min(0.5, ctx.airTime / 30) : 0;
    },
  },
  {
    id: 'stall-turn',
    level: 'Advanced',
    title: 'Stall turn',
    description: 'From fast forward flight (over 7 m/s) pull vertical, let the speed bleed off, pivot the nose 180° with rudder at the top, dive out and recover level.',
    points: 60,
    check: (ctx) => {
      const s = ctx.sim.state;
      const fwd = rotate(s.ori, v3(0, 0, -1));
      const up = rotate(s.ori, v3(0, 1, 0));
      const e = eulerFromQ(s.ori);
      const speed = Math.hypot(s.vel.x, s.vel.z);
      if (s.crashed || s.pos.y < 2) { ctx.mem.phase = 0; return 0; }
      const phase = ctx.mem.phase ?? 0;
      if (phase === 0 && speed > 7 && up.y > 0.7) { ctx.mem.phase = 1; ctx.mem.head = e.yaw; }
      else if (phase === 1) {
        ctx.mem.head = e.yaw; // keep the entry heading fresh until the pull
        if (fwd.y > 0.8) ctx.mem.phase = 2;
      } else if (phase === 2) {
        // Over the top by yaw (stall turn): nose goes from up to down while the body-up vector stays roughly
        // horizontal/upright and the heading reverses. A loop-over would put the up vector inverted instead.
        if (fwd.y < -0.6) {
          // The up-vector test above is what separates a stall turn from a loop; the heading test only rejects
          // a tail-slide that falls back the way it came (heading unchanged).
          const reversed = Math.abs(angleDiff(e.yaw, ctx.mem.head ?? e.yaw)) > (60 * Math.PI) / 180;
          ctx.mem.phase = reversed && up.y > -0.3 ? 4 : 0;
        } else if (up.y < -0.5) ctx.mem.phase = 0; // flopped onto its back
      } else if (phase === 4 && up.y > 0.85 && Math.abs(fwd.y) < 0.35) return 1;
      return (ctx.mem.phase ?? 0) / 5;
    },
  },
  {
    id: 'funnel',
    level: '3D',
    title: 'Funnel',
    description: 'A full banked circle: 360° of heading with more than 45° of bank the whole way, above 5 m, moving faster than 3 m/s. Keep the nose pointed into the centre.',
    points: 80,
    check: (ctx) => {
      const s = ctx.sim.state;
      const up = rotate(s.ori, v3(0, 1, 0));
      const e = eulerFromQ(s.ori);
      const bank = Math.acos(Math.max(-1, Math.min(1, up.y)));
      const speed = Math.hypot(s.vel.x, s.vel.z);
      const ok = !s.crashed && s.pos.y > 5 && bank > (45 * Math.PI) / 180 && bank < (135 * Math.PI) / 180 && speed > 3;
      if (!ok) { ctx.mem.acc = 0; ctx.mem.has = 0; return 0; }
      if (!ctx.mem.has) { ctx.mem.has = 1; ctx.mem.prev = e.yaw; ctx.mem.acc = 0; }
      let d = e.yaw - ctx.mem.prev;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      ctx.mem.prev = e.yaw;
      ctx.mem.acc = (ctx.mem.acc ?? 0) + d;
      return Math.min(1, Math.abs(ctx.mem.acc) / (2 * Math.PI));
    },
  },
  {
    id: 'tic-toc',
    level: '3D',
    title: 'Tic-toc',
    description: 'Above 6 m and nearly stationary, swing the nose past 30° up and 30° down four times in a row (two full tic-tocs) within 8 s, pumping collective to hold height.',
    points: 90,
    check: (ctx) => {
      const s = ctx.sim.state;
      const fwd = rotate(s.ori, v3(0, 0, -1));
      const upv = rotate(s.ori, v3(0, 1, 0));
      const speed = Math.hypot(s.vel.x, s.vel.z);
      // A tic-toc swings tail-low about a point; a tumble or a loop (disc past 75 deg) does not count.
      if (s.crashed || s.pos.y < 4 || speed > 5 || upv.y < 0.25) { ctx.mem.n = 0; ctx.mem.t = 0; return 0; }
      ctx.mem.t = (ctx.mem.t ?? 0) + ctx.dt;
      const want = (ctx.mem.n ?? 0) % 2 === 0 ? fwd.y > 0.5 : fwd.y < -0.5;
      if (want && s.pos.y > 6) {
        if ((ctx.mem.n ?? 0) === 0) ctx.mem.t = 0;
        ctx.mem.n = (ctx.mem.n ?? 0) + 1;
      }
      if ((ctx.mem.t ?? 0) > 8) { ctx.mem.n = 0; ctx.mem.t = 0; }
      if ((ctx.mem.n ?? 0) >= 4) return 1;
      return (ctx.mem.n ?? 0) / 4;
    },
  },
  {
    id: 'piro-flip',
    level: '3D',
    title: 'Piro flip',
    description: 'Flip through inverted and back to level while pirouetting (at least 270° of heading during the flip), above 8 m. The signature 3D move.',
    points: 120,
    check: (ctx) => {
      const s = ctx.sim.state;
      const up = rotate(s.ori, v3(0, 1, 0));
      const e = eulerFromQ(s.ori);
      if (s.crashed || s.pos.y < 3) { ctx.mem.phase = 0; return 0; }
      const phase = ctx.mem.phase ?? 0;
      if (phase === 0 && s.pos.y > 8 && up.y > 0.9) { ctx.mem.phase = 1; ctx.mem.acc = 0; ctx.mem.prev = e.yaw; ctx.mem.t = 0; }
      else if (phase >= 1) {
        // Pirouette rate: heading change, ignoring the jumps the heading angle makes through vertical.
        const d = angleDiff(e.yaw, ctx.mem.prev ?? e.yaw);
        ctx.mem.prev = e.yaw;
        if (Math.abs(d) < 1.5) ctx.mem.acc = (ctx.mem.acc ?? 0) + Math.abs(d);
        ctx.mem.t = (ctx.mem.t ?? 0) + ctx.dt;
        if (phase === 1 && up.y < 0.3) { ctx.mem.phase = 2; ctx.mem.t = 0; ctx.mem.acc = 0; }
        else if (phase === 2 && up.y < -0.6) ctx.mem.phase = 3;
        else if (phase === 3 && up.y > 0.85) {
          if ((ctx.mem.acc ?? 0) >= 1.5 * Math.PI && (ctx.mem.t ?? 0) < 5) return 1;
          ctx.mem.phase = 1; ctx.mem.acc = 0; ctx.mem.t = 0; // a plain flip or loop: try again
        }
        if (phase >= 2 && (ctx.mem.t ?? 0) > 5) { ctx.mem.phase = 1; ctx.mem.acc = 0; ctx.mem.t = 0; }
      }
      return Math.min(0.95, (ctx.mem.phase ?? 0) / 4 + Math.min(0.2, ((ctx.mem.acc ?? 0) / Math.PI) * 0.2));
    },
  },
];

export const TOTAL_POINTS = CHALLENGES.reduce((a, c) => a + c.points, 0);
export const LEVELS: Level[] = ['Beginner', 'Intermediate', 'Advanced', '3D'];

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

  /** Gate index a gate challenge is waiting for (for the renderer to highlight). */
  nextGate(challengeId = 'circuit'): number {
    return this.mem[challengeId]?.next ?? 0;
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
