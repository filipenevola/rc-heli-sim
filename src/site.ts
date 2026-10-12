/** Which flying site is loaded. Chosen once at start-up (preference or ?site=), changing it reloads the page. */
export type SiteId = 'field' | 'gym' | 'lot' | 'hill';

let current: SiteId = 'field';

export function setSite(site: SiteId): void {
  current = site;
}

export function getSite(): SiteId {
  return current;
}

/** Challenges that need the outdoor field (altitude, wind or its landing targets). */
export const FIELD_ONLY = new Set(['land-table', 'land-truck', 'land-pontoon', 'land-tower', 'crosswind-landing', 'autorotation', 'tail-failure', 'stall-turn', 'loop', 'funnel', 'tic-toc', 'piro-flip']);
/** Challenges tied to one site's landing targets. Everything else is available on every site that can host it. */
const SITE_OF: Record<string, SiteId> = { 'land-table': 'field', 'land-truck': 'field', 'land-pontoon': 'field', 'land-tower': 'field', 'land-container': 'lot', 'land-mat': 'gym', 'land-vault': 'gym', 'land-slope': 'hill', 'land-bank': 'hill', 'slope-takeoff': 'hill' };

/** The site a challenge (and its lesson) belongs to when it has one; the field otherwise. */
export function siteFor(id: string): SiteId {
  return SITE_OF[id] ?? 'field';
}

/** Label for a challenge that belongs to another site. */
export function homeLabel(id: string): string {
  const home = SITE_OF[id];
  if (home === 'lot') return 'Parking lot only';
  if (home === 'gym') return 'Gym only';
  if (home === 'hill') return 'Hillside only';
  return 'Field only';
}

/** Challenges that cannot be completed on the current site. */
export function unavailableHere(id: string): boolean {
  const home = SITE_OF[id];
  if (home) return home !== current;
  if (current === 'gym') return FIELD_ONLY.has(id);
  return false;
}
