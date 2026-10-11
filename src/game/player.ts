/**
 * Player profile, local records and the optional online rankings.
 *
 * Everything works offline: name + records live in localStorage. With an email the player can verify
 * (6-digit code sent by the server) and the same profile is reachable from any device. The server URL
 * comes from VITE_API_URL at build time; without it the online parts are hidden.
 */
export interface Profile {
  name: string;
  email: string | null;
  verified: boolean;
  /** Bearer token for the server once the email is verified. */
  token: string | null;
  /** Random id so unverified scores are still attributable to this browser. */
  deviceId: string;
  completed: string[];
  bestFlight: number;
}

export interface RankingEntry {
  name: string;
  value: number;
  verified: boolean;
  at: string;
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
      return p;
    }
  } catch {
    /* fresh */
  }
  const fresh: Profile = { name: randomCallsign(), email: null, verified: false, token: null, deviceId: crypto.randomUUID(), completed: [], bestFlight: 0 };
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

  verifyCode(email: string, code: string, deviceId: string): Promise<{ token: string; name: string; completed: string[]; bestFlight: number }> {
    return this.call('/api/auth/verify', { email, code, deviceId });
  }

  /** Push the current records. Unverified players are keyed by device id and shown unverified. */
  submit(p: Profile): Promise<{ ok: true }> {
    return this.call('/api/scores', { name: p.name, deviceId: p.deviceId, completed: p.completed, bestFlight: Math.round(p.bestFlight) }, p.token);
  }

  sendRadioReport(report: unknown): Promise<{ ok: true }> {
    return this.call('/api/radio-report', report);
  }

  rankings(kind: 'flight' | 'challenge'): Promise<RankingEntry[]> {
    return this.call(`/api/rankings?kind=${kind}`);
  }
}

/** Local rankings: every name used on this device, kept so friends can compare on one phone. */
const LOCAL_KEY = 'rc-heli-sim.local-rankings.v1';
export function localRankings(): Record<string, { bestFlight: number; points: number; completed: string[] }> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}');
  } catch {
    return {};
  }
}
export function saveLocalRanking(name: string, bestFlight: number, points: number, completed: string[]): void {
  if (!name) return;
  const all = localRankings();
  const prev = all[name];
  all[name] = { bestFlight: Math.max(prev?.bestFlight ?? 0, bestFlight), points: Math.max(prev?.points ?? 0, points), completed: [...new Set([...(prev?.completed ?? []), ...completed])] };
  localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m > 0 ? `${m}m ${sec.toString().padStart(2, '0')}s` : `${sec}s`;
}
