/**
 * Minimal localisation: English is the source of truth in the code; other languages are dictionaries keyed by
 * the English string. `t()` returns the translation or the English text. `localizeDom()` walks rendered DOM and
 * translates text nodes and tooltip attributes in place, so panels built from HTML templates need no edits.
 */
import { PT_BR } from './pt-br';
import { PT_BR_LESSONS } from './pt-br-lessons';

export type Lang = 'en' | 'pt-BR';

const DICTS: Record<Lang, Record<string, string>> = { en: {}, 'pt-BR': { ...PT_BR, ...PT_BR_LESSONS } };
let current: Lang = 'en';
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  document.documentElement.lang = lang === 'pt-BR' ? 'pt-BR' : 'en';
  for (const fn of listeners) fn();
}

/** Called when the language changes, so panels re-render. */
export function onLangChange(fn: () => void): void {
  listeners.add(fn);
}

/** Browser preference, used on the first visit. */
export function detectLang(): Lang {
  const l = (navigator.language || '').toLowerCase();
  return l.startsWith('pt') ? 'pt-BR' : 'en';
}

/** Translate a string; `{name}` placeholders are substituted from `vars` after translation. */
export function t(en: string, vars?: Record<string, string | number>): string {
  let s = DICTS[current][en] ?? en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Dictionary keys with placeholders, compiled to regexes for `tDyn`. */
const dynamic: Record<Lang, { re: RegExp; keys: string[]; tr: string }[]> = { en: [], 'pt-BR': [] };
for (const lang of ['pt-BR'] as Lang[]) {
  for (const [k, v] of Object.entries(DICTS[lang])) {
    if (!k.includes('{')) continue;
    const keys: string[] = [];
    const src = k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_m, name: string) => { keys.push(name); return '(.+?)'; });
    dynamic[lang].push({ re: new RegExp(`^${src}$`), keys, tr: v });
  }
}

/** Translate text that was built from a template (e.g. "Ring 3 of 7: ..."): exact match first, then placeholder keys. */
export function tDyn(text: string): string {
  if (current === 'en') return text;
  const exact = DICTS[current][text];
  if (exact !== undefined) return exact;
  for (const d of dynamic[current]) {
    const m = text.match(d.re);
    if (m) {
      let out = d.tr;
      d.keys.forEach((k, i) => (out = out.split(`{${k}}`).join(m[i + 1])));
      return out;
    }
  }
  return text;
}

const ATTRS = ['data-tip', 'title', 'placeholder'];

/**
 * Translate every text node and tooltip attribute under `root` whose (trimmed) text matches a dictionary key.
 * Keeps surrounding whitespace. Safe to call repeatedly; in English it is a no-op.
 */
export function localizeDom(root: ParentNode): void {
  if (current === 'en') return;
  const dict = DICTS[current];
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n.nodeType === Node.TEXT_NODE) {
      const raw = n.textContent ?? '';
      const key = raw.replace(/\s+/g, ' ').trim();
      if (!key) continue;
      const tr = dict[key];
      if (tr !== undefined) {
        const lead = raw.match(/^\s*/)![0];
        const tail = raw.match(/\s*$/)![0];
        n.textContent = lead + tr + tail;
      }
    } else {
      const el = n as Element;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v && dict[v] !== undefined) el.setAttribute(a, dict[v]);
      }
    }
  }
}
