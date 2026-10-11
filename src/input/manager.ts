import { applyShaping, neutralFrame, type ControlFrame, type InputSource, type StickShaping } from './types';
import { KeyboardInput } from './keyboard';
import { GamepadInput } from './gamepad';
import { TouchInput } from './touch';

export type SourceChoice = 'auto' | 'keyboard' | 'gamepad' | 'touch';

/**
 * Picks the active input source and applies transmitter-style shaping (expo, dual rates, deadband).
 * In 'auto' the most recently used device wins, with the real transmitter preferred when plugged in.
 */
export class InputManager {
  readonly keyboard: KeyboardInput;
  readonly gamepad: GamepadInput;
  readonly touch: TouchInput;
  choice: SourceChoice = 'auto';
  active: InputSource;
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
    this.active = this.touch.available() ? this.touch : this.keyboard;
  }

  private pick(): InputSource {
    if (this.choice !== 'auto') return this[this.choice];
    const candidates: InputSource[] = [this.gamepad, this.touch, this.keyboard].filter((s) => s.available());
    let best = candidates[0] ?? this.keyboard;
    for (const s of candidates) if (s.lastActivity() > best.lastActivity()) best = s;
    // Prefer the transmitter unless something else was touched in the last few seconds.
    if (this.gamepad.available() && performance.now() - best.lastActivity() > 4000) best = this.gamepad;
    return best;
  }

  poll(dt: number): ControlFrame {
    // Poll everything so activity timestamps stay fresh, then use the chosen one.
    const frames = {
      keyboard: this.keyboard.poll(dt),
      gamepad: this.gamepad.poll(dt),
      touch: this.touch.poll(dt),
    };
    const next = this.pick();
    if (next !== this.active) {
      this.active = next;
      this.touch.setEnabled(next === this.touch);
    }
    const raw = frames[this.active.id];
    const o = this.out;
    o.aileron = applyShaping(raw.aileron, this.shaping.aileron);
    o.elevator = applyShaping(raw.elevator, this.shaping.elevator);
    o.rudder = applyShaping(raw.rudder, this.shaping.rudder);
    o.collective = Math.max(-1, Math.min(1, raw.collective));
    // Mode/hold toggles from the keyboard apply to every source unless the transmitter has them on a switch.
    const kb = frames.keyboard;
    o.flightMode = this.active === this.gamepad && this.gamepad.mapping?.flightModeAxis !== undefined ? raw.flightMode : kb.flightMode;
    o.throttleHold = this.active === this.gamepad && this.gamepad.mapping?.throttleHoldButton !== undefined ? raw.throttleHold : kb.throttleHold;
    return o;
  }

  /** Raw (unshaped) frame from the active source, for the HUD stick display. */
  get rawFrame(): ControlFrame { return this.out; }
}
