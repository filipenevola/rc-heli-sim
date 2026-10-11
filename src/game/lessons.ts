import type { HelicopterSim } from '../sim/physics';
import { eulerFromQ, rotate, v3 } from '../sim/math';
import { Autopilot } from './autopilot';
import { GATES, EIGHT_GATES } from './challenges';
import { neutralFrame, type ControlFrame } from '../input/types';

/**
 * "Teach me": a scripted pilot flies each challenge with the real physics while the overlay shows the
 * sticks and a caption for each step. A lesson is a list of steps; each step provides the controls for
 * the current frame and says when it is done.
 */
export interface LessonStep {
  caption: string;
  /** Produce this frame's controls. */
  run(ctx: StepContext): ControlFrame;
  /** True when the step is finished. */
  done(ctx: StepContext): boolean;
  /** Give up after this many seconds (safety). */
  timeout?: number;
}

export interface StepContext {
  sim: HelicopterSim;
  ap: Autopilot;
  /** Seconds in this step. */
  t: number;
  dt: number;
  mem: Record<string, number>;
}

export interface Lesson {
  challengeId: string;
  title: string;
  intro: string;
  steps: LessonStep[];
}

/** CG height above the surface when the current model sits on its skids. */
const skidHeight = (sim: HelicopterSim): number => -Math.min(...sim.model.contacts.filter((c) => c.kind === 'skid').map((c) => c.p.y));
const PAD = { x: 0, z: -6 };

const spoolUp = (mode: 0 | 1 | 2, caption: string): LessonStep => ({
  caption,
  run: ({ ap, t, sim }) => {
    ap.setMode(mode);
    // Normal mode: the stick itself spools the governor; raise it slowly to just below hover.
    const target = mode === 0 ? Math.min(ap.hover - 0.08, -1 + t * 0.25) : -0.05;
    return ap.hold(mode === 0 ? target : target);
    void sim;
  },
  done: ({ sim }) => sim.telemetry.headspeedRpm > 0.95 * ((sim.model.headspeeds[sim.lastControls?.flightMode ?? 0] * 60) / (2 * Math.PI)),
  timeout: 30,
});

const liftTo = (height: number, caption: string, holdSeconds = 0): LessonStep => ({
  caption,
  // Hold the spot where the step started (re-targeting the current position every frame lets the heli drift).
  run: ({ ap, sim, mem }) => {
    mem.x ??= sim.state.pos.x;
    mem.z ??= sim.state.pos.z;
    mem.h ??= ap.heading;
    return ap.goTo({ x: mem.x, y: height, z: mem.z }, mem.h, { vzMax: 0.8 });
  },
  done: ({ sim, t, mem }) => {
    if (Math.abs(sim.state.pos.y - height) < 0.3) mem.held = (mem.held ?? 0) + (t - (mem.lastT ?? t));
    mem.lastT = t;
    return Math.abs(sim.state.pos.y - height) < 0.3 && (mem.held ?? 0) >= holdSeconds;
  },
  timeout: 60,
});

const goTo = (p: { x: number; y: number; z: number }, caption: string, opts: { heading?: 'keep' | 'toPilot' | number; vmax?: number; tol?: number } = {}): LessonStep => ({
  caption,
  run: ({ ap }) => {
    const h = opts.heading === 'toPilot' ? ap.headingToPilot() : typeof opts.heading === 'number' ? opts.heading : ap.heading;
    return ap.goTo(p, h, { vmax: opts.vmax ?? 3 });
  },
  done: ({ sim }) => {
    const s = sim.state;
    return Math.hypot(s.pos.x - p.x, s.pos.y - p.y, s.pos.z - p.z) < (opts.tol ?? 0.5) && Math.hypot(s.vel.x, s.vel.y, s.vel.z) < 0.6;
  },
  timeout: 90,
});

const hoverFor = (seconds: number, caption: string, heading: 'keep' | 'toPilot' = 'keep'): LessonStep => ({
  caption,
  run: ({ ap, sim, mem }) => {
    mem.x ??= sim.state.pos.x;
    mem.y ??= sim.state.pos.y;
    mem.z ??= sim.state.pos.z;
    return ap.goTo({ x: mem.x, y: mem.y, z: mem.z }, heading === 'toPilot' ? ap.headingToPilot() : ap.heading);
  },
  done: ({ t }) => t >= seconds,
});

const landOn = (target: { x: number; y: number; z: number }, caption: string): LessonStep[] => [
  goTo({ x: target.x, y: target.y + 1.6, z: target.z }, caption, { tol: 0.35, vmax: 2.5 }),
  {
    caption: 'Lower the collective a touch: sink slowly, keep the cyclic making tiny corrections to stay over the centre.',
    run: ({ ap, sim, mem, t }) => {
      const surface = target.y + skidHeight(sim);
      const h = sim.state.pos.y - surface;
      const s = sim.state;
      const offCentre = Math.hypot(s.pos.x - target.x, s.pos.z - target.z);
      const moving = Math.hypot(s.vel.x, s.vel.z);
      // Only commit to the final descent when centred and still; otherwise hold 30 cm up and keep correcting.
      const centred = offCentre < 0.15 && moving < 0.2;
      if (!centred && h < 0.4 && !mem.rampStart) {
        ap.goTo({ x: target.x, y: surface + 0.3, z: target.z }, ap.heading, { vzMax: 0.35, vmax: 1 });
        return ap.ctl;
      }
      ap.goTo({ x: target.x, y: surface - 0.15, z: target.z }, ap.heading, { vzMax: 0.35, vmax: 1 });
      // Ground effect makes the last 30 cm float; a steady, slow collective ramp is how you get through it.
      if (h < 0.35) {
        mem.rampStart ??= t;
        ap.ctl.collective = Math.min(ap.ctl.collective, ap.hover - 0.12 - (t - mem.rampStart) * 0.12);
      }
      return ap.ctl;
    },
    done: ({ sim }) => sim.state.onGround,
    timeout: 40,
  },
  {
    caption: 'On the surface: collective smoothly all the way down, cyclic still correcting until the skids are planted, then let the head speed drop.',
    run: ({ ap, sim, mem, t }) => {
      // Start the ramp from where the descent left the collective (not a generic hover value: in ground effect
      // that lifts a big heli straight back off) and keep the position hold alive until it is firmly down.
      mem.start ??= ap.ctl.collective;
      ap.goTo({ x: target.x, y: target.y + skidHeight(sim) - 0.3, z: target.z }, ap.heading, { vzMax: 0.3, vmax: 0.5 });
      ap.ctl.collective = Math.max(-1, mem.start - t * 0.5);
      if (t > 2.5) { ap.ctl.aileron = 0; ap.ctl.elevator = 0; ap.ctl.rudder = 0; }
      return ap.ctl;
    },
    done: ({ t, sim }) => t > 3 && !!sim.state.landed,
    timeout: 12,
  },
];

