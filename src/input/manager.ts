import { applyShaping, neutralFrame, type ControlFrame, type InputSource, type StickShaping } from './types';
import { KeyboardInput } from './keyboard';
import { GamepadInput, hasSwitch } from './gamepad';
import { TouchInput } from './touch';
import { MotionInput } from './motion';
import { RemoteInput } from './remote';

export type SourceChoice = 'auto' | 'keyboard' | 'gamepad' | 'touch' | 'motion' | 'remote';

/**
 * Picks the active input source and applies transmitter-style shaping (expo, dual rates, deadband).
 * In 'auto' the most recently used device wins, with the real transmitter preferred when plugged in.
 */
export class InputManager {
  readonly keyboard: KeyboardInput;
  readonly gamepad: GamepadInput;
  readonly touch: TouchInput;
  readonly motion: MotionInput;
  readonly remote: RemoteInput;
  choice: SourceChoice = 'auto';
  active: InputSource;
  /** Extra cyclic rate multiplier in Normal mode only (1 = same as Idle-Up). */
  normalRate = 1;
  shaping: Record<'aileron' | 'elevator' | 'rudder', StickShaping> = {
    aileron: { expo: 0.3, rate: 1, deadband: 0.02 },
    elevator: { expo: 0.3, rate: 1, deadband: 0.02 },
    rudder: { expo: 0.3, rate: 1, deadband: 0.02 },
  };
  private out = neutralFrame();

  constructor(touchContainer: HTMLElement) {
    this.keyboard = new KeyboardInput();
    this.gamepad = new GamepadInput();
    this.touch = new TouchInput(touchContainer);
    this.motion = new MotionInput(this.touch);
    this.remote = new RemoteInput();
    this.active = this.touch.available() ? this.touch : this.keyboard;
  }

  /** Switch source. Phone tilt needs a permission prompt on iOS, which is why this is async and must run from a tap. */
  async select(choice: SourceChoice): Promise<boolean> {
    if (choice === 'motion') {
      const ok = await this.motion.enable();
      if (!ok) {
        this.choice = 'touch';
        return false;
      }
    }
    this.choice = choice;
    return true;
  }

  private pick(): InputSource {
    if (this.choice !== 'auto') return this.choice === 'remote' && !this.remote.available() ? this.keyboard : this[this.choice];
    const candidates: InputSource[] = [this.remote, this.gamepad, this.touch, this.keyboard].filter((s) => s.available());
    let best = candidates[0] ?? this.keyboard;
    for (const s of candidates) if (s.lastActivity() > best.lastActivity()) best = s;
    // Prefer a real radio (the phone link, then the USB transmitter) unless something else was touched in the last few seconds.
    if (performance.now() - best.lastActivity() > 4000) {
      if (this.remote.available()) best = this.remote;
      else if (this.gamepad.available()) best = this.gamepad;
    }
    return best;
  }

  poll(dt: number): ControlFrame {
    // Poll everything so activity timestamps stay fresh, then use the chosen one.
    const frames = {
      keyboard: this.keyboard.poll(dt),
      gamepad: this.gamepad.poll(dt),
      touch: this.touch.poll(dt),
      motion: this.motion.poll(dt),
      remote: this.remote.poll(dt),
    };
    const next = this.pick();
    if (next !== this.active) {
      this.active = next;
      this.touch.setEnabled(next === this.touch || next === this.motion);
      this.motion.setEnabled(next === this.motion);
    }
    const raw = frames[this.active.id];
    const o = this.out;
    o.aileron = applyShaping(raw.aileron, this.shaping.aileron);
    o.elevator = applyShaping(raw.elevator, this.shaping.elevator);
    o.rudder = applyShaping(raw.rudder, this.shaping.rudder);
    // Dual rates by flight mode, as on a real radio: a lower cyclic rate in Normal for calm hovering, full in Idle-Up.
    const kbMode = frames.keyboard.flightMode;
    const ownSwitches = this.active === this.remote || (this.active === this.gamepad && hasSwitch(this.gamepad.mapping, 'flightMode'));
    const mode = ownSwitches ? raw.flightMode : kbMode;
    if (mode === 0 && this.normalRate < 1) {
      o.aileron *= this.normalRate;
      o.elevator *= this.normalRate;
    }
    o.collective = Math.max(-1, Math.min(1, raw.collective));
    // Mode/hold toggles from the keyboard apply to every source unless the transmitter has them on a switch.
    const kb = frames.keyboard;
    o.flightMode = ownSwitches ? raw.flightMode : kb.flightMode;
    o.throttleHold = this.active === this.remote || (this.active === this.gamepad && hasSwitch(this.gamepad.mapping, 'throttleHold')) ? raw.throttleHold : kb.throttleHold;
    // A rescue switch on the transmitter works whichever source is active: it is the panic switch.
    o.rescue = frames.gamepad.rescue ?? (this.remote.available() ? frames.remote.rescue : undefined);
    return o;
  }

  /** Raw (unshaped) frame from the active source, for the HUD stick display. */
  get rawFrame(): ControlFrame { return this.out; }
}
