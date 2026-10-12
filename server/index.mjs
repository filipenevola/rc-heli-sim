// RC Heli Sim rankings server. Zero dependencies: Node 22+ with node:sqlite.
//
// Env:
//   PORT            (default 8787)
//   DB_PATH         (default ./data/rankings.sqlite)
//   RESEND_API_KEY  required to send verification codes
//   MAIL_FROM       e.g. "RC Heli Sim <noreply@yourdomain.com>" (a domain verified in Resend)
//   CORS_ORIGIN     e.g. https://filipenevola.github.io (default *)
//
// Endpoints:
//   POST /api/auth/request {email, name}      -> emails a 6-digit code
//   POST /api/auth/verify  {email, code}      -> {token, name, completed, bestFlight}
//   POST /api/scores       {name, deviceId, completed[], bestFlight}  (Bearer token optional)
//   GET  /api/rankings?kind=flight|challenge  -> [{name, value, verified, at}]
//   GET  /api/health

import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.DB_PATH ?? './data/rankings.sqlite';
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const MAIL_FROM = process.env.MAIL_FROM ?? 'RC Heli Sim <onboarding@resend.dev>';
// Comma-separated list of allowed origins; the matching one is echoed back.
const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? '*').split(',').map((o) => o.trim()).filter(Boolean);