export const LESSONS: Lesson[] = [
  {
    challengeId: 'first-hover',
    title: 'First hover',
    intro: 'Normal mode. The throttle stick (left, up/down) is everything here: raise it slowly, the governor spools the head, and at about half stick the heli gets light on its skids.',
    steps: [
      spoolUp(0, 'Raise the throttle stick slowly. Watch the head speed climb; the heli stays on the pad until the blades make enough lift.'),
      liftTo(1.5, 'A little more collective: it lifts. Small, early cyclic corrections keep it over the pad. Ease the stick back a hair to stop the climb at about 1.5 m.', 10),
      {
        caption: 'Challenge done. Now lower the collective gently and let it settle back on the pad.',
        run: ({ ap, sim, mem, t }) => {
          ap.goTo({ x: PAD.x, y: skidHeight(sim) - 0.15, z: PAD.z }, ap.heading, { vzMax: 0.4 });
          if (sim.state.pos.y - skidHeight(sim) < 0.35) {
            mem.rampStart ??= t;
            ap.ctl.collective = Math.min(ap.ctl.collective, ap.hover - 0.12 - (t - mem.rampStart) * 0.12);
          }
          return ap.ctl;
        },
        done: ({ sim }) => sim.state.onGround,
        timeout: 30,
      },
    ],
  },
  {
    challengeId: 'hover-box',
    title: 'Hover in the box',
    intro: 'The heli never sits still by itself: you fly it with constant small cyclic inputs. Think "stop the drift" before it starts.',
    steps: [
      spoolUp(0, 'Spool up in Normal mode.'),
      liftTo(2, 'Lift to about 2 m.'),
      hoverFor(32, 'Hold position. Every time the heli starts drifting, a tiny opposite cyclic input stops it; then back to centre. Thirty seconds of this and the box is yours.'),
    ],
  },
  {
    challengeId: 'nose-in',
    title: 'Nose-in hover',
    intro: 'With the nose pointing at you, left and right on the cyclic are reversed from your point of view. The trick: "push the stick under the low side" works in every orientation.',
    steps: [
      spoolUp(0, 'Spool up.'),
      liftTo(2.5, 'Lift to about 2.5 m, tail-in first.'),
      {
        caption: 'Rudder: pedal the nose around until it points at you. The cyclic keeps correcting drift the whole time.',
        run: ({ ap, mem, sim }) => {
          mem.x ??= sim.state.pos.x;
          mem.z ??= sim.state.pos.z;
          return ap.goTo({ x: mem.x, y: 2.5, z: mem.z }, ap.headingToPilot());
        },
        done: ({ ap }) => {
          let e = ap.headingToPilot() - ap.heading;
          while (e > Math.PI) e -= 2 * Math.PI;
          while (e < -Math.PI) e += 2 * Math.PI;
          return Math.abs(e) < 0.15;
        },
        timeout: 20,
      },
      hoverFor(17, 'Nose-in: a drift to YOUR right needs stick to YOUR left. Push the stick toward the low side of the disc and the rule holds in every orientation.', 'toPilot'),
    ],
  },
  {
    challengeId: 'land-table',
    title: 'Picnic table landing',
    intro: 'Precision landings are slow and vertical: get over the target high, settle, then sink straight down.',
    steps: [spoolUp(0, 'Spool up.'), liftTo(2.5, 'Lift off.'), ...landOn({ x: 9, y: 0.9, z: -12 }, 'Fly over the table and stop above it, about 1.5 m up. Wait for the drift to die.')],
  },
  {
    challengeId: 'land-truck',
    title: 'Pickup bed landing',
    intro: 'Same as the table, with an obstacle: approach from behind the truck so the cab is never under the blades.',
    steps: [spoolUp(0, 'Spool up.'), liftTo(3, 'Lift off.'), goTo({ x: -14, y: 3, z: -17 }, 'Come in from behind the truck, high enough to clear the cab.', { vmax: 3 }), ...landOn({ x: -14, y: 1.0, z: -22 }, 'Hover over the bed, 1.5 m up, and let it settle.')],
  },
  {
    challengeId: 'land-pontoon',
    title: 'Pontoon landing',
    intro: 'Over water there is no ground reference next to the heli; use the pontoon and the far bank to judge height.',
    steps: [spoolUp(0, 'Spool up.'), liftTo(3, 'Lift off.'), goTo({ x: 42, y: 3, z: -22 }, 'Cruise over the pond. Keep some height; over water it is easy to sink without noticing.', { vmax: 4 }), ...landOn({ x: 42, y: 0.25, z: -22 }, 'Stop over the pontoon and settle.')],
  },
  {
    challengeId: 'land-tower',
    title: 'Tower pad landing',
    intro: 'Seven metres up there is no ground effect: the heli needs a bit more collective to hover, and the pad is small. Patience.',
    steps: [spoolUp(0, 'Spool up.'), liftTo(3, 'Lift off.'), goTo({ x: 22, y: 9, z: -42 }, 'Climb to above the tower; approach from the side so the pole stays clear of the blades.', { vmax: 4 }), ...landOn({ x: 22, y: 7, z: -42 }, 'Hover over the pad: notice it takes slightly more collective up here.')],
  },
  {
    challengeId: 'circuit',
    title: 'Gate circuit',
    intro: 'Forward flight: a little forward cyclic tilts the disc and the heli accelerates; more collective keeps the height as it does. Look at the next ring, not at the heli.',
    steps: [
      spoolUp(1, 'Spool up. Idle-Up 1 is comfortable for circuits: fixed head speed, centre stick = 0°.'),
      liftTo(4, 'Climb to the height of the first ring.'),
      ...GATES.map((g, i) => goTo({ x: g.x, y: g.y, z: g.z }, `Ring ${i + 1}: nose toward it, a touch of forward cyclic, hold height with collective. Slow down before the ring, not after.`, { tol: 1.2, vmax: 4, heading: 'keep' })),
      goTo({ x: PAD.x, y: 3, z: PAD.z }, 'Back to the pad.', { vmax: 4 }),
    ],
  },
  {
    challengeId: 'roll',
    title: 'Roll it',
    intro: 'Idle-Up gives negative pitch. A roll is full aileron plus a collective "pump": positive upright, through zero on the side, negative when inverted, positive again on the way out.',
    steps: [
      spoolUp(1, 'Idle-Up 1 for negative pitch. Spool up.'),
      liftTo(14, 'Climb high; height is your safety margin. 14 m is plenty.'),
      hoverFor(3, 'Settle the hover. Centre everything. Breathe.'),
      {
        caption: 'Full right aileron and hold it. Collective follows the roll: up when upright, centre on the side, below centre while inverted.',
        run: ({ ap, sim, mem }) => {
          sim.assist = 'rate'; // a roll needs the real rate controller; the attitude assist cannot bank past 35°
          const e = eulerFromQ(sim.state.ori);
          const upright = Math.cos(e.roll); // +1 upright, -1 inverted
          ap.ctl.aileron = 0.65; // not full: a flybar head boom-strikes under full cyclic at negative G
          ap.ctl.elevator = 0;
          ap.ctl.rudder = 0;
          ap.ctl.collective = 0.45 * upright + (upright > 0 ? 0.05 : -0.05);
          if (Math.abs(e.roll) > 2.8) mem.inverted = 1;
          return ap.ctl;
        },
        done: ({ sim, mem }) => !!mem.inverted && Math.abs(eulerFromQ(sim.state.ori).roll) < 0.4,
        timeout: 6,
      },
      {
        caption: 'Centre the aileron the instant it is level, collective back to hover. Catch the descent and you are done.',
        run: (ctx) => {
          ctx.sim.assist = 'attitude';
          return hoverFor(5, '').run(ctx);
        },
        done: ({ t }) => t >= 5,
      },
    ],
  },
  {
    challengeId: 'autorotation',
    title: 'Autorotation',
    intro: 'Throttle hold kills the motor; the rotor keeps turning because the air flowing up through the disc drives it, as long as the collective is low. At the bottom, the stored energy in the blades gives one cushioned landing.',
    steps: [
      spoolUp(1, 'Idle-Up 1. Spool up.'),
      liftTo(38, 'Climb to about 38 m. Autos need height.'),
      hoverFor(2, 'Settle.'),
      {
        caption: 'Throttle hold ON, collective well below centre. The heli drops fast; the head speed must stay up. Keep it level with the cyclic.',
        run: ({ ap, sim }) => {
          ap.ctl.throttleHold = true;
          ap.goTo({ x: sim.state.pos.x, y: -10, z: sim.state.pos.z }, ap.heading, { vzMax: 20 });
          ap.ctl.collective = -0.55;
          return ap.ctl;
        },
        done: ({ sim }) => sim.state.pos.y < 9,
        timeout: 30,
      },
      {
        caption: 'Flare: a little back cyclic to slow the descent, collective still low.',
        run: ({ ap, sim }) => {
          ap.ctl.throttleHold = true;
          ap.goTo({ x: sim.state.pos.x, y: -10, z: sim.state.pos.z }, ap.heading);
          ap.ctl.collective = -0.35;
          return ap.ctl;
        },
        done: ({ sim }) => sim.state.pos.y < 3.5,
        timeout: 10,
      },
      {
        caption: 'Now pull the collective up smoothly: the blades turn their stored energy into one cushion. Level skids, touch down.',
        run: ({ ap, sim, t }) => {
          ap.ctl.throttleHold = true;
          ap.goTo({ x: sim.state.pos.x, y: skidHeight(sim), z: sim.state.pos.z }, ap.heading);
          ap.ctl.collective = Math.min(0.9, 0.2 + t * 0.5);
          return ap.ctl;
        },
        done: ({ sim, t }) => sim.state.onGround && t > 1.5,
        timeout: 10,
      },
      {
        caption: 'Down. Collective to the bottom, hold stays on. That was an autorotation.',
        run: ({ ap }) => {
          ap.ctl.throttleHold = true;
          return ap.hold(-1);
        },
        done: ({ t }) => t > 3,
      },
    ],
  },
  {
    challengeId: 'endurance-5',
    title: 'Five minutes up',
    intro: 'Endurance is about calm: small inputs, no chasing. The demo shows the first minute; the rest is the same.',
    steps: [spoolUp(0, 'Spool up.'), liftTo(2, 'Lift off.'), hoverFor(60, 'Relax the hands. Fix drift early with tiny inputs; the less you move the stick the longer you last.')],
  },
  {
    challengeId: 'endurance-15',
    title: 'Fifteen minutes up',
    intro: 'Same as five minutes, three times. The demo shows one minute.',
    steps: [spoolUp(0, 'Spool up.'), liftTo(2, 'Lift off.'), hoverFor(60, 'Smooth, small, early. Fly a slow lap now and then to keep yourself awake.')],
  },

  // ---------------- The classic progression ----------------
  {
    challengeId: 'side-in-left',
    title: 'Side-in hover (nose left)',
    intro: 'Side-in is the half-way house between tail-in and nose-in: one cyclic axis is still "normal", the other is rotated 90°.',
    steps: [
      spoolUp(0, 'Spool up.'),
      liftTo(2.5, 'Lift to 2.5 m, tail-in.'),
      {
        caption: 'Rudder: turn the nose to YOUR left. Watch the elevator: pushing forward now moves the heli to your left.',
        run: ({ ap, mem, sim }) => { mem.x ??= sim.state.pos.x; mem.z ??= sim.state.pos.z; return ap.goTo({ x: mem.x, y: 2.5, z: mem.z }, ap.headingToPilot() + Math.PI / 2); },
        done: ({ ap }) => { let e = ap.headingToPilot() + Math.PI / 2 - ap.heading; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI; return Math.abs(e) < 0.15; },
        timeout: 20,
      },
      {
        caption: 'Hold it. Aileron still moves it toward/away from you; elevator moves it left/right. Fifteen seconds.',
        run: ({ ap, mem, sim }) => { mem.x ??= sim.state.pos.x; mem.z ??= sim.state.pos.z; return ap.goTo({ x: mem.x, y: 2.5, z: mem.z }, ap.headingToPilot() + Math.PI / 2); },
        done: ({ t }) => t >= 17,
      },
    ],
  },
  {
    challengeId: 'side-in-right',
    title: 'Side-in hover (nose right)',
    intro: 'Same drill, the other way. Practise both sides equally or one will always feel wrong.',
    steps: [
      spoolUp(0, 'Spool up.'),
      liftTo(2.5, 'Lift to 2.5 m, tail-in.'),
      {
        caption: 'Rudder: turn the nose to YOUR right.',
        run: ({ ap, mem, sim }) => { mem.x ??= sim.state.pos.x; mem.z ??= sim.state.pos.z; return ap.goTo({ x: mem.x, y: 2.5, z: mem.z }, ap.headingToPilot() - Math.PI / 2); },
        done: ({ ap }) => { let e = ap.headingToPilot() - Math.PI / 2 - ap.heading; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI; return Math.abs(e) < 0.15; },
        timeout: 20,
      },
      {
        caption: 'Hold it for fifteen seconds. Small, early corrections.',
        run: ({ ap, mem, sim }) => { mem.x ??= sim.state.pos.x; mem.z ??= sim.state.pos.z; return ap.goTo({ x: mem.x, y: 2.5, z: mem.z }, ap.headingToPilot() - Math.PI / 2); },
        done: ({ t }) => t >= 17,
      },
    ],
  },
  {
    challengeId: 'elevator',
    title: 'Elevator',
    intro: 'Pure collective work: climb and descend on the spot without the cyclic wandering. Lead with small collective changes and stop them early.',
    steps: [
      spoolUp(0, 'Spool up.'),
      liftTo(1.5, 'Hover low, about 1.5 m. Three seconds.', 3.5),
      liftTo(7, 'A little more collective, a steady climb to 7 m. Ease it back before you get there so you do not overshoot.', 3.5),
      liftTo(1.5, 'Collective down a touch: steady descent. Watch the sink rate; more collective early if it builds.', 3.5),
    ],
  },
  {
    challengeId: 'spot-landing',
    title: 'Spot landing',
    intro: 'A short flight, then come home and put it on the H. Approach high, stop over the pad, sink vertically.',
    steps: [
      spoolUp(0, 'Spool up.'),
      liftTo(3, 'Lift off.'),
      goTo({ x: -8, y: 4, z: -14 }, 'Fly a short leg out to the left...', { vmax: 3 }),
      goTo({ x: 8, y: 4, z: -14 }, '...and across to the right. At least twenty seconds in the air.', { vmax: 3 }),
      hoverFor(6, 'Hold here a moment.'),
      ...landOn({ x: 0, y: 0, z: -6 }, 'Back over the H, 1.5 m up, stop all drift.'),
    ],
  },
  {
    challengeId: 'pirouette',
    title: 'Pirouette',
    intro: 'A slow, constant rudder input while the cyclic keeps the heli on the spot. The cyclic "rotates" with the heli: push the stick toward the low side of the disc, whatever the nose is doing.',
    steps: [
      spoolUp(0, 'Spool up.'),
      liftTo(3, 'Lift to 3 m.'),
      hoverFor(2, 'Settle.'),
      {
        caption: 'A little constant rudder: the nose starts turning slowly. Keep the cyclic correcting toward the low side as the orientation changes.',
        run: ({ ap, mem, sim, t }) => {
          mem.x ??= sim.state.pos.x; mem.z ??= sim.state.pos.z; mem.h0 ??= ap.heading;
          return ap.goTo({ x: mem.x, y: 3, z: mem.z }, mem.h0 + t * 0.6);
        },
        done: ({ t }) => t >= (2 * Math.PI) / 0.6 + 1,
      },
      hoverFor(3, 'Full circle. Rudder to centre and settle.'),
    ],
  },
  {
    challengeId: 'figure-eight',
    title: 'Figure eight',
    intro: 'Two circles joined in the middle, flown nose-first. The turns away from you are easy; the ones toward you are where orientation changes. Use rudder with the aileron to keep the nose on the path.',
    steps: [
      spoolUp(1, 'Spool up in Idle-Up 1.'),
      liftTo(4, 'Climb to ring height.'),
      ...EIGHT_GATES.map((g, i) => goTo({ x: g.x, y: g.y, z: g.z }, `Ring ${i + 1} of 7: coordinated turn, nose into it, hold height with collective.`, { tol: 1.3, vmax: 4, heading: 'keep' })),
      goTo({ x: 0, y: 3, z: -6 }, 'Back to the pad.', { vmax: 4 }),
    ],
  },
  {
    challengeId: 'loop',
    title: 'Loop',
    intro: 'Idle-Up for negative pitch. Forward speed helps. Pull elevator through; collective positive on the way up, back through zero over the top, positive again on the way down to level.',
    steps: [
      spoolUp(1, 'Idle-Up 1. Spool up.'),
      liftTo(16, 'Climb to 16 m: plenty of margin.'),
      hoverFor(3, 'Settle and centre everything.'),
      {
        caption: 'Back elevator and hold it. Collective follows the loop: positive upright, centre on the way over, slightly negative inverted.',
        run: ({ ap, sim, mem }) => {
          sim.assist = 'rate';
          const up = rotate(sim.state.ori, v3(0, 1, 0));
          const fwd = rotate(sim.state.ori, v3(0, 0, -1));
          ap.ctl.elevator = -0.65; // not full: a flybar head boom-strikes under full cyclic at negative G
          ap.ctl.aileron = 0;
          ap.ctl.rudder = 0;
          ap.ctl.collective = 0.45 * up.y + (up.y > 0 ? 0.05 : -0.05);
          if (fwd.y > 0.7) mem.up = 1;
          if (mem.up && up.y < -0.6) mem.inv = 1;
          return ap.ctl;
        },
        done: ({ sim, mem }) => !!mem.inv && rotate(sim.state.ori, v3(0, 1, 0)).y > 0.85 && Math.abs(rotate(sim.state.ori, v3(0, 0, -1)).y) < 0.4,
        timeout: 7,
      },
      {
        caption: 'Level: elevator to centre, collective back to hover, catch the descent.',
        run: (ctx) => { ctx.sim.assist = 'attitude'; return hoverFor(5, '').run(ctx); },
        done: ({ t }) => t >= 5,
      },
    ],
  },
  {
    challengeId: 'inverted-hover',
    title: 'Inverted hover',
    intro: 'Inverted, collective works the other way (push the stick down to go up) and elevator is reversed from your point of view; aileron feels the same. Idle-Up, plenty of height.',
    steps: [
      spoolUp(1, 'Idle-Up 1. Spool up.'),
      liftTo(14, 'Climb to 14 m.'),
      hoverFor(2, 'Settle.'),
      {
        caption: 'Full aileron to roll inverted; as it passes the side, push the collective below centre.',
        run: ({ ap, sim }) => {
          sim.assist = 'rate';
          const up = rotate(sim.state.ori, v3(0, 1, 0));
          ap.ctl.aileron = 1; ap.ctl.elevator = 0; ap.ctl.rudder = 0;
          ap.ctl.collective = 0.45 * up.y;
          return ap.ctl;
        },
        done: ({ sim }) => rotate(sim.state.ori, v3(0, 1, 0)).y < -0.9,
        timeout: 5,
      },
      {
        caption: 'Inverted hover: collective below centre holds the height, small cyclic corrections keep it level upside down. Ten seconds.',
        run: ({ ap, sim, mem }) => {
          sim.assist = 'rate';
          const s = sim.state;
          const up = rotate(s.ori, v3(0, 1, 0));
          const fwd = rotate(s.ori, v3(0, 0, -1));
          const right = rotate(s.ori, v3(1, 0, 0));
          mem.y ??= s.pos.y;
          mem.x ??= s.pos.x;
          mem.z ??= s.pos.z;
          const c = sim.model.controller;
          // Position hold while inverted. Wanted world acceleration from the position/velocity error, like goTo.
          const g = 9.81;
          let vxW = mem.x - s.pos.x;
          let vzW = mem.z - s.pos.z;
          const vm = Math.hypot(vxW, vzW);
          if (vm > 1.5) { vxW *= 1.5 / vm; vzW *= 1.5 / vm; }
          const axW = 1.4 * (vxW - s.vel.x);
          const azW = 1.4 * (vzW - s.vel.z);
          const rl = Math.hypot(right.x, right.z) || 1;
          const fl = Math.hypot(fwd.x, fwd.z) || 1;
          const aRight = (axW * right.x + azW * right.z) / rl;
          const aFwd = (axW * fwd.x + azW * fwd.z) / fl;
          // Inverted: a roll to the right makes right.y positive and tilts the thrust AWAY from the right vector;
          // a nose-down pitch makes fwd.y positive and tilts the thrust backwards. Hence the wanted tilts below.
          const rightYWanted = Math.max(-0.3, Math.min(0.3, -aRight / g));
          const fwdYWanted = Math.max(-0.3, Math.min(0.3, -aFwd / g));
          ap.ctl.aileron = Math.max(-1, Math.min(1, (-(right.y - rightYWanted) * 8) / c.cyclicRate));
          ap.ctl.elevator = Math.max(-1, Math.min(1, (-(fwd.y - fwdYWanted) * 8) / c.cyclicRate));
          ap.ctl.rudder = 0;
          // Inverted: more negative collective = more lift upward.
          const vyWanted = Math.max(-1, Math.min(1, (mem.y - s.pos.y)));
          ap.ctl.collective = Math.max(-1, Math.min(0, -0.45 - 0.35 * (vyWanted - s.vel.y)));
          void up;
          return ap.ctl;
        },
        done: ({ t }) => t >= 12,
      },
      {
        caption: 'Roll back upright: full aileron, collective through zero to positive as it comes level.',
        run: ({ ap, sim }) => {
          sim.assist = 'rate';
          const up = rotate(sim.state.ori, v3(0, 1, 0));
          ap.ctl.aileron = 1; ap.ctl.elevator = 0; ap.ctl.rudder = 0;
          ap.ctl.collective = 0.45 * up.y;
          return ap.ctl;
        },
        done: ({ sim }) => rotate(sim.state.ori, v3(0, 1, 0)).y > 0.9,
        timeout: 5,
      },
      {
        caption: 'Upright. Catch the descent and settle.',
        run: (ctx) => { ctx.sim.assist = 'attitude'; return hoverFor(5, '').run(ctx); },
        done: ({ t }) => t >= 5,
      },
    ],
  },
  {
    challengeId: 'nose-in-circuit',
    title: 'Nose-in circuit',
    intro: 'The circuit flown with the nose always toward you: you are flying backwards and sideways with reversed cyclic. Slow, and keep the rudder working to hold the nose on you.',
    steps: [
      spoolUp(1, 'Spool up in Idle-Up 1.'),
      liftTo(4, 'Climb to ring height.'),
      {
        caption: 'Turn the nose toward you first.',
        run: ({ ap, sim, mem }) => { mem.x ??= sim.state.pos.x; mem.z ??= sim.state.pos.z; return ap.goTo({ x: mem.x, y: 4, z: mem.z }, ap.headingToPilot()); },
        done: ({ ap }) => { let e = ap.headingToPilot() - ap.heading; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI; return Math.abs(e) < 0.2; },
        timeout: 20,
      },
      ...GATES.map((g, i) => goTo({ x: g.x, y: g.y, z: g.z }, `Ring ${i + 1}: slide toward it nose-in. Aileron is reversed from your view; elevator pulls it toward you.`, { tol: 1.3, vmax: 2.5, heading: 'toPilot' })),
      goTo({ x: 0, y: 3, z: -6 }, 'Back to the pad, still nose-in.', { vmax: 2.5, heading: 'toPilot' }),
    ],
  },

  // ---------------- The hard stuff ----------------
  {
    challengeId: 'landing-streak',
    title: 'Three clean landings',
    intro: 'Consistency is the real skill: three take-offs, three short flights, three landings on the H without a scare.',
    steps: [
      spoolUp(0, 'Spool up.'),
      ...[1, 2, 3].flatMap((i) => [
        liftTo(3, `Flight ${i}: lift to 3 m and hold.`, 11),
        ...landOn({ x: 0, y: 0, z: -6 }, `Flight ${i}: back over the H and settle.`),
      ]),
    ],
  },
  {
    challengeId: 'stall-turn',
    title: 'Stall turn',
    intro: 'Energy management: speed becomes height, the nose pivots on the rudder at the top, height becomes speed again. Idle-Up, lots of room.',
    steps: [
      spoolUp(1, 'Idle-Up 1. Spool up.'),
      liftTo(12, 'Climb to 12 m.'),
      {
        caption: 'Accelerate hard forward: nose down with forward cyclic, collective up to hold height. Over 8 m/s.',
        run: ({ ap, sim }) => ap.goTo({ x: sim.state.pos.x, y: 12, z: sim.state.pos.z - 60 }, ap.heading, { vmax: 12 }),
        done: ({ sim }) => Math.hypot(sim.state.vel.x, sim.state.vel.z) > 8.5,
        timeout: 20,
      },
      {
        caption: 'Pull: back elevator until the nose points straight up. Collective positive through the pull.',
        run: ({ ap, sim }) => {
          sim.assist = 'rate';
          const fwd = rotate(sim.state.ori, v3(0, 0, -1));
          const up = rotate(sim.state.ori, v3(0, 1, 0));
          const pitch = Math.atan2(fwd.y, up.y); // 0 level, pi/2 straight up, beyond = over the top
          ap.ctl.elevator = Math.max(-1, Math.min(1, (pitch - Math.PI / 2) * 1.6));
          ap.ctl.aileron = 0; ap.ctl.rudder = 0; ap.ctl.collective = 0.45;
          return ap.ctl;
        },
        done: ({ sim }) => { const fwd = rotate(sim.state.ori, v3(0, 0, -1)); const up = rotate(sim.state.ori, v3(0, 1, 0)); return Math.atan2(fwd.y, up.y) > 1.45; },
        timeout: 4,
      },
      {
        caption: 'Vertical: full rudder now, while it is still going up. Elevator centred; collective near zero. The nose swings over the top to point straight down.',
        run: ({ ap, sim }) => {
          sim.assist = 'rate';
          ap.ctl.rudder = 1; ap.ctl.aileron = 0; ap.ctl.collective = 0.05; ap.ctl.elevator = 0;
          return ap.ctl;
        },
        done: ({ sim }) => rotate(sim.state.ori, v3(0, 0, -1)).y < -0.55,
        timeout: 3,
      },
      {
        caption: 'Dive: rudder centred, a touch of forward elevator to point straight down, collective near zero.',
        run: ({ ap, sim }) => {
          sim.assist = 'rate';
          ap.ctl.rudder = 0; ap.ctl.aileron = 0; ap.ctl.collective = 0.0;
          const fwd = rotate(sim.state.ori, v3(0, 0, -1));
          ap.ctl.elevator = fwd.y > -0.7 ? 0.8 : 0;
          return ap.ctl;
        },
        done: ({ sim, t }) => t > 0.3 && rotate(sim.state.ori, v3(0, 0, -1)).y < -0.5 && sim.state.vel.y < -2,
        timeout: 4,
      },
      {
        caption: 'Pull out: back elevator to level, easing off as the nose comes up; collective up to catch it. Height is your margin.',
        run: ({ ap, sim }) => {
          sim.assist = 'rate';
          const fwd = rotate(sim.state.ori, v3(0, 0, -1));
          const up = rotate(sim.state.ori, v3(0, 1, 0));
          const right = rotate(sim.state.ori, v3(1, 0, 0));
          const c = sim.model.controller;
          const pitch = Math.atan2(fwd.y, up.y); // negative = nose down
          ap.ctl.elevator = Math.max(-1, Math.min(1, pitch * 1.6));
          ap.ctl.aileron = Math.max(-1, Math.min(1, (right.y * 8) / c.cyclicRate)); // wings level too
          ap.ctl.rudder = 0;
          ap.ctl.collective = 0.3 + 0.5 * Math.max(0, up.y);
          return ap.ctl;
        },
        done: ({ sim }) => { const up = rotate(sim.state.ori, v3(0, 1, 0)); const fwd = rotate(sim.state.ori, v3(0, 0, -1)); return up.y > 0.85 && Math.abs(fwd.y) < 0.3; },
        timeout: 4,
      },
      {
        caption: 'Level. Settle the hover.',
        run: (ctx) => { ctx.sim.assist = 'attitude'; return hoverFor(5, '').run(ctx); },
        done: ({ t }) => t >= 5,
      },
    ],
  },
  {
    challengeId: 'funnel',
    title: 'Funnel',
    intro: 'A steep banked circle with the tail low and the nose pointing at the centre. Bank with aileron, pull with elevator to turn, collective holds the height. Idle-Up, high.',
    steps: [
      spoolUp(1, 'Idle-Up 1. Spool up.'),
      liftTo(12, 'Climb to 12 m.'),
      goTo({ x: 0, y: 12, z: -14 }, 'A little forward speed to start the circle.', { vmax: 6, tol: 3 }),
      {
        caption: 'Roll to about 60° of bank and hold it with aileron; back elevator keeps the circle turning; collective up to hold the height.',
        run: ({ ap, sim, mem }) => {
          sim.assist = 'rate';
          const s = sim.state;
          const right = rotate(s.ori, v3(1, 0, 0));
          const c = sim.model.controller;
          mem.y ??= s.pos.y;
          mem.prev ??= eulerFromQ(s.ori).yaw;
          let d = eulerFromQ(s.ori).yaw - mem.prev;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          mem.prev = eulerFromQ(s.ori).yaw;
          mem.acc = (mem.acc ?? 0) + d;
          // Bank right 55°: right.y = -sin(55°).
          const target = -Math.sin((55 * Math.PI) / 180);
          ap.ctl.aileron = Math.max(-1, Math.min(1, ((target - right.y) * -6) / c.cyclicRate * 4));
          ap.ctl.elevator = -0.35;
          ap.ctl.rudder = 0.1;
          const vy = s.vel.y;
          ap.ctl.collective = Math.max(-0.2, Math.min(1, 0.6 + 0.3 * ((mem.y - s.pos.y) * 0.8 - vy)));
          return ap.ctl;
        },
        done: ({ mem }) => Math.abs(mem.acc ?? 0) > 2 * Math.PI + 2.5,
        timeout: 25,
      },
      {
        caption: 'Roll level, settle.',
        run: (ctx) => { ctx.sim.assist = 'attitude'; return hoverFor(5, '').run(ctx); },
        done: ({ t }) => t >= 5,
      },
    ],
  },
  {
    challengeId: 'tic-toc',
    title: 'Tic-toc',
    intro: 'Nose swings up past 30°, then down past 30°, tail-low, on the spot; collective pumps up each time the disc faces upward. Rhythm, not force. Idle-Up, high.',
    steps: [
      spoolUp(1, 'Idle-Up 1. Spool up.'),
      liftTo(12, 'Climb to 12 m.'),
      hoverFor(2, 'Settle.'),
      {
        caption: 'Back elevator to 40° nose up, then forward to 40° nose down, again and again. Collective up when the disc points up, off when it points sideways.',
        run: ({ ap, sim, mem }) => {
          sim.assist = 'rate';
          const s = sim.state;
          const fwd = rotate(s.ori, v3(0, 0, -1));
          const up = rotate(s.ori, v3(0, 1, 0));
          mem.dir ??= -1; // start nose up
          if (mem.dir === -1 && fwd.y > 0.68) { mem.dir = 1; mem.n = (mem.n ?? 0) + 1; }
          if (mem.dir === 1 && fwd.y < -0.68) { mem.dir = -1; mem.n = (mem.n ?? 0) + 1; }
          ap.ctl.elevator = mem.dir;
          ap.ctl.aileron = 0;
          ap.ctl.rudder = 0;
          ap.ctl.collective = 0.15 + 0.6 * Math.max(0, up.y) * Math.max(0, up.y);
          return ap.ctl;
        },
        done: ({ mem }) => (mem.n ?? 0) >= 5,
        timeout: 14,
      },
      {
        caption: 'Elevator centred, back to a hover.',
        run: (ctx) => { ctx.sim.assist = 'attitude'; return hoverFor(5, '').run(ctx); },
        done: ({ t }) => t >= 5,
      },
    ],
  },
  {
    challengeId: 'piro-flip',
    title: 'Piro flip',
    intro: 'A flip and a pirouette at the same time: full elevator and full rudder together, collective following the disc. Everything is changing at once; feel it rather than think it. Idle-Up, very high.',
    steps: [
      spoolUp(1, 'Idle-Up 1. Spool up.'),
      liftTo(30, 'Climb to 30 m. A piro flip eats height while you learn it.'),
      hoverFor(2, 'Settle.'),
      {
        caption: 'Full rudder for the piro. The cyclic points in ONE direction in the world (not on the heli): as the heli turns under it, the stick moves round the gimbal: back, left, forward, right...',
        run: ({ ap, sim, mem, t }) => {
          sim.assist = 'rate';
          const s = sim.state;
          const up = rotate(s.ori, v3(0, 1, 0));
          const fwd = rotate(s.ori, v3(0, 0, -1));
          const right = rotate(s.ori, v3(1, 0, 0));
          const c = sim.model.controller;
          // Flip axis fixed in the world: the heli's right axis at the start. The body-up vector must follow a
          // target that rotates about that axis (attitude tracking, with feed-forward), so the pirouette underneath
          // does not matter: whatever the heading, the cyclic is whatever brings 'up' toward its target.
          if (mem.ax === undefined) { mem.ax = right.x; mem.az = right.z; }
          const a = v3(mem.ax, 0, mem.az); // unit, horizontal
          const T = (2 * Math.PI) / (0.6 * c.cyclicRate); // one flip at 60% of the max rate
          const phi = Math.min(2 * Math.PI, (t / T) * 2 * Math.PI);
          // Rotate world-up about axis a by phi (Rodrigues; a is perpendicular to up).
          const upT = v3(-a.z * Math.sin(phi), Math.cos(phi), a.x * Math.sin(phi));
          // Angular velocity (world) that drives up toward upT, plus the nominal feed-forward about the axis.
          const err = v3(up.y * upT.z - up.z * upT.y, up.z * upT.x - up.x * upT.z, up.x * upT.y - up.y * upT.x);
          const ff = phi < 2 * Math.PI ? (2 * Math.PI) / T : 0;
          const w = v3(a.x * ff + err.x * 6, err.y * 6, a.z * ff + err.z * 6);
          const pitchRate = w.x * right.x + w.y * right.y + w.z * right.z; // about body x (nose up positive)
          const rollRight = w.x * fwd.x + w.y * fwd.y + w.z * fwd.z; // about body forward (-z), right positive
          ap.ctl.elevator = Math.max(-1, Math.min(1, -pitchRate / c.cyclicRate));
          ap.ctl.aileron = Math.max(-1, Math.min(1, rollRight / c.cyclicRate));
          ap.ctl.rudder = 1;
          ap.ctl.collective = 0.65 * up.y + 0.15;
          if (up.y < -0.6) mem.inv = 1;
          mem.phi = phi;
          return ap.ctl;
        },
        done: ({ sim, mem }) => !!mem.inv && (mem.phi ?? 0) >= 2 * Math.PI && rotate(sim.state.ori, v3(0, 1, 0)).y > 0.85,
        timeout: 8,
      },
      {
        caption: 'Centre everything, catch the descent.',
        run: (ctx) => { ctx.sim.assist = 'attitude'; return hoverFor(5, '').run(ctx); },
        done: ({ t }) => t >= 5,
      },
    ],
  },
];

