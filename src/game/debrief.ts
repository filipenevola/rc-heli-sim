import type { HelicopterSim } from '../sim/physics';
import type { ControlFrame } from '../input/types';
import { len } from '../sim/math';
import { t } from '../i18n';

/** What one flight looked like, gathered every frame from lift-off to touchdown or crash. */
export interface FlightSummary {
  seconds: number;
  crashed: boolean;
  crashReason: string;
  maxAltitude: number;
  maxSpeed: number;
  maxG: number;
  minG: number;
  /** Seconds spent in vortex ring state / blade stall. */
  vrsSeconds: number;
  stallSeconds: number;
  /** Battery used during the flight, fraction of the pack. */
  batteryUsed: number;
  /** True when the model burns fuel rather than a battery (changes the wording). */
  nitro?: boolean;
  /** Touchdown sink rate, m/s (0 when crashed). */
  touchdown: number;
  /** Challenge ids completed during the flight. */
  tricks: string[];
  /** Cyclic stick travel per second, in full throws (0.3 is a calm hover, 2+ is fighting the model). */
  stickRate?: number;
  /** Cyclic direction reversals per minute: the over-control signature. */
  reversalsPerMin?: number;
}

/** Instructor's word for the stick work: how much and how nervously the cyclic moved. */
export function stickWord(reversalsPerMin: number, stickRate: number): 'calm' | 'busy' | 'chasing' {
  if (reversalsPerMin >= 90 || stickRate >= 2) return 'chasing';
  if (reversalsPerMin >= 40 || stickRate >= 0.9) return 'busy';
  return 'calm';
}

export function landingWord(touchdown: number): string {
  if (touchdown < 0.25) return 'greaser';
  if (touchdown < 0.6) return 'soft';
  if (touchdown < 1.2) return 'firm';
  return 'hard';
}

/** Accumulates the summary while a flight is in progress; `end()` returns it. */
export class FlightStats {
  private cur: FlightSummary | null = null;
  private battery0 = 1;
  private lastAil = 0;
  private lastEle = 0;
  private dirAil = 0;
  private dirEle = 0;
  private travel = 0;
  private reversals = 0;

  get active(): boolean {
    return this.cur !== null;
  }

  begin(sim: HelicopterSim): void {
    this.battery0 = sim.telemetry.battery;
    this.cur = { seconds: 0, crashed: false, crashReason: '', maxAltitude: 0, maxSpeed: 0, maxG: 1, minG: 1, vrsSeconds: 0, stallSeconds: 0, batteryUsed: 0, touchdown: 0, tricks: [], nitro: sim.model.power === 'nitro' };
    this.travel = 0;
    this.reversals = 0;
    this.dirAil = this.dirEle = 0;
    this.lastAil = this.lastEle = 0;
  }

  trick(id: string): void {
    this.cur?.tricks.push(id);
  }

  update(sim: HelicopterSim, dt: number, ctl?: ControlFrame): void {
    const c = this.cur;
    if (!c) return;
    if (ctl) {
      // Stick work: cyclic travel and direction reversals (a reversal needs a real move, not jitter).
      const da = ctl.aileron - this.lastAil;
      const de = ctl.elevator - this.lastEle;
      this.lastAil = ctl.aileron;
      this.lastEle = ctl.elevator;
      this.travel += Math.abs(da) + Math.abs(de);
      for (const [d, key] of [[da, 'dirAil'], [de, 'dirEle']] as [number, 'dirAil' | 'dirEle'][]) {
        if (Math.abs(d) < 0.004) continue;
        const dir = Math.sign(d);
        if (this[key] !== 0 && dir !== this[key]) this.reversals++;
        this[key] = dir;
      }
      if (c.seconds > 1) {
        c.stickRate = this.travel / c.seconds;
        c.reversalsPerMin = (this.reversals / c.seconds) * 60;
      }
    }
    const s = sim.state;
    const t = sim.telemetry;
    c.seconds += dt;
    c.maxAltitude = Math.max(c.maxAltitude, s.pos.y);
    c.maxSpeed = Math.max(c.maxSpeed, len(s.vel));
    c.maxG = Math.max(c.maxG, t.gLoad);
    c.minG = Math.min(c.minG, t.gLoad);
    if (t.vrs > 0.3) c.vrsSeconds += dt;
    if (t.stall > 0.2) c.stallSeconds += dt;
    c.batteryUsed = Math.max(0, this.battery0 - t.battery);
  }

  end(sim: HelicopterSim, seconds: number, crashed: boolean): FlightSummary | null {
    const c = this.cur;
    if (!c) return null;
    this.cur = null;
    c.seconds = seconds;
    c.crashed = crashed;
    c.crashReason = crashed ? sim.state.crashReason : '';
    c.touchdown = crashed ? 0 : sim.state.touchdownSpeed;
    return c;
  }
}

const f1 = (v: number) => v.toFixed(1);

/** The debrief card: an instructor's two lines after you land. */
export function debriefHtml(d: FlightSummary, fmtTime: (s: number) => string, trickTitle: (id: string) => string): string {
  const head = d.crashed ? t('Flight ended in a crash: {time}', { time: fmtTime(d.seconds) }) : t('Clean flight: {time}', { time: fmtTime(d.seconds) });
  const rows: string[] = [];
  if (!d.crashed) rows.push(`${t('Landing:')} <b>${t(landingWord(d.touchdown))}</b> (${f1(d.touchdown)} m/s)`);
  else rows.push(d.crashReason);
  rows.push(`Max ${f1(d.maxAltitude)} m · ${f1(d.maxSpeed * 3.6)} km/h · ${f1(d.maxG)} g${d.minG < 0.3 ? ` / ${f1(d.minG)} g` : ''}`);
  const warnings: string[] = [];
  if (d.vrsSeconds > 0.5) warnings.push(`${f1(d.vrsSeconds)} s ${t('in vortex ring state')}`);
  if (d.stallSeconds > 0.5) warnings.push(`${f1(d.stallSeconds)} s ${t('of blade stall')}`);
  if (warnings.length) rows.push(warnings.join(' · '));
  if (d.batteryUsed > 0.005) rows.push(`${d.nitro ? t('Fuel used:') : t('Battery used:')} ${Math.round(d.batteryUsed * 100)}%`);
  if (d.tricks.length) rows.push(`${t('Done:')} ${d.tricks.map(trickTitle).join(', ')}`);
  if (d.reversalsPerMin !== undefined && d.stickRate !== undefined && d.seconds > 10) {
    const w = stickWord(d.reversalsPerMin, d.stickRate);
    rows.push(`${t('Sticks:')} <b>${t(w)}</b> (${Math.round(d.reversalsPerMin)} ${t('reversals/min')})${w === 'chasing' ? ` · ${t('Smaller, earlier inputs and let it settle; you are chasing the heli.')}` : w === 'busy' ? ` · ${t('Try holding each correction a little longer before the next.')}` : ''}`);
  }
  return `<b>${head}</b><br>${rows.join('<br>')}`;
}
