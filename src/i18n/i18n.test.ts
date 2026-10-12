// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { getLang, localizeDom, setLang, t, tDyn } from './index';
import { PT_BR } from './pt-br';
import { PT_BR_LESSONS } from './pt-br-lessons';
import { CHALLENGES } from '../game/challenges';
import { LESSONS } from '../game/lessons';

afterEach(() => setLang('en'));

describe('localisation', () => {
  it('falls back to English and substitutes placeholders', () => {
    expect(t('Head speed')).toBe('Head speed');
    setLang('pt-BR');
    expect(getLang()).toBe('pt-BR');
    expect(t('Head speed')).toBe('Rotação');
    expect(t('Step {n} of {total}', { n: 2, total: 5 })).toBe('Passo 2 de 5');
    expect(t('not in the dictionary')).toBe('not in the dictionary');
  });

  it('translates template-built captions through placeholder keys', () => {
    setLang('pt-BR');
    expect(tDyn('Ring 3 of 7: coordinated turn, nose into it, hold height with collective.')).toBe('Anel 3 de 7: curva coordenada, nariz para dentro, mantenha a altura com coletivo.');
    expect(tDyn('Flight 2: lift to 3 m and hold.')).toBe('Voo 2: suba a 3 m e segure.');
    expect(tDyn('Spool up.')).toBe('Acelere.');
  });

  it('localises rendered DOM text nodes and tooltip attributes in place', () => {
    setLang('pt-BR');
    const root = document.createElement('div');
    root.innerHTML = '<label>  Cyclic expo </label><button data-tip="Pause (P)" title="Pause (P)">x</button><span>42 rpm</span>';
    localizeDom(root);
    expect(root.querySelector('label')!.textContent).toBe('  Expo do cíclico ');
    expect(root.querySelector('button')!.dataset.tip).toBe('Pausar (P)');
    expect(root.querySelector('span')!.textContent).toBe('42 rpm');
  });

  it('covers every challenge title and description and every lesson intro and caption', () => {
    const missing: string[] = [];
    for (const c of CHALLENGES) {
      if (!PT_BR[c.title]) missing.push(c.title);
      if (!PT_BR[c.description]) missing.push(c.description);
    }
    for (const l of LESSONS) {
      if (!PT_BR[l.title] && !PT_BR_LESSONS[l.title]) missing.push(l.title);
      if (!PT_BR_LESSONS[l.intro]) missing.push(l.intro);
      for (const st of l.steps) if (st.caption && !PT_BR_LESSONS[st.caption] && !/^(Ring|Flight) \d/.test(st.caption)) missing.push(st.caption);
    }
    expect(missing).toEqual([]);
  });
});
