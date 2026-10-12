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
    };
    this.entries.unshift(e);
    if (this.entries.length > MAX) this.entries.length = MAX;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.entries));
    } catch {
      /* storage full or disabled: the log is a convenience */
    }
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
    [/blade strike/i, 'Most blade strikes come from a low hover with drift: hold 1.5 m until the drift is dead, then come down straight.'],
    [/hard landing/i, 'Slow the last metre right down: a touch more collective early, and let it settle in ground effect before the final sink.'],
    [/boom strike/i, 'Keep the collective positive when you use a lot of cyclic on a flybar head; 3D belongs on a flybarless model.'],
    [/hit .*tree|hit .*fence|hit .*billboard|hit .*house|hit .*barn|hit .*wall|hit .*ceiling|hit .*bleachers/i, 'Fly the circuits higher and look at the next ring, not at the heli; obstacles are easy to lose from the pilot spot.'],
    [/rotor head hit|hard contact/i, 'Those are upside-down arrivals: more height before you try a figure, and Show me until the stick pattern is yours.'],
  ];
  const tip = tips.find(([re]) => re.test(reason))?.[1] ?? 'Fly the challenge one level below the one that bites you, until it is boring; then come back.';
  return { reason, tip };
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
  return `<h5>${t('Logbook')}</h5>
    <p class="hint">${st.flights} ${t('flights')}, ${st.clean} ${t('clean')} (${Math.round((100 * st.clean) / st.flights)}%), ${fmtTime(st.airtime)} ${t('in the air, landings average')} ${st.avgTouchdown.toFixed(1)} m/s.</p>
    ${trend}${coachLine}
    <div class="logbook">${rows}</div>`;
}
