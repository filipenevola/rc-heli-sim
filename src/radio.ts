/**
 * The phone-radio page (/radio.html): turns a phone into the transmitter for a sim running on another screen.
 * Pair with the 4-letter code shown in the sim's Settings → Input → Phone radio, then the touch gimbals (or phone
 * tilt for the cyclic) stream to the sim over a direct WebRTC channel at 50 Hz.
 */
import './style.css';
import { TouchInput } from './input/touch';
import { MotionInput } from './input/motion';
import { joinLink, type LinkState, type RadioLink } from './net/radio-link';
import { detectLang, setLang, t, type Lang } from './i18n';
import type { StickMode } from './input/types';

declare const __VERSION__: string;

const api = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');
try {
  const prefs = JSON.parse(localStorage.getItem('rc-heli-sim.prefs.v1') ?? '{}') as { lang?: Lang; stickMode?: number };
  setLang(prefs.lang ?? detectLang());
} catch { setLang(detectLang()); }

const root = document.getElementById('radio')!;
const params = new URLSearchParams(location.search);
let link: RadioLink | null = null;
let touch: TouchInput | null = null;
let motion: MotionInput | null = null;
let tilt = false;
let sendTimer = 0;
let pingTimer = 0;
let latency = 0;
let wakeLock: { release(): Promise<void> } | null = null;

function renderPair(message = ''): void {
  root.innerHTML = `
    <div class="radio-pair">
      <h2>📻 ${t('Phone radio')}</h2>
      <p>${t('Use this phone as the transmitter for RC Heli Sim on another screen. In the sim open Settings → Input → Phone radio → Pair a phone, then type the code here.')}</p>
      <form id="pair-form">
        <input id="code" inputmode="latin" autocapitalize="characters" autocomplete="off" maxlength="4" placeholder="CODE" value="${(params.get('c') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)}">
        <button type="submit">${t('Connect')}</button>
      </form>
      <p class="hint" id="pair-status">${message}</p>
      ${api ? '' : `<p class="hint">${t('This build has no API configured; pairing needs the online rankings server.')}</p>`}
      <p class="hint">v${__VERSION__}</p>
    </div>`;
  const form = root.querySelector<HTMLFormElement>('#pair-form')!;
  const input = root.querySelector<HTMLInputElement>('#code')!;
  input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = input.value.trim().toUpperCase();
    if (code.length !== 4 || !api) return;
    connect(code);
  });
  if (input.value.length === 4 && api && params.get('auto') !== '0') connect(input.value);
}

function connect(code: string): void {
  link?.close();
  link = joinLink(api, code);
  const status = root.querySelector('#pair-status');
  if (status) status.textContent = t('Connecting…');
  link.onState = (s) => onState(s, code);
  if (link.state !== 'idle') onState(link.state, code);
  link.onMessage = (text) => {
    try {
      const msg = JSON.parse(text) as { pong?: number };
      if (typeof msg.pong === 'number') {
        latency = Math.round(performance.now() - msg.pong);
        const el = root.querySelector('#latency');
        if (el) el.textContent = `${latency} ms`;
        link?.send(JSON.stringify({ lat: latency }));
      }
    } catch { /* ignore */ }
  };
}

function onState(s: LinkState, code: string): void {
  if (s === 'connected') renderSticks(code);
  else if (s === 'failed') { stopStreaming(); renderPair(t('Could not connect. Check the code (it changes every time you press Pair) and that both devices are online.')); }
  else if (s === 'closed') { stopStreaming(); renderPair(t('Disconnected.')); }
  else {
    const status = root.querySelector('#pair-status');
    if (status) status.textContent = s === 'waiting' ? t('Looking for the sim…') : t('Connecting…');
  }
}

