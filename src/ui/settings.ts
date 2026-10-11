import { HELI_MODELS, type HeliModel } from '../sim/heli-model';
import type { InputManager, SourceChoice } from '../input/manager';
import { saveMapping, type AxisMapping, type GamepadMapping } from '../input/gamepad';
import type { StickMode } from '../input/types';
import type { Wind } from '../sim/wind';
import type { AudioEngine } from '../audio/engine';
import type { AssistMode } from '../sim/physics';

export interface SettingsCallbacks {
  onModel(model: HeliModel): void;
  onReset(): void;
  onFlightMode(mode: 0 | 1 | 2): void;
  onThrottleHold(hold: boolean): void;
  onAssist(mode: AssistMode): void;
  onHelp(): void;
}

type AxisName = 'aileron' | 'elevator' | 'rudder' | 'collective';
const AXES: AxisName[] = ['aileron', 'elevator', 'rudder', 'collective'];
const AXIS_HINT: Record<AxisName, string> = {
  aileron: 'move the AILERON stick fully RIGHT',
  elevator: 'push the ELEVATOR stick fully FORWARD (nose down)',
  rudder: 'move the RUDDER stick fully RIGHT',
  collective: 'move the THROTTLE / collective stick fully UP',
};

/** Plain-DOM settings drawer: model, input device, stick mode, rates/expo, wind, and the transmitter mapping wizard. */
export class SettingsPanel {
  private panel: HTMLElement;
  private wizardState: { axis: AxisName; baseline: number[] } | null = null;
  private wizardStatus: HTMLElement | null = null;
  private axisBars: HTMLElement | null = null;
  private calibrating: { min: number[]; max: number[] } | null = null;