export function lessonFor(challengeId: string): Lesson | undefined {
  return LESSONS.find((l) => l.challengeId === challengeId);
}

/** Runs a lesson against the sim: call update(dt) every frame and feed the returned controls to the sim. */
/**
 * 'show': the demo pilot flies and you watch the sticks.
 * 'teach': YOU fly. The same steps and captions, but the pilot only computes a hint (the stick position it
 * would use right now, from the real state) that the overlay draws as a ghost knob; a step advances when
 * your flying satisfies it. No timeouts, and a crash restarts the lesson.
 */
export type LessonMode = 'show' | 'teach';

export class LessonRunner {
  stepIndex = 0;
  private t = 0;
  private mem: Record<string, number> = {};
  readonly ap: Autopilot;
  finished = false;
  failed: string | null = null;
  private frame: ControlFrame = neutralFrame();
  /** Teach mode: what the demo pilot would do right now, translated for the player's assist mode. */
  hint: ControlFrame = neutralFrame();
  /** Teach mode: set when the player crashed; the host resets and restarts. */
  crashed = false;

  constructor(public lesson: Lesson, private sim: HelicopterSim, public mode: LessonMode = 'show') {
    this.ap = new Autopilot(sim);
    this.ap.setMode(0);
  }

  get step(): LessonStep | undefined {
    return this.lesson.steps[this.stepIndex];
  }

