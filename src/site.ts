/** Which flying site is loaded. Chosen once at start-up (preference or ?site=), changing it reloads the page. */
export type SiteId = 'field' | 'gym';

let current: SiteId = 'field';

export function setSite(site: SiteId): void {
  current = site;
}

export function getSite(): SiteId {
  return current;
}

/** Challenges that need the outdoor field (altitude, wind or its landing targets). */
export const FIELD_ONLY = new Set(['land-table', 'land-truck', 'land-pontoon', 'land-tower', 'crosswind-landing', 'autorotation', 'stall-turn', 'loop', 'funnel', 'tic-toc', 'piro-flip']);