function renderSticks(code: string): void {
  root.innerHTML = `
    <div class="radio-bar">
      <span class="radio-code">${code}</span>
      <button data-mode="0" class="active">N</button><button data-mode="1">ID1</button><button data-mode="2">ID2</button>
      <button id="hold">✋ HOLD</button>
      <button id="tilt" title="${t('Phone tilt for the cyclic')}">📱 ${t('Tilt')}</button>
      <select id="stickmode"><option value="1">Mode 1</option><option value="2" selected>Mode 2</option><option value="3">Mode 3</option><option value="4">Mode 4</option></select>
      <span class="hint"><b id="latency">–</b></span>
      <button id="disconnect">✕</button>
    </div>
    <div class="radio-sticks" id="sticks"></div>
    <p class="radio-hint hint">${t('Left stick: collective and rudder. Right stick: cyclic. The collective stays where you leave it.')}</p>`;
  const sticksEl = root.querySelector<HTMLElement>('#sticks')!;
  touch = new TouchInput(sticksEl);
  motion = new MotionInput(touch);
  try {
    const prefs = JSON.parse(localStorage.getItem('rc-heli-sim.prefs.v1') ?? '{}') as { stickMode?: number };
    if (prefs.stickMode) { touch.setMode(prefs.stickMode as StickMode); root.querySelector<HTMLSelectElement>('#stickmode')!.value = String(prefs.stickMode); }
  } catch { /* defaults */ }
  const modeBtns = [...root.querySelectorAll<HTMLButtonElement>('button[data-mode]')];
  for (const b of modeBtns) b.addEventListener('click', () => {
    const m = Number(b.dataset.mode) as 0 | 1 | 2;
    touch!.setFlightMode(m);
    for (const o of modeBtns) o.classList.toggle('active', o === b);
  });
  const hold = root.querySelector<HTMLButtonElement>('#hold')!;
  hold.addEventListener('click', () => {
    touch!.setThrottleHold(!touch!.throttleHold);
    hold.classList.toggle('active', touch!.throttleHold);
  });
  const tiltBtn = root.querySelector<HTMLButtonElement>('#tilt')!;
  tiltBtn.addEventListener('click', () => {
    void (async () => {
      if (!tilt) {
        const ok = await motion!.enable();
        if (!ok) { tiltBtn.textContent = `📱 ${t('Tilt refused')}`; return; }
      }
      tilt = !tilt;
      motion!.setEnabled(tilt);
      tiltBtn.classList.toggle('active', tilt);
      tiltBtn.textContent = tilt ? `📱 ${t('Recentre')}` : `📱 ${t('Tilt')}`;
    })();
  });
  tiltBtn.addEventListener('dblclick', () => motion?.recentre());
  root.querySelector<HTMLSelectElement>('#stickmode')!.addEventListener('change', (e) => touch!.setMode(Number((e.target as HTMLSelectElement).value) as StickMode));
  root.querySelector('#disconnect')!.addEventListener('click', () => { link?.close(); });
  startStreaming();
}

function startStreaming(): void {
  clearTimers();
  void (navigator as unknown as { wakeLock?: { request(k: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => undefined);
  sendTimer = window.setInterval(() => {
    if (!link || !touch) return;
    const f = tilt && motion ? motion.poll(0) : touch.poll(0);
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    link.send(JSON.stringify({ a: r3(f.aileron), e: r3(f.elevator), r: r3(f.rudder), c: r3(f.collective), m: f.flightMode, h: f.throttleHold ? 1 : 0 }));
  }, 20);
  pingTimer = window.setInterval(() => link?.send(JSON.stringify({ ping: performance.now() })), 1000);
}

function clearTimers(): void {
  if (sendTimer) clearInterval(sendTimer);
  if (pingTimer) clearInterval(pingTimer);
  sendTimer = pingTimer = 0;
}

function stopStreaming(): void {
  clearTimers();
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
  touch = null;
  motion = null;
  tilt = false;
}

renderPair();
(window as unknown as { phoneRadio: unknown }).phoneRadio = { get link() { return link; }, get touch() { return touch; }, connect };
