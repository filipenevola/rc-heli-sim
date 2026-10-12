import type { HelicopterSim, AssistMode } from '../sim/physics';
import type { ControlFrame } from '../input/types';
import { eulerFromQ } from '../sim/math';
import { Autopilot } from './autopilot';

/**
 * Rescue: the buddy box. While engaged, the demo pilot takes the sticks, rolls the model upright, stops the drift
 * and holds a hover where it is (climbing to a safe height first when it is low). Let go and the sticks come
 * straight back. Like an instructor's trainer switch, or the rescue button on a modern FBL unit.
 *
 * It flies through the self-levelling assist (the autopilot commands bank angles), so the pilot's assist choice is
 * parked while rescue is on and restored after.
 */
export class Rescue {
  active = false;
  private ap: Autopilot;
  private target: { x: number; y: number; z: number } | null = null;
  private heading = 0;
  private parkedAssist: AssistMode | null = null;
  private mode: 0 | 1 | 2 = 1;

  constructor(private sim: HelicopterSim) {
    this.ap = new Autopilot(sim);
  }

  /** Engage (idempotent). Needs a spinning rotor; on the ground there is nothing to rescue. */
  engage(): boolean {
    const s = this.sim.state;
    if (s.crashed || s.onGround) return false;
    if (!this.active) {
      this.active = true;
      this.parkedAssist = this.sim.assist;
      this.sim.assist = 'attitude';
      // Hover at least 3 m up: a rescue from a low dive needs room. Keep the heading it has (flattened).
      const ground = this.sim.world.groundAt(s.pos.x, s.pos.z);
      this.target = { x: s.pos.x, y: Math.max(s.pos.y, ground + 3), z: s.pos.z };
      this.heading = eulerFromQ(s.ori).yaw;
      // Idle-Up unless the pilot is in Normal with the head still up to speed; the hover stick follows the mode.
      this.mode = this.sim.lastControls?.flightMode ?? 1;
      if (this.mode === 0 && s.rotorOmega < 0.8 * this.sim.model.headspeeds[0]) this.mode = 1;
      this.ap.setMode(this.mode);
    }
    return true;
  }

  release(): void {
    if (!this.active) return;
    this.active = false;
    if (this.parkedAssist) this.sim.assist = this.parkedAssist;
    this.parkedAssist = null;
    this.target = null;
  }

  /** The sticks while engaged: the pilot's flight mode/hold are ignored (hold off, so the rotor can pull). */
  update(pilot: ControlFrame): ControlFrame {
    if (!this.active || !this.target) return pilot;
    const s = this.sim.state;
    if (s.crashed) { this.release(); return pilot; }
    // Once the heli has settled over the spot, let the pilot's collective nudge the height target: a rescue is
    // not a cage, it is a steady hand.
    const ctl = this.ap.goTo(this.target, this.heading, { vmax: 2.5, vzMax: 2 });
    ctl.flightMode = this.mode;
    ctl.throttleHold = false;
    return ctl;
  }
}