  restart(): void {
    this.stepIndex = 0;
    this.t = 0;
    this.mem = {};
    this.finished = false;
    this.failed = null;
    this.crashed = false;
  }

  /** Show mode: returns the demo pilot's controls for this frame. */
  update(dt: number): ControlFrame {
    const step = this.step;
    if (!step || this.finished) return this.frame;
    const ctx: StepContext = { sim: this.sim, ap: this.ap, t: this.t, dt, mem: this.mem };
    this.frame = { ...step.run(ctx) };
    this.t += dt;
    if (this.sim.state.crashed) {
      this.failed = 'The demo crashed (physics is physics). Try the lesson again.';
      this.finished = true;
      return this.frame;
    }
    if (step.done(ctx) || (step.timeout !== undefined && this.t > step.timeout)) {
      if (step.timeout !== undefined && this.t > step.timeout && !step.done(ctx)) this.failed = `Step timed out: ${step.caption.slice(0, 40)}…`;
      this.stepIndex++;
      this.t = 0;
      this.mem = {};
      if (this.stepIndex >= this.lesson.steps.length) this.finished = true;
    }
    return this.frame;
  }

  /** Teach mode: evaluate the step against the player's flying and compute the hint. */
  coach(dt: number, player: ControlFrame): void {
    const step = this.step;
    if (!step || this.finished) return;
    if (this.sim.state.crashed) {
      this.crashed = true;
      return;
    }
    const assistBefore = this.sim.assist;
    const ctx: StepContext = { sim: this.sim, ap: this.ap, t: this.t, dt, mem: this.mem };
    // Let the step compute what the pilot would do (it may switch assist for the roll; keep that, it is advice for the player too).
    this.ap.usedGoTo = false;
    const h = step.run(ctx);
    const hint = { ...h };
    // Explicit stick commands (the roll's full aileron) pass through; only attitude-style advice is translated.
    if (this.ap.usedGoTo && this.sim.assist === 'rate' && assistBefore === 'rate') {
      // The pilot thinks in bank angles; in rate mode the stick commands a rate, so hint the rate that closes the angle gap.
      const e = eulerFromQ(this.sim.state.ori);
      const c = this.sim.model.controller;
      const pitchTarget = -this.ap.wantedTiltFwd;
      const rollTarget = this.ap.wantedTiltRight;
      hint.elevator = Math.max(-1, Math.min(1, (-(pitchTarget - e.pitch) * 6) / c.cyclicRate));
      hint.aileron = Math.max(-1, Math.min(1, ((rollTarget - e.roll) * 6) / c.cyclicRate));
    }
    // The flight mode and hold switches are advice too; the player must set them (hint shows the wanted state).
    this.hint = hint;
    this.t += dt;
    if (step.done(ctx)) {
      this.stepIndex++;
      this.t = 0;
      this.mem = {};
      if (this.stepIndex >= this.lesson.steps.length) this.finished = true;
    }
    void player;
  }
}
