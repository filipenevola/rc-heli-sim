/**
 * The single abstraction every input device maps into.
 * Values follow RC transmitter conventions:
 *  - aileron / elevator / rudder: -1..1, spring-centred sticks
 *  - collective (throttle stick): -1..1, bottom = -1, top = +1 (not spring-centred)
 *  - flightMode: 0 = Normal, 1 = Idle-Up 1, 2 = Idle-Up 2
 *  - throttleHold: motor off (autorotation practice / safety)
 */
export interface ControlFrame {
  aileron: number;
  elevator: number;
  rudder: number;
  collective: number;
  flightMode: 0 | 1 | 2;
  throttleHold: boolean;
  /** Rescue switch held (transmitter switch mapped to the buddy-box rescue); absent when the source has none. */
  rescue?: boolean;
}

export const neutralFrame = (): ControlFrame => ({
  aileron: 0,
  elevator: 0,
  rudder: 0,
  collective: -1,
  flightMode: 0,
  throttleHold: false,
});

export interface InputSource {
  readonly id: 'keyboard' | 'gamepad' | 'touch' | 'motion' | 'remote';
  readonly label: string;
  /** True when the device is physically available (gamepad connected, touch screen present...). */
  available(): boolean;
  /** Called once per render frame. Returns the current frame. */
  poll(dt: number): ControlFrame;
  /** Timestamp (performance.now) of the last meaningful user action, for auto-switching sources. */
  lastActivity(): number;
  setEnabled(enabled: boolean): void;
}

/** Stick mode: which physical stick carries which function. Mode 2 is the most common worldwide. */
export type StickMode = 1 | 2 | 3 | 4;

/** Transmitter-style shaping applied after the raw device read. */
export interface StickShaping {
  /** 0..1, classic RC "expo" softening around centre. */
  expo: number;
  /** Dual rate 0.2..1 scaling of max travel. */
  rate: number;
  deadband: number;
}

export function applyShaping(x: number, s: StickShaping): number {
  let v = x;
  if (Math.abs(v) < s.deadband) v = 0;
  else v = (Math.abs(v) - s.deadband) / (1 - s.deadband) * Math.sign(v);
  // Standard exponential: y = e*x^3 + (1-e)*x
  v = s.expo * v * v * v + (1 - s.expo) * v;
  return v * s.rate;
}
