import { neutralFrame, type ControlFrame, type InputSource } from './types';

/**
 * Real transmitter via a USB simulator dongle / cable (Spektrum WS2000, FrSky, "22-in-1" cables, OrangeRx...).
 * Those dongles enumerate as a standard HID joystick, which the browser exposes through the Gamepad API,
 * so no driver or native code is needed. Each dongle orders its axes differently, hence the mapping wizard.
 */
export interface AxisMapping {
  index: number;
  invert: boolean;
  /** Calibrated raw range, so dongles that only output -0.8..0.8 (common) still give full travel. */
  min: number;
  max: number;
}

export interface GamepadMapping {
  gamepadId: string;
  aileron: AxisMapping;
  elevator: AxisMapping;
  rudder: AxisMapping;
  collective: AxisMapping;
  /** Optional switches (buttons or axes used as switches). */
  throttleHoldButton?: number;
  flightModeAxis?: number;
  /** Newer, more general form: a switch can be a button or an axis (2- or 3-position). */
  flightModeSwitch?: SwitchMapping;
  throttleHoldSwitch?: SwitchMapping;
}

export interface SwitchMapping {
  kind: 'axis' | 'button';
  index: number;
  /** For axes: raw value when the switch is in its "off"/Normal position, to know which way it goes. */
  rest: number;
}

const STORAGE_KEY = 'rc-heli-sim.gamepad-mappings.v1';

export const defaultAxis = (index: number, invert = false): AxisMapping => ({ index, invert, min: -1, max: 1 });

/** Mode 2 guess for the usual 4-axis dongles: axes 0/1 = right stick, 2/3 = left stick. */
export function guessMapping(id: string): GamepadMapping {
  return {
    gamepadId: id,
    aileron: defaultAxis(0),
    elevator: defaultAxis(1, true),
    rudder: defaultAxis(3),
    collective: defaultAxis(2, true),
  };
}

export function loadMappings(): Record<string, GamepadMapping> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveMapping(m: GamepadMapping): void {
  const all = loadMappings();
  all[m.gamepadId] = m;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export class GamepadInput implements InputSource {
  readonly id = 'gamepad' as const;
  readonly label = 'Transmitter (USB)';
  private frame = neutralFrame();
  private last = 0;
  private enabled = true;
  private prevAxes: number[] = [];
  mapping: GamepadMapping | null = null;
  /** Raw axes of the active pad, for the calibration UI. */
  rawAxes: number[] = [];
  rawButtons: boolean[] = [];
  padId = '';
  /** Pilot-selected flight mode when no switch is mapped; UI/keyboard can set it. */
  flightMode: 0 | 1 | 2 = 0;
  throttleHold = false;

  available(): boolean { return this.activePad() !== null; }
  lastActivity(): number { return this.last; }
  setEnabled(enabled: boolean): void { this.enabled = enabled; }

  activePad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const p of navigator.getGamepads()) if (p && p.connected && p.axes.length >= 2) return p;
    return null;
  }

  poll(_dt: number): ControlFrame {
    const pad = this.activePad();
    const f = this.frame;
    if (!pad) return f;
    this.padId = pad.id;
    if (!this.mapping || this.mapping.gamepadId !== pad.id) {
      this.mapping = loadMappings()[pad.id] ?? guessMapping(pad.id);
    }
    this.rawAxes = Array.from(pad.axes);
    this.rawButtons = pad.buttons.map((b) => b.pressed);
    for (let i = 0; i < this.rawAxes.length; i++) {
      if (Math.abs(this.rawAxes[i] - (this.prevAxes[i] ?? 0)) > 0.02) this.last = performance.now();
    }
    this.prevAxes = this.rawAxes;
    if (!this.enabled) return f;
    const m = this.mapping;
    f.aileron = readAxis(this.rawAxes, m.aileron);
    f.elevator = readAxis(this.rawAxes, m.elevator);
    f.rudder = readAxis(this.rawAxes, m.rudder);
    f.collective = readAxis(this.rawAxes, m.collective);
    const hold = readSwitch(this.rawAxes, this.rawButtons, m.throttleHoldSwitch ?? (m.throttleHoldButton !== undefined ? { kind: 'button', index: m.throttleHoldButton, rest: 0 } : undefined));
    f.throttleHold = hold === null ? this.throttleHold : hold > 0;
    const fm = readSwitch(this.rawAxes, this.rawButtons, m.flightModeSwitch ?? (m.flightModeAxis !== undefined ? { kind: 'axis', index: m.flightModeAxis, rest: -1 } : undefined));
    f.flightMode = fm === null ? this.flightMode : fm;
    return f;
  }
}

/** Returns 0/1/2 for a switch position, or null when the switch is not mapped / not present. */
function readSwitch(axes: number[], buttons: boolean[], sw: SwitchMapping | undefined): 0 | 1 | 2 | null {
  if (!sw) return null;
  if (sw.kind === 'button') {
    const b = buttons[sw.index];
    return b === undefined ? null : b ? 1 : 0;
  }
  const v = axes[sw.index];
  if (v === undefined) return null;
  // Distance from the rest position: 2-position switches jump the full range, 3-position ones stop half way.
  const d = Math.abs(v - sw.rest);
  return d < 0.5 ? 0 : d < 1.5 ? 1 : 2;
}

/** True once a switch is mapped so the transmitter, not the keyboard/buttons, owns that function. */
export function hasSwitch(m: GamepadMapping | null, which: 'flightMode' | 'throttleHold'): boolean {
  if (!m) return false;
  return which === 'flightMode' ? m.flightModeSwitch !== undefined || m.flightModeAxis !== undefined : m.throttleHoldSwitch !== undefined || m.throttleHoldButton !== undefined;
}

function readAxis(axes: number[], m: AxisMapping): number {
  const raw = axes[m.index];
  if (raw === undefined) return 0;
  const span = m.max - m.min || 2;
  let v = ((raw - m.min) / span) * 2 - 1;
  v = Math.max(-1, Math.min(1, v));
  return m.invert ? -v : v;
}
