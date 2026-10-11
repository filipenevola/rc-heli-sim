import { neutralFrame, type ControlFrame, type InputSource } from './types';
import { isTypingTarget } from './typing-guard';

/**
 * Keyboard emulation of a transmitter. Keys ramp the stick instead of jumping, and the
 * spring-centred axes return to centre when released; the collective stick stays where you leave it.
 *
 * Mode 2 layout (default):  arrows = right stick (aileron / elevator), WASD = left stick (collective / rudder).
 */
export class KeyboardInput implements InputSource {
  readonly id = 'keyboard' as const;
  readonly label = 'Keyboard';
  private keys = new Set<string>();
  private frame = neutralFrame();
  private last = 0;
  private enabled = true;
  /** Stick travel per second while a key is held, and return-to-centre speed. */
  rampRate = 3.5;
  returnRate = 6;
  collectiveRate = 1.2;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (isTypingTarget(e)) return; // belt and braces; the capture guard normally stops these first
      if (e.repeat) return;
      if (this.handleToggle(e.code)) {
        e.preventDefault();
        return;
      }
      if (TRACKED.has(e.code)) {
        this.keys.add(e.code);
        this.last = performance.now();
        e.preventDefault();
      }
    });
    target.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    target.addEventListener('blur', () => this.keys.clear());
    // Focusing a text field releases any held stick keys so the heli does not keep rolling while you type.
    document.addEventListener('focusin', (e) => {
      if (isTypingTarget(e)) this.keys.clear();
    });
  }

  /** Drop all held keys (called when typing starts). */
  release(): void { this.keys.clear(); }

  available(): boolean { return true; }
  lastActivity(): number { return this.last; }
  setEnabled(enabled: boolean): void { this.enabled = enabled; if (!enabled) this.keys.clear(); }

  private handleToggle(code: string): boolean {
    switch (code) {
      case 'KeyH':
        this.frame.throttleHold = !this.frame.throttleHold;
        this.last = performance.now();
        return true;
      case 'Digit1': this.frame.flightMode = 0; this.last = performance.now(); return true;
      case 'Digit2': this.frame.flightMode = 1; this.last = performance.now(); return true;
      case 'Digit3': this.frame.flightMode = 2; this.last = performance.now(); return true;
      default: return false;
    }
  }

  poll(dt: number): ControlFrame {
    const f = this.frame;
    if (!this.enabled) return f;
    const axis = (neg: string, pos: string, value: number) => {
      const dir = (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0);
      if (dir !== 0) return clamp1(value + dir * this.rampRate * dt);
      // spring return
      const step = this.returnRate * dt;
      return Math.abs(value) <= step ? 0 : value - Math.sign(value) * step;
    };
    f.aileron = axis('ArrowLeft', 'ArrowRight', f.aileron);
    f.elevator = axis('ArrowDown', 'ArrowUp', f.elevator);
    f.rudder = axis('KeyA', 'KeyD', f.rudder);
    const colDir = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    if (colDir !== 0) f.collective = clamp1(f.collective + colDir * this.collectiveRate * dt);
    return f;
  }
}

const TRACKED = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));
