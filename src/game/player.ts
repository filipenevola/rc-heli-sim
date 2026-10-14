/**
 * Player profile, local records and the optional online rankings.
 *
 * Everything works offline: name + records live in localStorage. With an email the player can verify
 * (6-digit code sent by the server) and the same profile is reachable from any device. The server URL
 * comes from VITE_API_URL at build time; without it the online parts are hidden.
 */
import { SIM_LEVELS, type LevelBests, type SimLevel } from './sim-level';

export interface Profile {
  name: string;
  email: string | null;
  verified: boolean;
  /** Bearer token for the server once the email is verified. */
  token: string | null;
  /** Random id so unverified scores are still attributable to this browser. */
  deviceId: string;
  completed: string[];
  /** Longest clean flight on any settings (what older builds ranked). */
  bestFlight: number;
  /** Longest clean flight per pilot-level board (a flight also counts on every easier board). */
  bestFlights?: LevelBests;
  /** Pilot level each completed challenge was flown at. */
  challengeLevels?: Record<string, SimLevel>;
  /** Transmitter mappings/calibration by gamepad id; synced with the account when signed in. */
  radio?: Record<string, unknown>;
  /** Model setup (pitch curves, head speeds, gains) by model id; synced with the account. */
  setup?: Record<string, unknown>;
}

export interface RankingEntry {
  name: string;
  value: number;
  verified: boolean;
  at: string;
  /** Challenge board only: how many challenges were flown at Pro level. */
  pro?: number;
}

const KEY = 'rc-heli-sim.profile.v1';

/** A friendly default callsign so a pilot shows up in rankings from the first flight; editable any time. */
export function randomCallsign(): string {
  const a = ['Swift', 'Steady', 'Brave', 'Quiet', 'Rapid', 'Lucky', 'Sharp', 'Calm', 'Wild', 'Noble', 'Keen', 'Bold'];
  const b = ['Rotor', 'Hawk', 'Falcon', 'Kestrel', 'Dragonfly', 'Swallow', 'Osprey', 'Condor', 'Skid', 'Blade', 'Gyro', 'Hover'];
  const n = Math.floor(Math.random() * 90) + 10;
  return `${a[Math.floor(Math.random() * a.length)]}${b[Math.floor(Math.random() * b.length)]}${n}`;
}

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Profile | null;
    if (p && p.deviceId) {
      if (!p.name) p.name = randomCallsign();
      // Records from before pilot levels: the settings they were flown on are unknown, so they count as Beginner.
      if (!p.bestFlights) p.bestFlights = p.bestFlight > 0 ? { beginner: p.bestFlight } : {};
      p.challengeLevels ??= {};
      return p;
    }
  } catch {
    /* fresh */
  }
  const fresh: Profile = { name: randomCallsign(), email: null, verified: false, token: null, deviceId: crypto.randomUUID(), completed: [], bestFlight: 0, bestFlights: {}, challengeLevels: {} };
  saveProfile(fresh);
  return fresh;
}

export function saveProfile(p: Profile): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export class RankingClient {
  readonly baseUrl: string | null;
  constructor() {
    const url = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');
    this.baseUrl = url || null;
  }

  get online(): boolean {
    return this.baseUrl !== null;
  }

  private async call<T>(path: string, body?: unknown, token?: string | null): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.text()) || res.statusText);
    return (await res.json()) as T;
  }

  requestCode(email: string, name: string): Promise<{ ok: true }> {
    return this.call('/api/auth/request', { email, name });
  }

  verifyCode(email: string, code: string, deviceId: string): Promise<{ token: string; name: string; completed: string[]; bestFlight: number; bestFlights?: LevelBests | null; challengeLevels?: Record<string, SimLevel> | null; radio?: Record<string, unknown> | null; setup?: Record<string, unknown> | null; logbook?: unknown[] | null }> {
    return this.call('/api/auth/verify', { email, code, deviceId });
  }

  /** Push the current records. Unverified players are keyed by device id and shown unverified. */
  submit(p: Profile, logbook: unknown[] | null = null): Promise<{ ok: true }> {
    return this.call('/api/scores', { name: p.name, deviceId: p.deviceId, completed: p.completed, bestFlight: Math.round(p.bestFlight), bestFlights: p.bestFlights ?? {}, challengeLevels: p.challengeLevels ?? {}, radio: p.radio ?? null, setup: p.setup ?? null, logbook: p.verified ? logbook : null }, p.token);
  }

  sendRadioReport(report: unknown): Promise<{ ok: true }> {
    return this.call('/api/radio-report', report);
  }

  /** Flight boards are per pilot level; the challenge board is one. */
  rankings(kind: 'flight' | 'challenge', level?: SimLevel): Promise<RankingEntry[]> {
    return this.call(`/api/rankings?kind=${kind}${level ? `&level=${level}` : ''}`);
  }
}

/** Local rankings: every name used on this device, kept so friends can compare on one phone. */
const LOCAL_KEY = 'rc-heli-sim.local-rankings.v1';
export interface LocalRanking { bestFlight: number; bestFlights?: LevelBests; points: number; completed: string[] }
export function localRankings(): Record<string, LocalRanking> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}');
  } catch {
    return {};
  }
}
export function saveLocalRanking(name: string, bestFlight: number, points: number, completed: string[], bestFlights: LevelBests = {}): void {
  if (!name) return;
  const all = localRankings();
  const prev = all[name];
  // Entries from before pilot levels count on the Beginner board, like the profile's own legacy record.
  const prevBests: LevelBests = prev?.bestFlights ?? (prev?.bestFlight ? { beginner: prev.bestFlight } : {});
  const mergedBests: LevelBests = {};
  for (const l of SIM_LEVELS) {
    const v = Math.max(prevBests[l] ?? 0, bestFlights[l] ?? 0);
    if (v > 0) mergedBests[l] = v;
  }
  all[name] = { bestFlight: Math.max(prev?.bestFlight ?? 0, bestFlight), bestFlights: mergedBests, points: Math.max(prev?.points ?? 0, points), completed: [...new Set([...(prev?.completed ?? []), ...completed])] };
  localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m > 0 ? `${m}m ${sec.toString().padStart(2, '0')}s` : `${sec}s`;
}
