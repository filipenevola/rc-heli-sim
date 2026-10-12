import type { ControlFrame } from '../input/types';
import { t as tr } from '../i18n';
import type { HelicopterSim } from '../sim/physics';

const MODE_NAMES = ['Normal', 'Idle-Up 1', 'Idle-Up 2'];

export class Hud {
  private el: HTMLElement;
  private sticks: HTMLCanvasElement;
  private crash: HTMLElement;
  private fpsSamples = 0;
  private fpsTime = 0;
  private fps = 0;
  private compact = false;
  private lastHtml = '';
  private toast: HTMLElement;
  private toastUntil = 0;
  private airborne = false;
  private lastLanding: object | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    // Phones start compact (one line); tapping the HUD toggles the full table.
    this.compact = window.innerWidth < 760 || navigator.maxTouchPoints > 0;
    this.el.addEventListener('click', () => {
      this.compact = !this.compact;
    });
    container.appendChild(this.el);
    this.sticks = document.createElement('canvas');
    this.sticks.className = 'hud-sticks';
    this.sticks.width = 200;
    this.sticks.height = 100;
    container.appendChild(this.sticks);
    this.toast = document.createElement('div');
    this.toast.className = 'toast';
    this.toast.style.display = 'none';
    container.appendChild(this.toast);
    this.crash = document.createElement('div');
    this.crash.className = 'crash-banner';
    this.crash.style.display = 'none';
    container.appendChild(this.crash);
    this.graph = document.createElement('canvas');
    this.graph.className = 'hud-graph';
    this.graph.width = 300;
    this.graph.height = 120;
    this.graph.style.display = 'none';
    container.appendChild(this.graph);
  }

  /** Telemetry strip chart: the last 30 s of head speed, collective, altitude and G, like a radio's log. */
  private graph: HTMLCanvasElement;
  private samples: { rpm: number; col: number; alt: number; g: number }[] = [];
  private sampleAcc = 0;
  private graphOnFlag = false;

  get graphOn(): boolean {
    return this.graphOnFlag;
  }

  set graphOn(on: boolean) {
    this.graphOnFlag = on;
    this.graph.style.display = on ? '' : 'none';
    if (!on) this.samples = [];
  }

  private drawGraph(sim: HelicopterSim, dt: number): void {
    const t = sim.telemetry;
    const m = sim.model;
    this.sampleAcc += dt;
    if (this.sampleAcc >= 0.1) {
      this.sampleAcc = 0;
      const nominal = (m.headspeeds[2] * 60) / (2 * Math.PI);
      this.samples.push({ rpm: Math.min(1.2, t.headspeedRpm / nominal), col: (t.collectiveDeg + 14) / 28, alt: Math.min(1, t.altitude / 40), g: Math.max(0, Math.min(1, (t.gLoad + 1) / 4)) });
      if (this.samples.length > 300) this.samples.shift();
    }
    const g = this.graph.getContext('2d');
    if (!g) return;
    const W = this.graph.width;
    const H = this.graph.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    g.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75]) {
      g.beginPath();
      g.moveTo(0, H * (1 - f));
      g.lineTo(W, H * (1 - f));
      g.stroke();
    }
    const series: [keyof (typeof this.samples)[number], string, string][] = [
      ['rpm', '#ffd34d', 'rpm'],
      ['col', '#7fd4ff', `${t.collectiveDeg.toFixed(1)}°`],
      ['alt', '#9be08a', `${t.altitude.toFixed(1)} m`],
      ['g', '#ff8a80', `${t.gLoad.toFixed(1)} g`],
    ];
    const n = this.samples.length;
    for (const [key, color] of series) {
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / 299) * W;
        const y = H - 4 - (H - 8) * Math.max(0, Math.min(1, this.samples[i][key]));
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.font = '11px system-ui, sans-serif';
    let x = 6;
    for (const [, color, label] of series) {
      g.fillStyle = color;
      g.fillText(label, x, 12);
      x += g.measureText(label).width + 12;
    }
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillText('30 s', W - 28, H - 5);
  }

  onReplay: (() => void) | null = null;
  /** Hide the crash banner (while its replay plays). */
  crashHidden = false;
  /** The instructor's reading of the last two seconds (set by the host when a crash is detected). */
  crashNote = '';
  private pausedEl: HTMLElement | null = null;
  setPaused(p: boolean): void {
    if (!this.pausedEl) {
      this.pausedEl = document.createElement('div');
      this.pausedEl.className = 'paused-banner';
      this.pausedEl.innerHTML = '<b>⏸ Paused</b><br><span class="hint">Tap ▶ or press P to resume</span>';
      this.toast.parentElement!.appendChild(this.pausedEl);
    }
    this.pausedEl.style.display = p ? '' : 'none';
  }

  private warnEl: HTMLElement | null = null;
  private warn(text: string): void {
    if (!this.warnEl) {
      this.warnEl = document.createElement('div');
      this.warnEl.className = 'warn-banner';
      this.toast.parentElement!.appendChild(this.warnEl);
    }
    if (this.warnEl.textContent !== text) this.warnEl.textContent = text;
    this.warnEl.style.display = text ? '' : 'none';
  }

  /** Handler for `<button data-action="id">` buttons inside a toast. */
  onAction: ((id: string) => void) | null = null;

  /** Short on-screen note (mode changes, hints). Buttons with data-action call onAction and keep the toast open. */
  notify(html: string, ms = 3500): void {
    this.toast.innerHTML = html;
    this.toast.style.display = '';
    this.toastUntil = performance.now() + ms;
    this.toast.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toast.style.display = 'none';
        this.onAction?.(b.dataset.action!);
      });
    });
  }

  update(sim: HelicopterSim, ctl: ControlFrame, sourceLabel: string, sourceId: string, dt: number): void {
    this.fpsSamples++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsSamples / this.fpsTime;
      this.fpsSamples = 0;
      this.fpsTime = 0;
    }
    const t = sim.telemetry;
    const s = sim.state;
    const rows: [string, string][] = [
      [tr('Model'), tr(sim.model.name)],
      [tr('Input'), tr(sourceLabel)],
      [tr('Mode'), ctl.throttleHold ? tr('THROTTLE HOLD') : MODE_NAMES[ctl.flightMode]],
      [tr('Head speed'), `${t.headspeedRpm.toFixed(0)} rpm`],
      [tr('Collective'), `${t.collectiveDeg.toFixed(1)}°`],
      [tr('Altitude'), `${t.altitude.toFixed(1)} m`],
      [tr('Climb'), `${t.verticalSpeed.toFixed(1)} m/s`],
      [tr('Speed'), `${(t.groundSpeed * 3.6).toFixed(0)} km/h`],
      [tr('Distance'), `${Math.hypot(s.pos.x, s.pos.z).toFixed(0)} m`],
      [tr('Power'), `${t.motorPower.toFixed(0)} W`],
      [tr('G load'), `${t.gLoad.toFixed(1)} g`],
      [tr('Ground effect'), `${((t.groundEffect - 1) * 100).toFixed(0)}%`],
      [sim.model.power === 'nitro' ? tr('Fuel') : tr('Battery'), `${(t.battery * 100).toFixed(0)}%${t.battery < 0.1 ? ' ⚠' : ''}`],
      ['FPS', this.fps.toFixed(0)],
    ];
    const html = this.compact
      ? `<div class="strip"><b>${t.headspeedRpm.toFixed(0)}</b> rpm · <b>${t.collectiveDeg.toFixed(1)}°</b> · <b>${t.altitude.toFixed(1)}</b> m · ${sim.model.power === 'nitro' ? '⛽' : '🔋'}${(t.battery * 100).toFixed(0)}% · ${ctl.throttleHold ? 'HOLD' : MODE_NAMES[ctl.flightMode]}</div>`
      : rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    if (html !== this.lastHtml) {
      this.el.innerHTML = html;
      this.lastHtml = html;
    }
    // The on-screen gimbals already show stick position; the mini display would only cover them.
    this.sticks.style.display = sourceId === 'touch' || sourceId === 'motion' ? 'none' : '';
    this.drawSticks(ctl);
    if (this.graphOnFlag) this.drawGraph(sim, dt);
    this.warn(sim.state.tailFailed && !sim.state.onGround ? tr('TAIL ROTOR FAILURE: throttle hold now and autorotate.') : sim.state.engineDead ? tr('ENGINE QUIT (lean run): autorotate!') : t.engineHeat > 0.7 ? tr('Engine running hot: richen the needle (Model setup).') : t.vrs > 0.3 ? tr('VORTEX RING: descending into your own downwash. Forward cyclic or less collective.') : t.stall > 0.2 ? tr('BLADE STALL: too much collective for this head speed. Ease it off.') : t.wag > 0.5 ? tr('TAIL WAG: tail gyro gain too high. Lower it in Settings → Model setup.') : t.battery <= 0 ? (sim.model.power === 'nitro' ? tr('FUEL OUT: engine quit. Autorotate!') : tr('BATTERY FLAT: motor off. Autorotate!')) : t.battery < 0.1 ? (sim.model.power === 'nitro' ? tr('Fuel low: land soon.') : tr('Battery low: land soon.')) : '');
    if (!s.onGround && s.pos.y > 0.3) this.airborne = true;
    if (s.landed && s.landed !== this.lastLanding) {
      this.lastLanding = s.landed;
      // Only a landing after a flight counts: sitting on the pad at start-up is not one.
      if (this.airborne) {
        this.airborne = false;
        const cm = Math.round(s.landed.offset * 100);
        const key = `rc-heli-sim.best.${s.landed.target.id}`;
        const best = Number(localStorage.getItem(key) ?? Infinity);
        const record = cm < best;
        if (record) localStorage.setItem(key, String(cm));
        const line = `<b>${tr('Landed on the {name}', { name: s.landed.target.name })}</b>: ${cm} ${tr('cm from centre')}${record ? ` · ${tr('new best!')}` : best < Infinity ? ` · ${tr('best {cm} cm', { cm: best })}` : ''}`;
        if (this.toast.style.display !== 'none' && this.toast.querySelector('button[data-action]')) {
          // The debrief card is up: add the landing line to it rather than replacing it.
          this.toast.insertAdjacentHTML('afterbegin', `${line}<br>`);
        } else {
          this.toast.innerHTML = line;
          this.toast.style.display = '';
          this.toastUntil = performance.now() + 5000;
        }
      }
    }
    if (this.toastUntil && performance.now() > this.toastUntil) {
      this.toast.style.display = 'none';
      this.toastUntil = 0;
    }
    if (s.crashed && !this.crashHidden) {
      if (this.crash.style.display === 'none') {
        this.crash.innerHTML = `<h2>${tr('Crash')}</h2><p>${s.crashReason}</p>${this.crashNote ? `<p class="crash-note">🎓 ${tr(this.crashNote)}</p>` : ''}<p class="hint">${tr('Press R or tap Reset')}</p><button id="btn-replay">${tr('▶ Replay last 10 s')}</button>`;
        this.crash.querySelector('#btn-replay')!.addEventListener('click', () => this.onReplay?.());
      }
      this.crash.style.display = '';
    } else this.crash.style.display = 'none';
  }

  private drawSticks(ctl: ControlFrame): void {
    const g = this.sticks.getContext('2d')!;
    const w = this.sticks.width;
    const h = this.sticks.height;
    g.clearRect(0, 0, w, h);
    const box = (cx: number, x: number, y: number) => {
      const r = 40;
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 1;
      g.strokeRect(cx - r, h / 2 - r, r * 2, r * 2);
      g.beginPath();
      g.moveTo(cx - r, h / 2); g.lineTo(cx + r, h / 2);
      g.moveTo(cx, h / 2 - r); g.lineTo(cx, h / 2 + r);
      g.stroke();
      g.fillStyle = '#ffd34d';
      g.beginPath();
      g.arc(cx + x * r, h / 2 - y * r, 5, 0, Math.PI * 2);
      g.fill();
    };
    // Always drawn as Mode 2 for the display: left = rudder/collective, right = aileron/elevator.
    box(50, ctl.rudder, ctl.collective);
    box(150, ctl.aileron, ctl.elevator);
  }
}
