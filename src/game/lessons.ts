import type { HelicopterSim } from '../sim/physics';
import { eulerFromQ } from '../sim/math';
import { Autopilot } from './autopilot';
import { GATES } from './challenges';
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

const SKID_Y = 0.117; // CG height when a 450 sits on its skids
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
  run: ({ ap, sim }) => ap.goTo({ x: sim.state.pos.x, y: height, z: sim.state.pos.z }, ap.heading, { vzMax: 0.8 }),
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
      const surface = target.y + SKID_Y;
      const h = sim.state.pos.y - surface;
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
    caption: 'On the surface: collective all the way down, then let the head speed drop. Hold the cyclic still.',
    run: ({ ap, t }) => ap.hold(Math.max(-1, ap.hover - t * 0.6)),
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
          ap.goTo({ x: PAD.x, y: SKID_Y - 0.15, z: PAD.z }, ap.heading, { vzMax: 0.4 });
          if (sim.state.pos.y - SKID_Y < 0.35) {
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
          ap.ctl.aileron = 1;
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
          ap.goTo({ x: sim.state.pos.x, y: SKID_Y, z: sim.state.pos.z }, ap.heading);
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
