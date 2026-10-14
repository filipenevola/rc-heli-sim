// Pilot levels (mirrors src/game/sim-level.ts). The client classifies each flight from the settings it was flown
// with; the server keeps one best clean flight per board and the level each challenge was flown at.

export const LEVELS = ['beginner', 'amateur', 'pro'];
export const LEVEL_COLUMN = { beginner: 'best_beginner', amateur: 'best_amateur', pro: 'best_pro' };

const rank = (l) => LEVELS.indexOf(l);

/**
 * Per-board bests from a score post. A record on a board also counts on every easier one, and the legacy
 * `bestFlight` (older clients, settings unknown) counts as Beginner.
 */
export function cleanBests(bests, legacyBest, maxSeconds) {
  const clamp = (v) => Math.max(0, Math.min(maxSeconds, Math.round(Number(v) || 0)));
  const src = bests && typeof bests === 'object' ? bests : {};
  const out = { beginner: clamp(src.beginner), amateur: clamp(src.amateur), pro: clamp(src.pro) };
  out.amateur = Math.max(out.amateur, out.pro);
  out.beginner = Math.max(out.beginner, out.amateur, clamp(legacyBest));
  return out;
}

/** Union of two challenge-level maps, keeping the higher level per challenge; unknown ids and levels are dropped. */
export function mergeChallengeLevels(a, b, validIds) {
  const out = {};
  for (const src of [a, b]) {
    if (!src || typeof src !== 'object') continue;
    for (const [id, l] of Object.entries(src)) {
      if (!validIds.has(id) || !LEVELS.includes(l)) continue;
      if (!out[id] || rank(l) > rank(out[id])) out[id] = l;
    }
  }
  return out;
}

/** How many challenges were flown at Pro, counting only challenges the player has completed. */
export function proCount(levels, completed) {
  return completed.filter((id) => levels?.[id] === 'pro').length;
}
