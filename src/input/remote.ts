import { neutralFrame, type ControlFrame, type InputSource } from './types';
import { hostLink, makeCode, type LinkState, type RadioLink } from '../net/radio-link';

/** Wire format of one stick frame from the phone: short keys, two decimals, ~50 Hz. */
export interface RemoteFrame { a: number; e: number; r: number; c: number; m: 0 | 1 | 2; h: 0 | 1; t?: number; /** Rescue held. */ x?: 0 | 1; /** Reset counter: each change asks for a reset. */ rs?: number }

/**
 * A phone used as the transmitter. Frames arrive over a WebRTC data channel; this source holds the latest one.
 * Failsafe like a real receiver: with no frame for 800 ms the sticks centre, the collective holds, and the source
 * reports unavailable so the input manager can fall back.
 */
export class RemoteInput implements InputSource {
  readonly id = 'remote' as const;
  get label(): string { return this.latencyMs > 0 ? `Phone radio · ${this.latencyMs} ms` : 'Phone radio'; }
  /** The code of the current pairing, kept so a dropped link can be re-offered under the same code. */
  code: string | null = null;
  private reconnectTimer = 0;
  private wantLink = false;
  /** Rankings API base; the link uses it only to swap the pairing offer/answer. */
  apiBase: string | null = null;
  link: RadioLink | null = null;
  onState: ((s: LinkState, code: string) => void) | null = null;
  /** The phone's Reset button. */
  onReset: (() => void) | null = null;
  private lastResetCount: number | undefined;
  /** Round trip measured by the phone, ms (it echoes our pings). */
  latencyMs = 0;
  failsafeMs = 800;
  private frame = neutralFrame();
  private last = 0;
  private lastFrameAt = -Infinity;
  private now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  available(): boolean { return this.now() - this.lastFrameAt < this.failsafeMs; }
  lastActivity(): number { return this.last; }
  setEnabled(_enabled: boolean): void { /* nothing to show or hide on the desktop */ }

  /** Feed one frame (from the data channel, or a test). */
  apply(msg: RemoteFrame): void {
    const f = this.frame;
    const changed = f.aileron !== msg.a || f.elevator !== msg.e || f.rudder !== msg.r || f.collective !== msg.c || f.flightMode !== msg.m || f.throttleHold !== (msg.h === 1);
    f.aileron = clamp1(msg.a);
    f.elevator = clamp1(msg.e);
    f.rudder = clamp1(msg.r);
    f.collective = clamp1(msg.c);
    f.flightMode = msg.m === 1 || msg.m === 2 ? msg.m : 0;
    f.throttleHold = msg.h === 1;
    f.rescue = msg.x === undefined ? undefined : msg.x === 1;
    if (typeof msg.rs === 'number') {
      if (this.lastResetCount !== undefined && msg.rs !== this.lastResetCount) this.onReset?.();
      this.lastResetCount = msg.rs;
    }
    this.lastFrameAt = this.now();
    if (changed) this.last = this.lastFrameAt;
  }

  poll(_dt: number): ControlFrame {
    if (!this.available()) {
      // Failsafe: cyclic and rudder to centre, collective and switches hold.
      this.frame.aileron = 0;
      this.frame.elevator = 0;
      this.frame.rudder = 0;
    }
    return this.frame;
  }

  /** Start a pairing: returns the code to type on the phone (a fresh random one unless given). */
  pair(code = makeCode()): string {
    this.link?.close();
    clearTimeout(this.reconnectTimer);
    this.code = code;
    this.wantLink = true;
    if (!this.apiBase) {
      this.onState?.('failed', code);
      return code;
    }
    const link = hostLink(this.apiBase, code);
    this.link = link;
    link.onState = (s) => {
      this.onState?.(s, code);
      // The phone dropped (screen lock, Wi-Fi hiccup): re-offer under the same code so it can come straight back.
      if (s === 'failed' && this.wantLink && this.link === link) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = window.setTimeout(() => { if (this.wantLink && this.link === link) this.pair(code); }, 1500);
      }
    };
    // The link may already have moved on (it sets 'waiting' synchronously): replay the current state.
    if (link.state !== 'idle') this.onState?.(link.state, code);
    link.onMessage = (text) => {
      try {
        const msg = JSON.parse(text) as RemoteFrame & { ping?: number; lat?: number };
        if (typeof msg.ping === 'number') { link.send(JSON.stringify({ pong: msg.ping })); return; }
        if (typeof msg.lat === 'number') { this.latencyMs = msg.lat; return; }
        this.apply(msg);
      } catch { /* ignore junk */ }
    };
    return code;
  }

  /** Push a telemetry snapshot to the phone (10 Hz is plenty for a glance strip). */
  sendTelemetry(tel: { rpm: number; alt: number; bat: number; mode: 0 | 1 | 2; hold: boolean; crash: string }): void {
    this.link?.send(JSON.stringify({ tel }));
  }

  unpair(): void {
    this.wantLink = false;
    this.lastResetCount = undefined;
    clearTimeout(this.reconnectTimer);
    this.link?.close();
    this.link = null;
    this.code = null;
    this.latencyMs = 0;
    this.lastFrameAt = -Infinity;
  }

  get state(): LinkState { return this.link?.state ?? 'idle'; }
}

const clamp1 = (x: number): number => (Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0);
