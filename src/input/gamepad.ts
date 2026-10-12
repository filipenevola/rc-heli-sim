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
  /** Raw value at stick centre (sub-trim). When set, min..center..max maps to -1..0..1 piecewise. */
  center?: number;
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
  /** Rescue (buddy box) on a switch, like the rescue function of an FBL unit. */
  rescueSwitch?: SwitchMapping;
}

export interface SwitchMapping {
  kind: 'axis' | 'button';
  index: number;
  /** For axes: raw value when the switch is in its "off"/Normal position, to know which way it goes. */
  rest: number;
}

const STORAGE_KEY = 'rc-heli-sim.gamepad-mappings.v1';

export const defaultAxis = (index: number, invert = false): AxisMapping => ({ index, invert, min: -1, max: 1 });

/**
 * Built-in mappings for known simulator dongles, matched by a substring of the browser's gamepad id.
 * Values come from recorded radio reports (Settings → Send radio report).
 */
const BUILTIN: { match: string; name: string; make: (id: string) => GamepadMapping }[] = [
  {
    // E-Sky 0905A "Simulator FMS" USB transmitter (the one that shipped with FMS). Mode 2.
    match: 'Vendor: 0402 Product: 0402',
    name: 'E-Sky 0905A (FMS)',
    make: (id) => ({
      gamepadId: id,
      aileron: { index: 0, invert: false, min: -0.76, max: 0.76, center: 0 },
      elevator: { index: 1, invert: false, min: -0.65, max: 0.68, center: 0 },
      collective: { index: 2, invert: false, min: -0.55, max: 0.77 },
      rudder: { index: 4, invert: false, min: -0.74, max: 0.77, center: 0 },
    }),
  },
];

export function builtinName(id: string): string | null {
  return BUILTIN.find((b) => id.includes(b.match))?.name ?? null;
}

/** Built-in mapping if the dongle is known, else a mode-2 guess: axes 0/1 = right stick, 2/3 = left stick. */
export function guessMapping(id: string): GamepadMapping {
  const known = BUILTIN.find((b) => id.includes(b.match));
  if (known) return known.make(id);
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

/** Replace the local mappings with a set from the player's account (merge, account wins). */
export function importMappings(remote: Record<string, GamepadMapping> | null | undefined): void {
  if (!remote) return;
  const all = { ...loadMappings(), ...remote };
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
  /** Set when auto-calibration widened a range; the host saves (locally and to the account) when it sees this. */
  mappingDirty = false;
  private lastAutoSave = 0;

  available(): boolean { return this.activePad() !== null; }
  /** Browsers only list gamepads after some input; log the events so the diagnostics show something even before that. */
  readonly events: string[] = [];
  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', (e) => this.events.push(`connected: ${(e as GamepadEvent).gamepad.id} (${(e as GamepadEvent).gamepad.axes.length} axes, ${(e as GamepadEvent).gamepad.buttons.length} buttons)`));
      window.addEventListener('gamepaddisconnected', (e) => this.events.push(`disconnected: ${(e as GamepadEvent).gamepad.id}`));
    }
  }
  lastActivity(): number { return this.last; }
  setEnabled(enabled: boolean): void { this.enabled = enabled; }

  activePad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    // Some dongles report connected=false after a focus change or expose odd axis counts; take the best non-null pad.
    const pads = Array.from(navigator.getGamepads()).filter((p): p is Gamepad => !!p);
    pads.sort((a, b) => b.axes.length - a.axes.length);
    return pads[0] ?? null;
  }

  /** Raw view of every pad slot, for the diagnostics panel and the radio report. */
  dump(): { index: number; id: string; connected: boolean; axes: number; buttons: number; mapping: string; axesNow: number[] }[] {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    return Array.from(navigator.getGamepads())
      .filter((p): p is Gamepad => !!p)
      .map((p) => ({ index: p.index, id: p.id, connected: p.connected, axes: p.axes.length, buttons: p.buttons.length, mapping: p.mapping, axesNow: Array.from(p.axes).map((a) => Math.round(a * 100) / 100) }));
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
    // Auto-calibration: a stick pushed beyond the recorded travel widens it, so full deflection is always reachable.
    for (const a of [m.aileron, m.elevator, m.rudder, m.collective]) {
      const raw = this.rawAxes[a.index];
      if (raw === undefined) continue;
      if (raw < a.min - 0.02) { a.min = raw; this.mappingDirty = true; }
      if (raw > a.max + 0.02) { a.max = raw; this.mappingDirty = true; }
    }
    if (this.mappingDirty && performance.now() - this.lastAutoSave > 3000) {
      saveMapping(m);
      this.lastAutoSave = performance.now();
    }
    f.aileron = readAxis(this.rawAxes, m.aileron);
    f.elevator = readAxis(this.rawAxes, m.elevator);
    f.rudder = readAxis(this.rawAxes, m.rudder);
    f.collective = readAxis(this.rawAxes, m.collective);
    const hold = readSwitch(this.rawAxes, this.rawButtons, m.throttleHoldSwitch ?? (m.throttleHoldButton !== undefined ? { kind: 'button', index: m.throttleHoldButton, rest: 0 } : undefined));
    f.throttleHold = hold === null ? this.throttleHold : hold > 0;
    const fm = readSwitch(this.rawAxes, this.rawButtons, m.flightModeSwitch ?? (m.flightModeAxis !== undefined ? { kind: 'axis', index: m.flightModeAxis, rest: -1 } : undefined));
    f.flightMode = fm === null ? this.flightMode : fm;
    const rescue = readSwitch(this.rawAxes, this.rawButtons, m.rescueSwitch);
    f.rescue = rescue === null ? undefined : rescue > 0;
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
export function hasSwitch(m: GamepadMapping | null, which: 'flightMode' | 'throttleHold' | 'rescue'): boolean {
  if (!m) return false;
  if (which === 'rescue') return m.rescueSwitch !== undefined;
  return which === 'flightMode' ? m.flightModeSwitch !== undefined || m.flightModeAxis !== undefined : m.throttleHoldSwitch !== undefined || m.throttleHoldButton !== undefined;
}

export function readAxis(axes: number[], m: AxisMapping): number {
  const raw = axes[m.index];
  if (raw === undefined) return 0;
  let v: number;
  if (m.center !== undefined) {
    // Piecewise around the centre so a sub-trimmed stick still reaches exactly -1, 0, +1.
    v = raw >= m.center ? (raw - m.center) / Math.max(1e-3, m.max - m.center) : (raw - m.center) / Math.max(1e-3, m.center - m.min);
  } else {
    const span = m.max - m.min || 2;
    v = ((raw - m.min) / span) * 2 - 1;
  }
  v = Math.max(-1, Math.min(1, v));
  return m.invert ? -v : v;
}
