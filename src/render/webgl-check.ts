import * as THREE from 'three';
import { t } from '../i18n';

/*
 * Chrome can turn WebGL off for the whole browser (hardware acceleration off, or after the graphics chip crashed a few
 * times: chrome://gpu then reads "WebGL: Disabled" until Chrome restarts). three's renderer throws in that case, and
 * before 0.85.1 the page stayed black. Now a cheap probe runs first, the renderer is retried without the options the
 * driver may refuse, and when there is no WebGL at all the pilot gets a card that says how to turn it back on.
 */

function probe(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** The renderer, or null when this browser cannot create a WebGL context. */
export function createRenderer(params: THREE.WebGLRendererParameters): THREE.WebGLRenderer | null {
  if (!probe()) return null;
  for (const p of [params, { ...params, antialias: false, powerPreference: 'default' as const }]) {
    try {
      return new THREE.WebGLRenderer(p);
    } catch (e) {
      console.warn('WebGL renderer failed with', p, e);
    }
  }
  return null;
}

/** Full-screen card shown instead of the game when WebGL is unavailable. */
export function showNoWebGl(parent: HTMLElement): void {
  const card = document.createElement('div');
  card.className = 'no-webgl';
  card.innerHTML = `
    <h2>${t('3D graphics are turned off in this browser')}</h2>
    <p>${t('The simulator needs WebGL, and this browser refused to start it. Usually one of these fixes it:')}</p>
    <ol>
      <li>${t('Quit the browser completely and open it again. Chrome turns WebGL off after the graphics chip crashes a few times, until it restarts.')}</li>
      <li>${t('Chrome / Edge: Settings → System → turn on “Use graphics acceleration when available”, then Relaunch.')}</li>
      <li>${t('Still off? Open chrome://gpu and check the WebGL line, or try another browser (Safari, Firefox).')}</li>
    </ol>
    <button data-action="reload">${t('Try again')}</button>`;
  card.querySelector('[data-action="reload"]')!.addEventListener('click', () => location.reload());
  parent.appendChild(card);
}