// Challenge points must match src/game/challenges.ts; the server owns the totals so clients cannot invent them.
const POINTS = {
  'first-hover': 10, 'hover-box': 20, 'nose-in': 40, 'land-table': 25, 'land-truck': 30, 'land-pontoon': 35, 'land-tower': 60,
  circuit: 50, roll: 70, autorotation: 80, 'endurance-5': 40, 'endurance-15': 100,
  'side-in-left': 20, 'side-in-right': 20, elevator: 25, 'spot-landing': 20, pirouette: 30, 'figure-eight': 50,
  loop: 70, 'inverted-hover': 90, 'nose-in-circuit': 80,
  'landing-streak': 30, 'stall-turn': 60, funnel: 80, 'tic-toc': 90, 'piro-flip': 120, 'crosswind-landing': 40,
};
const MAX_FLIGHT_SECONDS = 6 * 3600;

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,          -- 'email:<email>' or 'device:<uuid>'
    name TEXT NOT NULL DEFAULT '',
    verified INTEGER NOT NULL DEFAULT 0,
    completed TEXT NOT NULL DEFAULT '[]',
    best_flight INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS codes (email TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, player_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS radio_reports (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')), report TEXT NOT NULL);
`);
try { db.exec('ALTER TABLE players ADD COLUMN radio TEXT'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE players ADD COLUMN setup TEXT'); } catch { /* column exists */ }
try { db.exec('ALTER TABLE players ADD COLUMN logbook TEXT'); } catch { /* column exists */ }

const q = {
  playerByKey: db.prepare('SELECT * FROM players WHERE key = ?'),
  upsertPlayer: db.prepare(`INSERT INTO players (key, name, verified, completed, best_flight, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET name = excluded.name, verified = MAX(players.verified, excluded.verified), completed = excluded.completed, best_flight = MAX(players.best_flight, excluded.best_flight), updated_at = datetime('now')`),
  setRadio: db.prepare('UPDATE players SET radio = ? WHERE key = ?'),
  setSetup: db.prepare('UPDATE players SET setup = ? WHERE key = ?'),
  setLogbook: db.prepare('UPDATE players SET logbook = ? WHERE key = ?'),
  setCode: db.prepare('INSERT OR REPLACE INTO codes (email, code, name, expires_at, attempts) VALUES (?, ?, ?, ?, 0)'),
  getCode: db.prepare('SELECT * FROM codes WHERE email = ?'),
  bumpAttempts: db.prepare('UPDATE codes SET attempts = attempts + 1 WHERE email = ?'),
  delCode: db.prepare('DELETE FROM codes WHERE email = ?'),
  addToken: db.prepare('INSERT INTO tokens (hash, player_id) VALUES (?, ?)'),
  playerByToken: db.prepare('SELECT p.* FROM tokens t JOIN players p ON p.id = t.player_id WHERE t.hash = ?'),
  deletePlayer: db.prepare('DELETE FROM players WHERE key = ?'),
  addReport: db.prepare('INSERT INTO radio_reports (report) VALUES (?)'),
  lastReports: db.prepare('SELECT id, created_at, report FROM radio_reports ORDER BY id DESC LIMIT 20'),
  topFlight: db.prepare(`SELECT name, best_flight AS value, verified, updated_at AS at FROM players WHERE best_flight > 0 AND name <> '' ORDER BY best_flight DESC, updated_at ASC LIMIT 100`),
  all: db.prepare(`SELECT name, completed, verified, updated_at AS at FROM players WHERE name <> ''`),
};

const hash = (t) => createHash('sha256').update(t).digest('hex');
const points = (completed) => completed.reduce((a, id) => a + (POINTS[id] ?? 0), 0);
const cleanName = (n) => String(n ?? '').trim().slice(0, 24).replace(/[<>]/g, '');
const cleanEmail = (e) => String(e ?? '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 200;
const cleanCompleted = (c) => (Array.isArray(c) ? [...new Set(c.filter((id) => typeof id === 'string' && id in POINTS))] : []);
const validDeviceId = (d) => /^[0-9a-f-]{36}$/.test(String(d ?? ''));

/** Fold a device's anonymous row into an email account (progress union, best flight max) and drop the device row. */
function absorbDevice(emailKey, deviceId) {
  if (!validDeviceId(deviceId)) return;
  const dev = q.playerByKey.get(`device:${deviceId}`);
  if (!dev) return;
  const acct = q.playerByKey.get(emailKey);
  if (acct) {
    const merged = [...new Set([...JSON.parse(acct.completed), ...JSON.parse(dev.completed)])];
    q.upsertPlayer.run(emailKey, acct.name, 1, JSON.stringify(merged), Math.max(acct.best_flight, dev.best_flight));
  }
  q.deletePlayer.run(dev.key);
}

// Simple per-IP rate limit for the email endpoint.
const buckets = new Map();
function limited(ip, max = 5, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const b = buckets.get(ip) ?? [];
  const recent = b.filter((t) => now - t < windowMs);
  if (recent.length >= max) return true;
  recent.push(now);
  buckets.set(ip, recent);
  return false;
}

async function sendCode(email, name, code) {
  if (!RESEND_API_KEY) {
    console.log(`[dev] verification code for ${email}: ${code}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [email],
      subject: `${code} is your RC Heli Sim code`,
      text: `Hi ${name || 'pilot'},\n\nYour verification code is ${code}. It expires in 15 minutes.\n\nEnter it in the sim to keep your rankings on every device.\n\nRC Heli Sim`,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

let currentOrigin = '';
function corsOrigin(req) {
  const o = req.headers.origin ?? '';
  if (CORS_ORIGINS.includes('*')) return '*';
  return CORS_ORIGINS.includes(o) ? o : CORS_ORIGINS[0];
}
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': currentOrigin, vary: 'Origin', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, OPTIONS' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 64 * 1024) throw new Error('payload too large');
  }
  return data ? JSON.parse(data) : {};
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    currentOrigin = corsOrigin(req);
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '?';
    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (url.pathname === '/api/health') return json(res, 200, { ok: true });

    if (req.method === 'POST' && url.pathname === '/api/auth/request') {
      if (limited(ip)) return json(res, 429, { error: 'Too many requests, try again later.' });
      const body = await readJson(req);
      const email = cleanEmail(body.email);
      const name = cleanName(body.name);
      if (!validEmail(email)) return json(res, 400, { error: 'Invalid email.' });
      if (!name) return json(res, 400, { error: 'Pick a pilot name first.' });
      const code = randomInt(0, 1000000).toString().padStart(6, '0');
      q.setCode.run(email, hash(code), name, Date.now() + 15 * 60 * 1000);
      try {
        await sendCode(email, name, code);
      } catch (e) {
        console.error(e);
        return json(res, 502, { error: 'The email service rejected the request. Try again later or fly without an email; your records still count on this device.' });
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/verify') {
      const body = await readJson(req);
      const email = cleanEmail(body.email);
      const code = String(body.code ?? '').trim();
      const row = q.getCode.get(email);
      if (!row || row.expires_at < Date.now()) return json(res, 400, { error: 'Code expired. Request a new one.' });
      if (row.attempts >= 5) return json(res, 400, { error: 'Too many attempts. Request a new code.' });
      if (row.code !== hash(code)) {
        q.bumpAttempts.run(email);
        return json(res, 400, { error: 'Wrong code.' });
      }
      q.delCode.run(email);
      const key = `email:${email}`;
      const existing = q.playerByKey.get(key);
      // An existing account keeps its callsign; the name typed on a new device only seeds a brand-new account.
      q.upsertPlayer.run(key, existing?.name || row.name, 1, existing?.completed ?? '[]', existing?.best_flight ?? 0);
      // The device played anonymously before signing in: carry that progress over and remove the duplicate row.
      absorbDevice(key, body.deviceId);
      const player = q.playerByKey.get(key);
      const token = randomBytes(24).toString('base64url');
      q.addToken.run(hash(token), player.id);
      return json(res, 200, { token, name: player.name, completed: JSON.parse(player.completed), bestFlight: player.best_flight, radio: player.radio ? JSON.parse(player.radio) : null, setup: player.setup ? JSON.parse(player.setup) : null, logbook: player.logbook ? JSON.parse(player.logbook) : null });
    }

    if (req.method === 'POST' && url.pathname === '/api/scores') {
      const body = await readJson(req);
      const name = cleanName(body.name);
      const completed = cleanCompleted(body.completed);
      const bestFlight = Math.max(0, Math.min(MAX_FLIGHT_SECONDS, Math.round(Number(body.bestFlight) || 0)));
      if (!name) return json(res, 400, { error: 'Name required.' });
      const auth = req.headers.authorization?.replace(/^Bearer /, '');
      const verified = auth ? q.playerByToken.get(hash(auth)) : null;
      let key;
      if (verified) {
        key = verified.key;
        absorbDevice(key, body.deviceId); // cleans up a leftover anonymous row from before sign-in
      } else {
        const deviceId = String(body.deviceId ?? '');
        if (!validDeviceId(deviceId)) return json(res, 400, { error: 'Bad device id.' });
        key = `device:${deviceId}`;
      }
      const existing = q.playerByKey.get(key);
      const merged = [...new Set([...(existing ? JSON.parse(existing.completed) : []), ...completed])];
      q.upsertPlayer.run(key, name, verified ? 1 : 0, JSON.stringify(merged), bestFlight);
      // Transmitter calibration travels with the account (verified players only; it is per-dongle, keyed by gamepad id).
      if (verified && body.radio && typeof body.radio === 'object') {
        const radio = JSON.stringify(body.radio).slice(0, 20000);
        q.setRadio.run(radio, key);
      }
      if (verified && body.setup && typeof body.setup === 'object') {
        q.setSetup.run(JSON.stringify(body.setup).slice(0, 20000), key);
      }
      // The logbook (last sixty flights) travels with the account too: union with what the server has, by timestamp.
      if (verified && Array.isArray(body.logbook)) {
        const have = existing?.logbook ? JSON.parse(existing.logbook) : [];
        const seen = new Set(have.map((e) => e.at));
        const clean = body.logbook
          .filter((e) => e && typeof e.at === 'number' && typeof e.seconds === 'number' && !seen.has(e.at))
          .map((e) => ({ at: e.at, model: String(e.model ?? '').slice(0, 60), seconds: Number(e.seconds), crashed: Boolean(e.crashed), reason: String(e.reason ?? '').slice(0, 120), touchdown: Number(e.touchdown) || 0, maxAltitude: Number(e.maxAltitude) || 0, maxSpeed: Number(e.maxSpeed) || 0, maxG: Number(e.maxG) || 1, tricks: Array.isArray(e.tricks) ? e.tricks.slice(0, 20).map(String) : [] }));
        const merged = [...have, ...clean].sort((a, b) => b.at - a.at).slice(0, 60);
        q.setLogbook.run(JSON.stringify(merged).slice(0, 60000), key);
      }
      return json(res, 200, { ok: true });
    }

    // Transmitter diagnostics: the game samples a USB radio's axes/buttons and posts them here so a
    // default mapping can be written for that dongle. No personal data beyond the pilot name.
    if (req.method === 'POST' && url.pathname === '/api/radio-report') {
      if (limited(ip, 10)) return json(res, 429, { error: 'Too many reports.' });
      const body = await readJson(req);
      const report = JSON.stringify(body).slice(0, 20000);
      q.addReport.run(report);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/radio-reports') {
      return json(res, 200, q.lastReports.all().map((r) => ({ id: r.id, at: r.created_at, report: JSON.parse(r.report) })));
    }

    if (req.method === 'GET' && url.pathname === '/api/rankings') {
      const kind = url.searchParams.get('kind');
      if (kind === 'flight') return json(res, 200, q.topFlight.all().map((r) => ({ name: r.name, value: r.value, verified: !!r.verified, at: r.at })));
      if (kind === 'challenge') {
        const rows = q.all.all().map((r) => ({ name: r.name, value: points(JSON.parse(r.completed)), verified: !!r.verified, at: r.at })).filter((r) => r.value > 0);
        rows.sort((a, b) => b.value - a.value || a.at.localeCompare(b.at));
        return json(res, 200, rows.slice(0, 100));
      }
      return json(res, 400, { error: 'kind must be flight or challenge' });
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`rankings server on :${PORT} (db ${DB_PATH}, mail ${RESEND_API_KEY ? 'resend' : 'console'})`));
