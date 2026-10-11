import { neutralFrame, type ControlFrame, type InputSource } from './types';
import type { TouchInput } from './touch';

/**
 * Phone-tilt cyclic. The phone's orientation sensor (DeviceOrientation) gives the gravity vector in the
 * device frame; tilting the phone forward / sideways becomes elevator / aileron relative to a neutral pose
 * captured when the mode is enabled (or on "Recentre"). Throttle and rudder stay on the left touch gimbal.
 *
 * Pairs naturally with the 'attitude' assist (phone tilt = helicopter tilt). Needs HTTPS and, on iOS, a
 * permission prompt that must come from a tap.
 */
export class MotionInput implements InputSource {
  readonly id = 'motion' as const;
  readonly label = 'Phone tilt + touch throttle';
  /** Tilt (degrees) that gives full stick. */
  maxTiltDeg = 25;
  private frame = neutralFrame();
  private last = 0;
  private enabled = false;
  private listening = false;
  private up = { x: 0, y: 1, z: 0 };
  private neutral: { pitch: number; roll: number } | null = null;
  private supported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  permissionState: 'unknown' | 'granted' | 'denied' = 'unknown';

  constructor(private touch: TouchInput) {}

  available(): boolean { return this.supported && navigator.maxTouchPoints > 0; }
  lastActivity(): number { return this.last; }

  /** Must be called from a user gesture on iOS. Resolves true when orientation events will flow. */
  async enable(): Promise<boolean> {
    if (!this.supported) return false;
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
    if (typeof DOE.requestPermission === 'function') {
      try {
        const r = await DOE.requestPermission();
        this.permissionState = r === 'granted' ? 'granted' : 'denied';
      } catch {
        this.permissionState = 'denied';
      }
      if (this.permissionState !== 'granted') return false;
    } else this.permissionState = 'granted';
    if (!this.listening) {
      window.addEventListener('deviceorientation', (e) => this.onOrientation(e), true);
      this.listening = true;
    }
    this.neutral = null; // recentre on the next reading
    return true;
  }

  recentre(): void { this.neutral = null; }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.touch.setCyclicGimbalVisible(!enabled);
    if (enabled) this.neutral = null;
  }

  private onOrientation(e: DeviceOrientationEvent): void {
    if (e.beta === null || e.gamma === null) return;
    const b = (e.beta * Math.PI) / 180;
    const g = (e.gamma * Math.PI) / 180;
    // "Up" (minus gravity) in the device frame for the W3C Z-X'-Y'' convention.
    const ux = -Math.cos(b) * Math.sin(g);
    const uy = Math.sin(b);
    const uz = Math.cos(b) * Math.cos(g);
    // Rotate into the screen frame so landscape works the same as portrait.
    const angle = ((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) * Math.PI) / 180;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    this.up = { x: ux * ca + uy * sa, y: -ux * sa + uy * ca, z: uz };
    this.last = performance.now();
  }

  poll(_dt: number): ControlFrame {
    const f = this.frame;
    if (!this.enabled) return f;
    const u = this.up;
    // Forward tilt: top of the screen moving away from you. Roll: right edge of the screen going down.
    const pitch = Math.atan2(u.z, u.y);
    const roll = -Math.asin(Math.max(-1, Math.min(1, u.x)));
    if (!this.neutral) this.neutral = { pitch, roll };
    const maxTilt = (this.maxTiltDeg * Math.PI) / 180;
    const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));
    f.elevator = clamp1((pitch - this.neutral.pitch) / maxTilt);
    f.aileron = clamp1((roll - this.neutral.roll) / maxTilt);
    // Throttle / rudder come from the touch gimbal that is not the cyclic one.
    const t = this.touch.poll(0);
    f.collective = t.collective;
    f.rudder = t.rudder;
    f.flightMode = t.flightMode;
    f.throttleHold = t.throttleHold;
    return f;
  }
}
