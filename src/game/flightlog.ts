import type { FlightSummary } from './debrief';
import { landingWord } from './debrief';
import { t } from '../i18n';

/** One line in the pilot's logbook. */
export interface LogEntry {
  at: number; // epoch ms
  model: string;
  seconds: number;
  crashed: boolean;
  reason: string;
  touchdown: number;
  maxAltitude: number;
  maxSpeed: number;
  maxG: number;
  tricks: string[];
  /** Cyclic reversals per minute (the over-control index), when the flight was long enough to measure. */
  reversals?: number;
}

const KEY = 'rc-heli-sim.flightlog.v1';
const MAX = 60;

/** The logbook: the last sixty flights on this device, plus the numbers a pilot watches over weeks. */
export class FlightLog {
  entries: LogEntry[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.entries = (JSON.parse(raw) as LogEntry[]).filter((e) => e && typeof e.seconds === 'number');
    } catch {
      this.entries = [];
    }
  }

  /** Merge entries from another device (the account copy): union by timestamp, newest first, capped. */
  merge(other: unknown): number {
    if (!Array.isArray(other)) return 0;
    const have = new Set(this.entries.map((e) => e.at));
    let added = 0;
    for (const raw of other) {
      const e = raw as Partial<LogEntry>;
      if (!e || typeof e.at !== 'number' || typeof e.seconds !== 'number' || have.has(e.at)) continue;
      this.entries.push({
        at: e.at,
        model: String(e.model ?? ''),
        seconds: e.seconds,
        crashed: Boolean(e.crashed),
        reason: String(e.reason ?? ''),
        touchdown: Number(e.touchdown ?? 0),
        maxAltitude: Number(e.maxAltitude ?? 0),
        maxSpeed: Number(e.maxSpeed ?? 0),
        maxG: Number(e.maxG ?? 1),
        tricks: Array.isArray(e.tricks) ? e.tricks.map(String) : [],
        ...(typeof e.reversals === 'number' ? { reversals: e.reversals } : {}),
      });
      have.add(e.at);
      added++;
    }
    if (added) {
      this.entries.sort((a, b) => b.at - a.at);
      if (this.entries.length > MAX) this.entries.length = MAX;
      this.save();
    }
    return added;
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.entries));
    } catch {
      /* storage full or disabled: the log is a convenience */
    }
  }

  add(d: FlightSummary, model: string): LogEntry {
    const e: LogEntry = {
      at: Date.now(),
      model,
      seconds: d.seconds,
      crashed: d.crashed,
      reason: d.crashReason,
      touchdown: d.touchdown,
      maxAltitude: d.maxAltitude,
      maxSpeed: d.maxSpeed,
      maxG: d.maxG,
      tricks: [...d.tricks],
      ...(d.reversalsPerMin !== undefined && d.seconds > 10 ? { reversals: Math.round(d.reversalsPerMin) } : {}),
    };
    this.entries.unshift(e);
    if (this.entries.length > MAX) this.entries.length = MAX;
    this.save();
    return e;
  }

  /** Numbers that show progress: clean rate and landing softness over the last flights vs the ones before. */
  stats(): { flights: number; clean: number; airtime: number; avgTouchdown: number; recentClean: number; earlierClean: number; recentTouchdown: number; earlierTouchdown: number } {
    const all = this.entries;
    const flights = all.length;
    const clean = all.filter((e) => !e.crashed).length;
    const airtime = all.reduce((a, e) => a + e.seconds, 0);
    const landings = all.filter((e) => !e.crashed);
    const avg = (xs: LogEntry[]) => (xs.length ? xs.reduce((a, e) => a + e.touchdown, 0) / xs.length : 0);
    const recent = all.slice(0, 10);
    const earlier = all.slice(10, 20);
    const rate = (xs: LogEntry[]) => (xs.length ? xs.filter((e) => !e.crashed).length / xs.length : 0);
    return {
      flights,
      clean,
      airtime,
      avgTouchdown: avg(landings),
      recentClean: rate(recent),
      earlierClean: rate(earlier),
      recentTouchdown: avg(recent.filter((e) => !e.crashed)),
      earlierTouchdown: avg(earlier.filter((e) => !e.crashed)),
    };
  }
}

export function fmtAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 90) return t('just now');
  if (s < 3600) return `${Math.round(s / 60)} ${t('min ago')}`;
  if (s < 86400) return `${Math.round(s / 3600)} ${t('h ago')}`;
  return `${Math.round(s / 86400)} ${t('d ago')}`;
}

