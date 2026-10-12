import type { ControlFrame } from '../input/types';

/** One recorded render frame: pose, flapping, head speed and the sticks. */
export interface ReplayFrame {
  pos: { x: number; y: number; z: number };
  ori: { x: number; y: number; z: number; w: number };
  a1: number;
  b1: number;
  rotorOmega: number;
  ctl: ControlFrame;
}

export interface ReplayFile {
  format: 'rc-heli-sim-flight';
  version: 1;
  app: string;
  model: string;
  recordedAt: string;
  hz: number;
  frames: ReplayFrame[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Serialise a flight (60 Hz frames) compactly: numbers rounded to a millimetre / milliradian. */
export function serializeFlight(frames: ReplayFrame[], model: string, app: string, now = new Date()): string {
  const file: ReplayFile = {
    format: 'rc-heli-sim-flight',
    version: 1,
    app,
    model,
    recordedAt: now.toISOString(),
    hz: 60,
    frames: frames.map((f) => ({
      pos: { x: r3(f.pos.x), y: r3(f.pos.y), z: r3(f.pos.z) },
      ori: { x: r3(f.ori.x), y: r3(f.ori.y), z: r3(f.ori.z), w: r3(f.ori.w) },
      a1: r3(f.a1),
      b1: r3(f.b1),
      rotorOmega: Math.round(f.rotorOmega * 10) / 10,
      ctl: { aileron: r3(f.ctl.aileron), elevator: r3(f.ctl.elevator), rudder: r3(f.ctl.rudder), collective: r3(f.ctl.collective), flightMode: f.ctl.flightMode, throttleHold: f.ctl.throttleHold },
    })),
  };
  return JSON.stringify(file);
}

/** Parse and validate a saved flight; throws on anything that is not one. */
export function parseFlight(text: string): ReplayFile {
  const data = JSON.parse(text) as Partial<ReplayFile>;
  if (data.format !== 'rc-heli-sim-flight' || !Array.isArray(data.frames)) throw new Error('Not a saved RC Heli Sim flight.');
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const frames: ReplayFrame[] = data.frames.map((f) => {
    const q = f as Partial<ReplayFrame>;
    const c = (q.ctl ?? {}) as Partial<ControlFrame>;
    return {
      pos: { x: num(q.pos?.x), y: num(q.pos?.y), z: num(q.pos?.z) },
      ori: { x: num(q.ori?.x), y: num(q.ori?.y), z: num(q.ori?.z), w: num(q.ori?.w, 1) },
      a1: num(q.a1),
      b1: num(q.b1),
      rotorOmega: num(q.rotorOmega),
      ctl: { aileron: num(c.aileron), elevator: num(c.elevator), rudder: num(c.rudder), collective: num(c.collective, -1), flightMode: ([0, 1, 2].includes(Number(c.flightMode)) ? Number(c.flightMode) : 0) as 0 | 1 | 2, throttleHold: Boolean(c.throttleHold) },
    };
  });
  if (frames.length < 10) throw new Error('That flight is too short to replay.');
  return { format: 'rc-heli-sim-flight', version: 1, app: String(data.app ?? ''), model: String(data.model ?? ''), recordedAt: String(data.recordedAt ?? ''), hz: 60, frames };
}