  constructor(container: HTMLElement, private input: InputManager, private wind: Wind, private audio: AudioEngine, private cb: SettingsCallbacks) {
    const bar = document.createElement('div');
    bar.className = 'topbar';
    bar.innerHTML = `
      <button id="btn-reset" title="R">Reset</button>
      <button id="btn-mode" title="1 / 2 / 3">Mode: Normal</button>
      <button id="btn-hold" title="H">Hold: off</button>
      <button id="btn-sound" title="M">Sound: on</button>
      <button id="btn-settings">Settings</button>
      <button id="btn-recentre" title="Recentre phone tilt" style="display:none">Recentre</button>
      <button id="btn-help" title="?">Help</button>
      <button id="btn-full" title="F">Full</button>
      <button id="btn-hide" title="U">Hide</button>`;
    const showBtn = document.createElement('button');
    showBtn.className = 'show-ui';
    showBtn.textContent = '☰';
    showBtn.title = 'Show controls (U)';
    showBtn.style.display = 'none';
    container.appendChild(showBtn);
    container.appendChild(bar);
    this.panel = document.createElement('div');
    this.panel.className = 'settings';
    this.panel.style.display = 'none';
    container.appendChild(this.panel);

    bar.querySelector('#btn-reset')!.addEventListener('click', () => cb.onReset());
    bar.querySelector('#btn-settings')!.addEventListener('click', () => this.toggle());
    const setHidden = (hidden: boolean) => {
      document.body.classList.toggle('ui-hidden', hidden);
      showBtn.style.display = hidden ? '' : 'none';
      if (hidden) this.panel.style.display = 'none';
    };
    bar.querySelector('#btn-hide')!.addEventListener('click', () => setHidden(true));
    bar.querySelector('#btn-help')!.addEventListener('click', () => cb.onHelp());
    bar.querySelector('#btn-recentre')!.addEventListener('click', () => input.motion.recentre());
    showBtn.addEventListener('click', () => setHidden(false));
    bar.querySelector('#btn-full')!.addEventListener('click', () => void toggleFullscreen());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyU') setHidden(!document.body.classList.contains('ui-hidden'));
      if (e.code === 'KeyF') void toggleFullscreen();
    });
    const soundBtn = bar.querySelector('#btn-sound') as HTMLButtonElement;
    const toggleSound = () => {
      audio.setMuted(!audio.muted);
      soundBtn.textContent = `Sound: ${audio.muted ? 'off' : 'on'}`;
    };
    soundBtn.addEventListener('click', toggleSound);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') toggleSound();
    });
    bar.querySelector('#btn-mode')!.addEventListener('click', () => {
      this.flightMode = ((this.flightMode + 1) % 3) as 0 | 1 | 2;
      cb.onFlightMode(this.flightMode);
    });
    bar.querySelector('#btn-hold')!.addEventListener('click', () => {
      this.hold = !this.hold;
      cb.onThrottleHold(this.hold);
    });
    this.bar = bar;
    this.render();
  }

  private bar: HTMLElement;
  flightMode: 0 | 1 | 2 = 0;
  hold = false;
  assist: AssistMode = 'rate';

  /** Keep the top bar in sync with whatever the active source says. */
  reflect(mode: 0 | 1 | 2, hold: boolean): void {
    if (mode !== this.flightMode || hold !== this.hold) {
      this.flightMode = mode;
      this.hold = hold;
      (this.bar.querySelector('#btn-mode') as HTMLElement).textContent = `Mode: ${['Normal', 'Idle-Up 1', 'Idle-Up 2'][mode]}`;
      (this.bar.querySelector('#btn-hold') as HTMLElement).textContent = `Hold: ${hold ? 'ON' : 'off'}`;
    }
  }

  toggle(): void {
    const open = this.panel.style.display === 'none';
    this.panel.style.display = open ? '' : 'none';
    if (open) this.render();
  }

  private render(): void {
    const im = this.input;
    const g = im.gamepad;
    const sel = (id: string, options: [string, string][], value: string) =>
      `<select id="${id}">${options.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const slider = (id: string, label: string, min: number, max: number, step: number, value: number) =>
      `<label>${label} <span id="${id}-v">${value}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;

    this.panel.innerHTML = `
      <h3>Settings <button id="close">×</button></h3>
      <p class="hint">Build ${__BUILD__}</p>
      <section>
        <h4>Helicopter</h4>
        ${sel('model', HELI_MODELS.map((m) => [m.id, m.name]), HELI_MODELS[0].id)}
      </section>
      <section>
        <h4>Input</h4>
        ${sel('source', [['auto', 'Auto (last used)'], ['gamepad', 'Transmitter (USB dongle)'], ['touch', 'Touch sticks'], ['motion', 'Phone tilt + touch throttle'], ['keyboard', 'Keyboard']], im.choice)}
        <div id="source-status" class="hint"></div>
        <label>Assist ${sel('assist', [['rate', 'Rate — real helicopter behaviour'], ['attitude', 'Attitude — stick sets bank angle, self-levels']], this.assist)}</label>
        ${slider('tilt', 'Phone tilt for full stick (°)', 10, 45, 1, im.motion.maxTiltDeg)}
        <label>Touch stick mode ${sel('stickmode', [['1', 'Mode 1'], ['2', 'Mode 2'], ['3', 'Mode 3'], ['4', 'Mode 4']], String(im.touch.mode))}</label>
        ${slider('expo', 'Cyclic expo', 0, 0.8, 0.05, im.shaping.aileron.expo)}
        ${slider('rate', 'Cyclic dual rate', 0.3, 1, 0.05, im.shaping.aileron.rate)}
        ${slider('rexpo', 'Rudder expo', 0, 0.8, 0.05, im.shaping.rudder.expo)}
        <p class="hint">Keyboard: arrows = cyclic, W/S = collective, A/D = rudder, 1/2/3 flight mode, H throttle hold, R reset.</p>
      </section>
      <section>
        <h4>Transmitter mapping</h4>
        <div id="pad-status">${g.available() ? `Connected: <code>${g.padId || '(move a stick)'}</code>` : 'No USB transmitter detected. Plug in the dongle and move a stick.'}</div>
        <div id="axis-bars"></div>
        <div class="wizard">
          ${AXES.map((a) => `<button data-assign="${a}">Assign ${a}</button>`).join('')}
          <button id="calibrate">Calibrate travel</button>
          <button id="save-mapping">Save</button>
        </div>
        <div id="wizard-status" class="hint"></div>
      </section>
      <section>
        <h4>Sound</h4>
        ${slider('volume', 'Volume', 0, 1, 0.05, this.audio.volume)}
      </section>
      <section>
        <h4>Wind</h4>
        ${slider('wind', 'Speed (m/s)', 0, 10, 0.5, this.wind.speed)}
        ${slider('winddir', 'From (°)', 0, 359, 5, this.wind.fromDeg)}
        ${slider('gust', 'Gustiness', 0, 1, 0.1, this.wind.gustiness)}
      </section>`;

    const q = <T extends HTMLElement>(s: string) => this.panel.querySelector(s) as T;
    q('#close').addEventListener('click', () => this.toggle());
    q<HTMLSelectElement>('#model').addEventListener('change', (e) => {
      const m = HELI_MODELS.find((x) => x.id === (e.target as HTMLSelectElement).value)!;
      this.cb.onModel(m);
    });
    q<HTMLSelectElement>('#source').addEventListener('change', (e) => {
      const choice = (e.target as HTMLSelectElement).value as SourceChoice;
      const status = q('#source-status');
      void im.select(choice).then((ok) => {
        if (choice === 'motion' && ok) {
          this.setAssist('attitude');
          status.textContent = 'Phone tilt on. Hold the phone the way you want to fly and tap Recentre; tilt = bank. Attitude assist enabled.';
        } else if (choice === 'motion') {
          status.textContent = 'The browser refused orientation access (needs HTTPS and permission). Back to touch sticks.';
          (e.target as HTMLSelectElement).value = 'touch';
        } else status.textContent = '';
        this.updateRecentre();
      });
    });
    q<HTMLSelectElement>('#assist').addEventListener('change', (e) => this.setAssist((e.target as HTMLSelectElement).value as AssistMode));
    q<HTMLSelectElement>('#stickmode').addEventListener('change', (e) => im.touch.setMode(Number((e.target as HTMLSelectElement).value) as StickMode));
    const bind = (id: string, f: (v: number) => void) => {
      const el = q<HTMLInputElement>(`#${id}`);
      el.addEventListener('input', () => {
        q(`#${id}-v`).textContent = el.value;
        f(Number(el.value));
      });
    };
    bind('expo', (v) => { im.shaping.aileron.expo = v; im.shaping.elevator.expo = v; });
    bind('rate', (v) => { im.shaping.aileron.rate = v; im.shaping.elevator.rate = v; });
    bind('rexpo', (v) => (im.shaping.rudder.expo = v));
    bind('tilt', (v) => (im.motion.maxTiltDeg = v));
    bind('volume', (v) => this.audio.setVolume(v));
    bind('wind', (v) => (this.wind.speed = v));
    bind('winddir', (v) => (this.wind.fromDeg = v));
    bind('gust', (v) => (this.wind.gustiness = v));

    this.wizardStatus = q('#wizard-status');
    this.axisBars = q('#axis-bars');
    for (const b of this.panel.querySelectorAll<HTMLButtonElement>('[data-assign]')) {
      b.addEventListener('click', () => this.startAssign(b.dataset.assign as AxisName));
    }
    q('#calibrate').addEventListener('click', () => this.startCalibrate());
    q('#save-mapping').addEventListener('click', () => {
      if (g.mapping) {
        saveMapping(g.mapping);
        this.wizardStatus!.textContent = 'Mapping saved for this transmitter.';
      }
    });
  }

  private startAssign(axis: AxisName): void {
    const g = this.input.gamepad;
    if (!g.available()) {
      this.wizardStatus!.textContent = 'No transmitter detected.';
      return;
    }
    this.wizardState = { axis, baseline: [...g.rawAxes] };
    this.wizardStatus!.textContent = `Now ${AXIS_HINT[axis]} and hold it...`;
  }

  private startCalibrate(): void {
    const g = this.input.gamepad;
    if (!g.available()) return;
    this.calibrating = { min: [...g.rawAxes], max: [...g.rawAxes] };
    this.wizardStatus!.textContent = 'Move every stick to all four corners, then click "Calibrate travel" again to finish.';
    const btn = this.panel.querySelector('#calibrate') as HTMLButtonElement;
    btn.textContent = 'Finish calibration';
    btn.onclick = () => {
      const c = this.calibrating!;
      const m = g.mapping!;
      for (const a of AXES) {
        const am = m[a];
        if (c.max[am.index] - c.min[am.index] > 0.3) {
          am.min = c.min[am.index];
          am.max = c.max[am.index];
        }
      }
      this.calibrating = null;
      btn.textContent = 'Calibrate travel';
      btn.onclick = () => this.startCalibrate();
      this.wizardStatus!.textContent = 'Travel calibrated. Click Save to keep it.';
    };
  }

  setAssist(mode: AssistMode): void {
    this.assist = mode;
    const sel = this.panel.querySelector('#assist') as HTMLSelectElement | null;
    if (sel) sel.value = mode;
    this.cb.onAssist(mode);
  }

  private updateRecentre(): void {
    (this.bar.querySelector('#btn-recentre') as HTMLElement).style.display = this.input.choice === 'motion' ? '' : 'none';
  }

  /** Called every frame while the panel is open: live axis bars plus the assign/calibrate state machines. */
  tick(): void {
    if (this.panel.style.display === 'none') return;
    const g = this.input.gamepad;
    if (this.axisBars && g.available()) {
      const m = g.mapping;
      const label = (i: number) => (m ? AXES.find((a) => m[a].index === i) ?? '' : '');
      this.axisBars.innerHTML = g.rawAxes
        .map((v, i) => `<div class="axis"><span>${i} ${label(i)}</span><div class="bar"><i style="left:${50 + v * 50}%"></i></div></div>`)
        .join('');
      const status = this.panel.querySelector('#pad-status');
      if (status && g.padId) status.innerHTML = `Connected: <code>${g.padId}</code>`;
    }
    if (this.calibrating) {
      for (let i = 0; i < g.rawAxes.length; i++) {
        this.calibrating.min[i] = Math.min(this.calibrating.min[i] ?? 1, g.rawAxes[i]);
        this.calibrating.max[i] = Math.max(this.calibrating.max[i] ?? -1, g.rawAxes[i]);
      }
    }
    if (this.wizardState && g.mapping) {
      const { axis, baseline } = this.wizardState;
      let best = -1;
      let bestDelta = 0;
      for (let i = 0; i < g.rawAxes.length; i++) {
        const d = g.rawAxes[i] - (baseline[i] ?? 0);
        if (Math.abs(d) > Math.abs(bestDelta)) {
          bestDelta = d;
          best = i;
        }
      }
      if (best >= 0 && Math.abs(bestDelta) > 0.6) {
        // The hint asks for the positive direction, so a negative delta means the axis is inverted.
        const am: AxisMapping = { ...g.mapping[axis], index: best, invert: bestDelta < 0 };
        (g.mapping as GamepadMapping)[axis] = am;
        this.wizardState = null;
        this.wizardStatus!.textContent = `${axis} → axis ${best}${am.invert ? ' (inverted)' : ''}. Assign the next one or Save.`;
      }
    }
  }
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    // Landscape is the natural orientation for a sim; not every browser allows locking, so ignore failures.
    const orient = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orient.lock?.('landscape').catch(() => undefined);
  } catch {
    /* fullscreen not available (iOS Safari in-page); nothing to do */
  }
}