/** What an instructor would say after looking at the last twenty flights: the most common way they ended, and one tip. */
export function coachTip(log: FlightLog): { reason: string; tip: string } | null {
  const recent = log.entries.slice(0, 20);
  const crashes = recent.filter((e) => e.crashed);
  if (crashes.length < 2) return null;
  const counts = new Map<string, number>();
  for (const e of crashes) {
    const key = e.reason.split(':')[0].replace(/\s+(the|a)\s+.*$/, '').trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [reason] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const tips: [RegExp, string][] = [
    [/dynamic rollover/i, 'Dynamic rollover: once a skid is on the ground the cyclic must stay neutral or away from the ground. Lift straight up with collective, or set the other skid down; never fight the tilt with aileron.'],
    [/blade strike/i, 'Most blade strikes come from a low hover with drift: hold 1.5 m until the drift is dead, then come down straight.'],
    [/hard landing/i, 'Slow the last metre right down: a touch more collective early, and let it settle in ground effect before the final sink.'],
    [/boom strike/i, 'Keep the collective positive when you use a lot of cyclic on a flybar head; 3D belongs on a flybarless model.'],
    [/hit .*tree|hit .*fence|hit .*billboard|hit .*house|hit .*barn|hit .*wall|hit .*ceiling|hit .*bleachers/i, 'Fly the circuits higher and look at the next ring, not at the heli; obstacles are easy to lose from the pilot spot.'],
    [/rotor head hit|hard contact/i, 'Those are upside-down arrivals: more height before you try a figure, and Show me until the stick pattern is yours.'],
  ];
  const tip = tips.find(([re]) => re.test(reason))?.[1] ?? 'Fly the challenge one level below the one that bites you, until it is boring; then come back.';
  return { reason, tip };
}

/**
 * Progress chart: one bar per flight (oldest left), height = flight time, red when it crashed; a yellow line over it
 * is the over-control index (cyclic reversals per minute, lower is calmer). Inline SVG so it works everywhere.
 */
export function progressSvg(entries: LogEntry[], width = 340, height = 70): string {
  const xs = entries.slice(0, 40).reverse();
  if (xs.length < 3) return '';
  const maxSec = Math.max(30, ...xs.map((e) => e.seconds));
  const slot = width / xs.length;
  const bars = xs.map((e, i) => {
    const h = Math.max(2, (e.seconds / maxSec) * (height - 14));
    return `<rect x="${(i * slot + 1).toFixed(1)}" y="${(height - 2 - h).toFixed(1)}" width="${Math.max(1, slot - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${e.crashed ? '#d9534f' : '#5cb85c'}"/>`;
  }).join('');
  const withRev = xs.map((e, i) => [i, e.reversals] as [number, number | undefined]).filter((p): p is [number, number] => typeof p[1] === 'number');
  let line = '';
  if (withRev.length >= 2) {
    const maxRev = Math.max(60, ...withRev.map((p) => p[1]));
    const pts = withRev.map(([i, r]) => `${(i * slot + slot / 2).toFixed(1)},${(height - 2 - (r / maxRev) * (height - 14)).toFixed(1)}`).join(' ');
    line = `<polyline points="${pts}" fill="none" stroke="#ffd34d" stroke-width="1.5"/>`;
  }
  return `<svg class="progress" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="${t('Flight time per flight; red = crash; yellow line = stick reversals per minute')}">${bars}${line}</svg>`;
}

/** Trend of the over-control index: last ten flights vs the ten before, when both are known. */
export function calmTrend(entries: LogEntry[]): { recent: number; earlier: number } | null {
  const avg = (xs: LogEntry[]) => {
    const v = xs.map((e) => e.reversals).filter((r): r is number => typeof r === 'number');
    return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const recent = avg(entries.slice(0, 10));
  const earlier = avg(entries.slice(10, 20));
  return recent !== null && earlier !== null ? { recent, earlier } : null;
}

/** The logbook table and its progress line, as HTML. */
export function logbookHtml(log: FlightLog, fmtTime: (s: number) => string): string {
  const st = log.stats();
  if (!st.flights) return `<h5>${t('Logbook')}</h5><p class="hint">${t('No flights yet. Every flight longer than a few seconds is logged here with its landing grade.')}</p>`;
  const trend = st.earlierClean || st.earlierTouchdown
    ? `<p class="hint">${t('Last 10 flights:')} ${Math.round(st.recentClean * 100)}% ${t('clean (before:')} ${Math.round(st.earlierClean * 100)}%), ${t('landings')} ${st.recentTouchdown.toFixed(1)} m/s (${t('before:')} ${st.earlierTouchdown.toFixed(1)}).</p>`
    : '';
  const rows = log.entries.slice(0, 20).map((e) =>
    `<div class="log-row ${e.crashed ? 'crash' : ''}"><span>${fmtAgo(e.at)}</span><span>${t(e.model)}</span><b>${fmtTime(e.seconds)}</b><span>${e.crashed ? `✖ ${e.reason.split(':')[0]}` : `${t(landingWord(e.touchdown))} ${e.touchdown.toFixed(1)} m/s`}</span><span>${e.maxAltitude.toFixed(0)} m · ${e.maxG.toFixed(1)} g${e.tricks.length ? ` · ${e.tricks.length} ✓` : ''}</span></div>`,
  ).join('');
  const coach = coachTip(log);
  const coachLine = coach ? `<p class="coach">${t('Most of your recent crashes:')} <b>${coach.reason}</b>. ${t(coach.tip)}</p>` : '';
  const calm = calmTrend(log.entries);
  const calmLine = calm
    ? `<p class="hint">${t('Stick reversals per minute, last 10 flights:')} ${Math.round(calm.recent)} (${t('before:')} ${Math.round(calm.earlier)}). ${calm.recent < calm.earlier * 0.85 ? t('Your hands are calming down.') : calm.recent > calm.earlier * 1.15 ? t('Busier hands lately: slow down, hold each correction longer.') : ''}</p>`
    : '';
  return `<h5>${t('Logbook')}</h5>
    <p class="hint">${st.flights} ${t('flights')}, ${st.clean} ${t('clean')} (${Math.round((100 * st.clean) / st.flights)}%), ${fmtTime(st.airtime)} ${t('in the air, landings average')} ${st.avgTouchdown.toFixed(1)} m/s.</p>
    ${progressSvg(log.entries)}
    ${trend}${calmLine}${coachLine}
    <div class="logbook">${rows}</div>`;
}
