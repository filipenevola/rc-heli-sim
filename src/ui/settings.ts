import { HELI_MODELS, type HeliModel, type ModelSetup } from '../sim/heli-model';
import { DEFAULT_CUSTOM, normalizeSpec, type CustomSpec } from '../sim/custom-model';
import { getLang, localizeDom, setLang, t, type Lang } from '../i18n';
import { getSite, type SiteId } from '../site';
import { qrSvg } from '../net/qr';
import type { InputManager, SourceChoice } from '../input/manager';
import { saveMapping, builtinName, readAxis, type AxisMapping, type GamepadMapping, type SwitchMapping } from '../input/gamepad';
import type { StickMode } from '../input/types';
import type { Wind } from '../sim/wind';
import type { AudioEngine } from '../audio/engine';
import type { AssistMode } from '../sim/physics';
import { CAMERA_MODES, CAMERA_LABELS, type CameraMode } from '../render/camera';
import { attachTips } from './tips';
import { LEVEL_BADGE, LEVEL_LABEL, LEVEL_PRESETS, LEVEL_SUMMARY, SIM_LEVELS, presetOf, type SimLevel } from '../game/sim-level';

export const MODE_HELP = [
  'Normal: training mode. Low stick = motor off; the governor spools up as you raise it. Pitch −2° to +11°.',
  'Idle-Up 1: constant head speed, pitch −11° to +11° (centre stick = 0°). Needed for inverted flight and flips.',
  'Idle-Up 2: as Idle-Up 1 with more pitch and a higher head speed, for aggressive 3D.',
];
export const HOLD_HELP = {
  on: 'Throttle hold ON: motor off, the rotor freewheels. For autorotation practice or as a safety.',
  off: 'Throttle hold off: the motor is live.',
};

export interface SettingsCallbacks {
  onModel(model: HeliModel): void;
  /** The pilot described their own heli: build it, register it and fly it. */
  onCustom(spec: CustomSpec): HeliModel;
  onTrainingGear(on: boolean): void;
  /** The pilot changed the model setup (pitch curves, head speeds, gains) for the given base model. */
  onSetup(modelId: string, setup: ModelSetup): void;
  /** Current setup for a model id (from the profile), to prefill the sliders. */
  getSetup(modelId: string): ModelSetup | undefined;
  onReset(): void;
  onFlightMode(mode: 0 | 1 | 2): void;
  onThrottleHold(hold: boolean): void;
  onAssist(mode: AssistMode): void;
  onHelp(): void;
  onChallenges(): void;
  onPilot(): void;
  onPause(): void;
  /** Rescue (buddy box) pressed / released. */
  onRescue(on: boolean): void;
  /** Set a camera mode, or cycle when undefined. Returns the label of the active mode. */
  onCamera(mode?: CameraMode): string;
  /** Move the pilot to a named spot, or walk toward the helicopter ('heli'). */
  onPilotSpot(spot: string): void;
  onArrow(on: boolean): void;
  onTrail(on: boolean): void;
  /** Emergencies: fail the tail rotor now; toggle random tail failures. */
  onFailTail(): void;
  onRandomFailures(on: boolean): void;
  /** The ranking board the current settings qualify for (also looks at training gear and the site). */
  boardLevel(): SimLevel;
  /** Spoken captions on / off. */
  onVoice(on: boolean): void;
  /** Radio link latency, ms. */
  onLatency(ms: number): void;
  onTimeOfDay(t: 'morning' | 'noon' | 'evening'): void;
  /** Open or close the Hangar (parts explorer). */
  onHangar(): void;
  /** Graphics quality (reloads the page) and the current value. */
  onQuality(q: 'high' | 'low'): void;
  getQuality(): 'high' | 'low';
  /** A saved flight (.json from the debrief's Save flight) to replay, or to fly alongside as a ghost. */
  onLoadFlight(file: File, asGhost: boolean): void;
  onClearGhost(): void;
  onGraph(on: boolean): void;
  /** Top-down minimap on / off. */
  onMinimap(on: boolean): void;
}

type AxisName = 'aileron' | 'elevator' | 'rudder' | 'collective';
type SwitchName = 'flightModeSwitch' | 'throttleHoldSwitch' | 'rescueSwitch';
const AXES: AxisName[] = ['aileron', 'elevator', 'rudder', 'collective'];
const SWITCHES: [SwitchName, string][] = [['flightModeSwitch', 'Idle-Up switch'], ['throttleHoldSwitch', 'Throttle-hold switch'], ['rescueSwitch', 'Rescue switch']];
const AXIS_HINT: Record<AxisName | SwitchName, string> = {
  aileron: 'move the AILERON stick fully RIGHT',
  elevator: 'push the ELEVATOR stick fully FORWARD (nose down)',
  rudder: 'move the RUDDER stick fully RIGHT',
  collective: 'move the THROTTLE / collective stick fully UP',
  flightModeSwitch: 'start with the IDLE-UP switch in its Normal position, then flip it',
  throttleHoldSwitch: 'start with the THROTTLE HOLD switch off, then flip it on',
  rescueSwitch: 'start with the switch you want for RESCUE off, then flip it on',
};

const PREFS_KEY = 'rc-heli-sim.prefs.v1';
interface Prefs { latency?: number; minimap?: boolean; voice?: boolean; randomFailures?: boolean; seenVersion?: string; tod?: 'morning' | 'noon' | 'evening'; graph?: boolean; site?: SiteId; lang?: Lang; welcomed?: boolean; custom?: CustomSpec; trail?: boolean; gear?: boolean; nrate?: number; model?: string; source?: string; stickMode?: number; expo?: number; rate?: number; rexpo?: number; assist?: string; camera?: string; spot?: string; arrow?: boolean; wind?: number; windDir?: number; gust?: number; volume?: number; muted?: boolean; tilt?: number }
function loadPrefs(): Prefs {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs; } catch { return {}; }
}
function savePrefs(patch: Prefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
}

/** Plain-DOM settings drawer: model, input device, stick mode, rates/expo, wind, and the transmitter mapping wizard. */
export class SettingsPanel {
  private panel: HTMLElement;
  randomFailures = false;
  voiceOn = true;
  latencyMs = 20;
  private wizardState: { axis: AxisName | SwitchName; baseline: number[]; baselineButtons: boolean[] } | null = null;
  private wizardStatus: HTMLElement | null = null;
  currentModelId = HELI_MODELS[0].id;
  /** Built-in models plus the pilot's custom one when defined. */
  models: HeliModel[] = [...HELI_MODELS];
  customSpec: CustomSpec | null = null;

  /** Register (or replace) the custom model in the list. */
  setCustom(spec: CustomSpec, model: HeliModel): void {
    this.customSpec = spec;
    this.models = [...HELI_MODELS, model];
  }

  private setupHtml(): string {
    const base = this.models.find((m) => m.id === this.currentModelId) ?? HELI_MODELS[0];
    const cur = this.cb.getSetup(base.id) ?? {};
    const deg = (c: number[], i: number) => c[i];
    const modes = ['Normal', 'Idle-Up 1', 'Idle-Up 2'];
    const rpm = (w: number) => Math.round((w * 60) / (2 * Math.PI));
    const row = (label: string, id: string, min: number, max: number, step: number, value: number, unit = '') =>
      `<label class="setup-row"><span>${label}</span><input type="range" data-setup="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><b data-setup-v="${id}">${value}${unit}</b></label>`;
    return `
      <p class="hint">Changes apply at once and are saved for this helicopter (and to your account when signed in).</p>
      ${modes.map((name, i) => {
        const p = cur.pitch?.[i] ?? [deg(base.pitchCurves[i], 0), deg(base.pitchCurves[i], 2), deg(base.pitchCurves[i], 4)];
        const hs = cur.headspeedPct?.[i] ?? 100;
        return `<h5>${name}</h5>
          ${row('Pitch low', `p${i}l`, -14, 4, 0.5, p[0], '°')}
          ${row('Pitch centre', `p${i}m`, -6, 8, 0.5, p[1], '°')}
          ${row('Pitch high', `p${i}h`, 4, 15, 0.5, p[2], '°')}
          ${row(`Head speed (${rpm(base.headspeeds[i])} rpm default)`, `h${i}`, 70, 115, 1, hs, '%')}`;
      }).join('')}
      <h5>Gyro / rates</h5>
      ${row('Tail gyro gain', 'gyro', 50, 400, 5, cur.gyroGainPct ?? 100, '%')}
      ${row('Cyclic rate', 'crate', 50, 130, 5, cur.cyclicRatePct ?? 100, '%')}
      <label class="setup-row"><span>Tail gyro mode</span><select data-setup="gmode">
        <option value="hh" ${(cur.gyroMode ?? 'hh') === 'hh' ? 'selected' : ''}>Heading hold</option>
        <option value="rate" ${cur.gyroMode === 'rate' ? 'selected' : ''}>Rate (old-school: tail drifts with torque)</option></select></label>
      <h5>ESC</h5>
      <label class="setup-row"><span>Governor</span><select data-setup="gov">
        <option value="on" ${cur.governor !== false ? 'selected' : ''}>On (holds head speed)</option>
        <option value="off" ${cur.governor === false ? 'selected' : ''}>Off (throttle curve, head speed droops)</option></select></label>
      ${row('Idle-Up throttle (governor off)', 'thr', 60, 100, 1, cur.idleUpThrottlePct ?? 90, '%')}
      <h5>Paint</h5>
      <label class="setup-row"><span>Canopy colour</span><input type="color" data-setup="color" value="${cur.color ?? base.color ?? (base.rotor.radius > 0.6 ? '#1f5fd6' : base.rotor.radius < 0.3 ? '#f2b705' : '#d8262a')}"></label>
      <label class="setup-row"><span>Scheme</span><select data-setup="scheme">
        ${(['solid', 'stripes', 'flames', 'checker'] as const).map((k) => `<option value="${k}" ${(cur.scheme ?? 'solid') === k ? 'selected' : ''}>${{ solid: 'Solid', stripes: 'Stripes', flames: 'Flames', checker: 'Checker' }[k]}</option>`).join('')}</select></label>
      ${base.power === 'nitro' ? `<h5>Engine</h5>${row('Needle (mixture): 100 right, lower is lean', 'needle', 80, 130, 1, cur.needlePct ?? 100, '%')}<p class="hint">Lean: a few percent more power, runs hot, and quits if you keep it loaded. Rich: soft, safe, thirsty.</p>` : ''}
      <button id="setup-reset">Reset to factory</button>`;
  }

  private customHtml(): string {
    const c = this.customSpec ?? DEFAULT_CUSTOM;
    const num = (id: string, label: string, value: number, min: number, max: number, step = 1) =>
      `<label class="setup-row"><span>${label}</span><input type="number" data-custom="${id}" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
    return `
      <p class="hint">Type the numbers from the box and your radio; everything else (inertia, rotor, tail, motor, drag) is
      scaled between the 450 and the 700 references. Then pick it in the Model list above.</p>
      <label class="setup-row"><span>Name</span><input type="text" data-custom="name" value="${c.name.replace(/"/g, '&quot;')}" maxlength="40"></label>
      ${num('bladeMm', 'Main blade length (mm)', c.bladeMm, 150, 900)}
      ${num('massG', 'All-up weight (g)', c.massG, 100, 9000, 10)}
      ${num('cells', 'Battery cells (S)', c.cells, 1, 14)}
      ${num('mah', 'Battery capacity (mAh)', c.mah, 100, 20000, 100)}
      ${num('hs0', 'Head speed Normal (rpm)', c.headspeedRpm[0], 600, 4500, 50)}
      ${num('hs1', 'Head speed Idle-Up 1 (rpm)', c.headspeedRpm[1], 600, 4500, 50)}
      ${num('hs2', 'Head speed Idle-Up 2 (rpm)', c.headspeedRpm[2], 600, 4500, 50)}
      <label><input type="checkbox" data-custom="flybar" ${c.flybar ? 'checked' : ''}> Mechanical flybar head</label>
      <label class="setup-row"><span>Power plant</span><select data-custom="power"><option value="electric" ${(c.power ?? 'electric') === 'electric' ? 'selected' : ''}>Electric</option><option value="nitro" ${c.power === 'nitro' ? 'selected' : ''}>Nitro (glow engine, clutch, fuel tank)</option></select></label>
      ${num('tankMl', 'Fuel tank (ml, nitro)', c.tankMl ?? 300, 50, 2000, 10)}
      <label class="setup-row"><span>Canopy colour</span><input type="color" data-custom="color" value="${c.color ?? '#2a8f4a'}"></label>
      <label class="setup-row"><span>Main blades</span><select data-custom="blades"><option value="2" ${(c.blades ?? 2) === 2 ? 'selected' : ''}>2</option><option value="3" ${c.blades === 3 ? 'selected' : ''}>3</option></select></label>
      <button id="custom-fly">Build it and fly it</button>`;
  }

  private readCustom(): CustomSpec {
    const g = (id: string) => (this.panel.querySelector(`[data-custom="${id}"]`) as HTMLInputElement).value;
    return normalizeSpec({
      name: g('name'),
      bladeMm: Number(g('bladeMm')),
      massG: Number(g('massG')),
      cells: Number(g('cells')),
      mah: Number(g('mah')),
      headspeedRpm: [Number(g('hs0')), Number(g('hs1')), Number(g('hs2'))],
      flybar: (this.panel.querySelector('[data-custom="flybar"]') as HTMLInputElement).checked,
      blades: Number((this.panel.querySelector('[data-custom="blades"]') as HTMLSelectElement).value) === 3 ? 3 : 2,
      power: (this.panel.querySelector('[data-custom="power"]') as HTMLSelectElement).value === 'nitro' ? 'nitro' : 'electric',
      tankMl: Number(g('tankMl')),
      color: g('color'),
    });
  }

  private readSetup(): ModelSetup {
    const g = (id: string) => Number((this.panel.querySelector(`[data-setup="${id}"]`) as HTMLInputElement).value);
    return {
      pitch: [0, 1, 2].map((i) => [g(`p${i}l`), g(`p${i}m`), g(`p${i}h`)] as [number, number, number]),
      headspeedPct: [0, 1, 2].map((i) => g(`h${i}`)),
      gyroGainPct: g('gyro'),
      cyclicRatePct: g('crate'),
      gyroMode: (this.panel.querySelector('[data-setup="gmode"]') as HTMLSelectElement).value === 'rate' ? 'rate' : 'hh',
      governor: (this.panel.querySelector('[data-setup="gov"]') as HTMLSelectElement).value !== 'off',
      idleUpThrottlePct: g('thr'),
      ...(this.panel.querySelector('[data-setup="needle"]') ? { needlePct: g('needle') } : {}),
      color: (this.panel.querySelector('[data-setup="color"]') as HTMLInputElement).value,
      scheme: (this.panel.querySelector('[data-setup="scheme"]') as HTMLSelectElement).value as ModelSetup['scheme'],
    };
  }

  private bindSetup(): void {
    for (const el of this.panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setup]')) {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        const v = this.panel.querySelector(`[data-setup-v="${el.dataset.setup}"]`);
        if (v) v.textContent = el.value + (el.dataset.setup?.startsWith('p') ? '°' : '%');
        this.cb.onSetup(this.currentModelId, this.readSetup());
      });
    }
    this.panel.querySelector('#custom-fly')?.addEventListener('click', () => {
      const spec = this.readCustom();
      const model = this.cb.onCustom(spec);
      this.setCustom(spec, model);
      this.currentModelId = model.id;
      this.cb.onModel(model);
      savePrefs({ custom: spec, model: model.id });
      this.render();
    });
    this.panel.querySelector('#setup-reset')?.addEventListener('click', () => {
      this.cb.onSetup(this.currentModelId, {});
      this.render();
    });
  }
  private axisBars: HTMLElement | null = null;
  private calibrating: { min: number[]; max: number[] } | null = null;

  constructor(container: HTMLElement, private input: InputManager, private wind: Wind, private audio: AudioEngine, private cb: SettingsCallbacks) {
    const bar = document.createElement('div');
    bar.className = 'topbar';
    bar.innerHTML = `
      <button id="btn-hide" data-tip="Show / hide the controls (U). Long-press any icon for help." title="Show / hide controls (U)">👁</button>
      <button id="btn-pause" data-tip="Pause / resume the simulation (P)" title="Pause (P)">⏸</button>
      <button id="btn-reset" data-tip="Reset the helicopter to the pad (R). Shift+R resets into a hover at 6 m for 3D drills." title="Reset (R)">↺</button>
      <button id="btn-mode" data-tip="Flight mode (1 / 2 / 3): Normal, Idle-Up 1, Idle-Up 2. Idle-Up = fixed head speed and negative pitch for inverted flight." title="Flight mode (1/2/3)">🔀 N</button>
      <button id="btn-hold" data-tip="Throttle hold (H): motor off, rotor freewheels. Autorotation practice or a safety." title="Throttle hold (H)">✋</button>
      <button id="btn-rescue" data-tip="Rescue (hold Space): the instructor takes the sticks, levels the heli and holds a hover until you let go. A buddy box." title="Rescue (hold Space)">🛟</button>
      <button id="btn-sound" data-tip="Sound on / off (M)" title="Sound (M)">🔊</button>
      <button id="btn-camera" data-tip="Camera (C): Pilot on the field, Chase, Front, Top, Drone" title="Camera (C)">🎥 Pilot</button>
      <button id="btn-hangar" data-tip="Hangar (K): every part of your helicopter, named, with what it does, how it breaks and what to know when you buy a spare. Move the sticks to bench-test the swashplate." title="Hangar: parts (K)">🔧</button>
      <button id="btn-challenges" data-tip="Challenges, Show me / Teach me lessons, rankings" title="Challenges & rankings">🏁</button>
      <button id="btn-pilot" data-tip="Your callsign and email sign-in (syncs progress across devices)" title="Pilot">👤</button>
      <button id="btn-recentre" data-tip="Recentre the phone-tilt neutral position" title="Recentre phone tilt" style="display:none">🎯</button>
      <button id="btn-help" data-tip="How to fly: controls, modes, challenges, learning path (?)" title="Help (?)">❓</button>
      <button id="btn-full" data-tip="Fullscreen and landscape (F)" title="Fullscreen (F)">⛶</button>
      <button id="btn-settings" data-tip="Settings: helicopter, input device, transmitter mapping, assist, camera, sound, wind" title="Settings">⚙</button>`;
    container.appendChild(bar);
    this.panel = document.createElement('div');
    this.panel.className = 'settings';
    this.panel.style.display = 'none';
    container.appendChild(this.panel);

    bar.querySelector('#btn-reset')!.addEventListener('click', () => cb.onReset());
    bar.querySelector('#btn-settings')!.addEventListener('click', () => this.toggle());
    const setHidden = (hidden: boolean) => {
      document.body.classList.toggle('ui-hidden', hidden);
      (bar.querySelector('#btn-hide') as HTMLElement).classList.toggle('active', hidden);
      if (hidden) this.panel.style.display = 'none';
    };
    bar.querySelector('#btn-hide')!.addEventListener('click', () => setHidden(!document.body.classList.contains('ui-hidden')));
    bar.querySelector('#btn-pause')!.addEventListener('click', () => cb.onPause());
    attachTips(bar);
    bar.querySelector('#btn-help')!.addEventListener('click', () => cb.onHelp());
    bar.querySelector('#btn-challenges')!.addEventListener('click', () => cb.onChallenges());
    bar.querySelector('#btn-hangar')!.addEventListener('click', () => cb.onHangar());
    bar.querySelector('#btn-pilot')!.addEventListener('click', () => cb.onPilot());
    bar.querySelector('#btn-camera')!.addEventListener('click', () => this.cycleCamera());
    // The button row wraps on phones; let the HUD and panels sit below whatever height it ends up with.
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${bar.offsetHeight}px`));
    ro.observe(bar);
    bar.querySelector('#btn-recentre')!.addEventListener('click', () => input.motion.recentre());
    {
      const b = bar.querySelector('#btn-rescue') as HTMLButtonElement;
      const down = (e: Event) => { e.preventDefault(); b.classList.add('active'); cb.onRescue(true); };
      const up = () => { b.classList.remove('active'); cb.onRescue(false); };
      b.addEventListener('pointerdown', down);
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, up);
    }
    bar.querySelector('#btn-full')!.addEventListener('click', () => void toggleFullscreen());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyU') setHidden(!document.body.classList.contains('ui-hidden'));
      if (e.code === 'KeyG') cb.onPilotSpot('heli');
      if (e.code === 'KeyF') void toggleFullscreen();
    });
    const soundBtn = bar.querySelector('#btn-sound') as HTMLButtonElement;
    const toggleSound = () => {
      audio.setMuted(!audio.muted);
      savePrefs({ muted: audio.muted });
      soundBtn.textContent = audio.muted ? '🔇' : '🔊';
      soundBtn.classList.toggle('active', audio.muted);
    };
    soundBtn.addEventListener('click', toggleSound);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') toggleSound();
    });
    // Only ask for the change; reflect() repaints the labels from the real control frame next tick.
    bar.querySelector('#btn-mode')!.addEventListener('click', () => cb.onFlightMode(((this.flightMode + 1) % 3) as 0 | 1 | 2));
    bar.querySelector('#btn-hold')!.addEventListener('click', () => cb.onThrottleHold(!this.hold));
    this.bar = bar;
    this.render();
  }

  private bar: HTMLElement;
  flightMode: 0 | 1 | 2 = -1 as unknown as 0 | 1 | 2; // forces the first reflect() to paint
  hold = false;
  assist: AssistMode = 'rate';

  /** The level preset the settings match right now, or 'custom'. Wind is ignored indoors (it is always 0 there). */
  get level(): SimLevel | 'custom' {
    const im = this.input;
    const gym = getSite() === 'gym';
    const cur = { assist: this.assist, expo: im.shaping.aileron.expo, rate: im.shaping.aileron.rate, rexpo: im.shaping.rudder.expo, wind: this.wind.speed, gust: this.wind.gustiness, randomFailures: this.randomFailures };
    if (gym) for (const l of SIM_LEVELS) if (presetOf({ ...cur, wind: LEVEL_PRESETS[l].wind, gust: LEVEL_PRESETS[l].gust }) === l) return l;
    return presetOf(cur);
  }

  /** Apply a level preset: assist, rates and expo, wind and random failures, all saved like manual changes. */
  applyLevel(level: SimLevel): void {
    const p = LEVEL_PRESETS[level];
    const im = this.input;
    im.shaping.aileron.expo = p.expo; im.shaping.elevator.expo = p.expo;
    im.shaping.aileron.rate = p.rate; im.shaping.elevator.rate = p.rate;
    im.shaping.rudder.expo = p.rexpo;
    if (getSite() !== 'gym') { this.wind.speed = p.wind; this.wind.gustiness = p.gust; }
    this.randomFailures = p.randomFailures;
    this.cb.onRandomFailures(p.randomFailures);
    savePrefs({ expo: p.expo, rate: p.rate, rexpo: p.rexpo, wind: p.wind, gust: p.gust, randomFailures: p.randomFailures });
    this.setAssist(p.assist);
    this.render();
  }

  /** Repaint the level picker and its board line after any setting it depends on changed. */
  refreshLevel(): void {
    const sel = this.panel.querySelector('#level') as HTMLSelectElement | null;
    if (sel) sel.value = this.level;
    const hint = this.panel.querySelector('#level-hint');
    if (hint) hint.innerHTML = this.levelHint();
  }

  private levelHint(): string {
    const l = this.level;
    const board = this.cb.boardLevel();
    const what = l === 'custom' ? t('Custom: you changed a setting the presets set.') : t(LEVEL_SUMMARY[l]);
    const gym = getSite() === 'gym' ? ` ${t('Indoors there is no wind, so the Pro board needs an outdoor site.')}` : '';
    return `${what} ${t('Your flights count on the {badge} {level} board.', { badge: LEVEL_BADGE[board], level: t(LEVEL_LABEL[board]) })}${gym}`;
  }

  /** Re-apply what the pilot set last time (model, input, assist, camera, wind, sound...). Call once after wiring. */
  /** True when nothing was ever saved on this device: show the welcome card once. */
  firstVisit = false;

  markVersionSeen(v: string): void {
    savePrefs({ seenVersion: v });
  }

  markWelcomed(): void {
    this.firstVisit = false;
    savePrefs({ welcomed: true });
  }

  restore(): void {
    const p = loadPrefs();
    this.firstVisit = !p.welcomed && Object.keys(p).length === 0;
    const im = this.input;
    if (p.custom) {
      const spec = normalizeSpec(p.custom);
      this.setCustom(spec, this.cb.onCustom(spec));
    }
    if (p.model) {
      const m = this.models.find((x) => x.id === p.model);
      if (m) { this.currentModelId = m.id; this.cb.onModel(m); }
    }
    if (p.source && p.source !== 'motion') im.choice = p.source as SourceChoice; // motion needs a permission tap
    if (p.randomFailures) { this.randomFailures = true; this.cb.onRandomFailures(true); }
    if (p.voice === false) { this.voiceOn = false; this.cb.onVoice(false); }
    if (typeof p.latency === 'number') { this.latencyMs = p.latency; }
    this.cb.onLatency(this.latencyMs);
    if (p.stickMode) im.touch.setMode(p.stickMode as StickMode);
    if (p.expo !== undefined) { im.shaping.aileron.expo = p.expo; im.shaping.elevator.expo = p.expo; }
    if (p.rate !== undefined) { im.shaping.aileron.rate = p.rate; im.shaping.elevator.rate = p.rate; }
    if (p.rexpo !== undefined) im.shaping.rudder.expo = p.rexpo;
    if (p.nrate !== undefined) im.normalRate = p.nrate;
    if (p.tilt !== undefined) im.motion.maxTiltDeg = p.tilt;
    if (p.assist === 'rate' || p.assist === 'attitude') this.setAssist(p.assist);
    if (p.camera && (CAMERA_MODES as string[]).includes(p.camera)) this.setCamera(p.camera as CameraMode);
    if (p.spot) { this.spot = p.spot; this.cb.onPilotSpot(p.spot); }
    if (p.arrow !== undefined) { this.arrowOn = p.arrow; this.cb.onArrow(p.arrow); }
    if (p.trail) this.setTrail(true);
    if (p.graph) this.setGraph(true);
    if (p.minimap) this.setMinimap(true);
    if (p.tod === 'morning' || p.tod === 'evening') { this.tod = p.tod; this.cb.onTimeOfDay(p.tod); }
    if (p.gear) { this.gearOn = true; this.cb.onTrainingGear(true); }
    if (p.wind !== undefined && getSite() !== 'gym') this.wind.speed = p.wind;
    if (p.windDir !== undefined) this.wind.fromDeg = p.windDir;
    if (p.gust !== undefined) this.wind.gustiness = p.gust;
    if (p.volume !== undefined) this.audio.setVolume(p.volume);
    if (p.muted) { this.audio.setMuted(true); const b = this.bar.querySelector('#btn-sound') as HTMLElement; b.textContent = '🔇'; b.classList.add('active'); }
    this.render();
  }

  /** Keep the top bar in sync with whatever the active source says. */
  reflect(mode: 0 | 1 | 2, hold: boolean): void {
    if (mode !== this.flightMode || hold !== this.hold) {
      this.flightMode = mode;
      this.hold = hold;
      const modeBtn = this.bar.querySelector('#btn-mode') as HTMLElement;
      const holdBtn = this.bar.querySelector('#btn-hold') as HTMLElement;
      modeBtn.textContent = `🔀 ${['N', 'ID1', 'ID2'][mode]}`;
      modeBtn.title = MODE_HELP[mode];
      modeBtn.dataset.tip = MODE_HELP[mode] + ' Tap to cycle (keys 1/2/3).';
      holdBtn.textContent = hold ? '✋ HOLD' : '✋';
      holdBtn.title = hold ? HOLD_HELP.on : HOLD_HELP.off;
      holdBtn.dataset.tip = (hold ? HOLD_HELP.on : HOLD_HELP.off) + ' Tap to toggle (H).';
      holdBtn.classList.toggle('active', hold);
      modeBtn.classList.toggle('active', mode > 0);
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
      <label>Language ${sel('lang', [['en', 'English'], ['pt-BR', 'Português (Brasil)']], getLang())}</label>
      <label>Flying site ${sel('site', [['field', 'The field (default)'], ['gym', 'Indoor gym (micro-sized hall, no wind)'], ['lot', 'Parking lot (asphalt, poles, cars, a container to land on)'], ['hill', 'Hillside (a 10° slope and a 20° bank to land on; wind that climbs the hill)']], getSite())}</label>
      <section>
        <h4>Pilot level</h4>
        <label>Level ${sel('level', [...SIM_LEVELS.map((l): [string, string] => [l, `${LEVEL_BADGE[l]} ${t(LEVEL_LABEL[l])}`]), ['custom', t('Custom')]], this.level)}</label>
        <p class="hint" id="level-hint">${this.levelHint()}</p>
        <p class="hint">A level only sets the assist, rates, wind and failures below; the physics are the same. Rankings use what you actually flew with, so changing a setting moves your flights to the board it qualifies for.</p>
      </section>
      <p class="hint">v${__VERSION__} · build <code>${__COMMIT__}</code> (${__BUILD__.split(' ').slice(1).join(' ')}) · <a href="https://github.com/filipenevola/rc-heli-sim/blob/main/CHANGELOG.md" target="_blank" rel="noopener">Release log</a></p>
      <section>
        <h4>Helicopter</h4>
        ${sel('model', this.models.map((m) => [m.id, m.name]), this.currentModelId)}
        <label><input type="checkbox" id="gear" ${this.gearOn ? 'checked' : ''}> Training gear (cross of rods with balls: nearly tip-proof, a bit heavier and slower)</label>
        <details class="setup"><summary>My helicopter (custom)</summary>${this.customHtml()}</details>
        <details class="setup"><summary>Model setup (pitch curves, head speed, gyro) — like your radio's model memory</summary>
          ${this.setupHtml()}
        </details>
      </section>
      <section>
        <h4>Input</h4>
        ${sel('source', [['auto', 'Auto (last used)'], ['gamepad', 'Transmitter (USB dongle)'], ['touch', 'Touch sticks'], ['motion', 'Phone tilt + touch throttle'], ['remote', 'Phone radio (paired phone)'], ['keyboard', 'Keyboard']], im.choice)}
        <div id="source-status" class="hint"></div>
        <div class="wizard"><button id="radio-pair">📻 Pair a phone</button><button id="radio-unpair">Disconnect phone</button></div>
        <div id="radio-status" class="hint">Phone radio: fly this screen with a phone as the transmitter. Press Pair, then open <b>${location.origin}/radio.html</b> on the phone and type the code. On the same Wi-Fi the sticks arrive in a few milliseconds.</div>
        <label>Assist ${sel('assist', [['rate', 'Rate — real helicopter behaviour'], ['attitude', 'Attitude — stick sets bank angle, self-levels']], this.assist)}</label>
        ${slider('tilt', 'Phone tilt for full stick (°)', 10, 45, 1, im.motion.maxTiltDeg)}
        <label>Touch stick mode ${sel('stickmode', [['1', 'Mode 1'], ['2', 'Mode 2'], ['3', 'Mode 3'], ['4', 'Mode 4']], String(im.touch.mode))}</label>
        ${slider('expo', 'Cyclic expo', 0, 0.8, 0.05, im.shaping.aileron.expo)}
        ${slider('rate', 'Cyclic dual rate', 0.3, 1, 0.05, im.shaping.aileron.rate)}
        ${slider('nrate', 'Normal-mode rate (dual rate on the mode switch)', 0.4, 1, 0.05, im.normalRate)}
        ${slider('rexpo', 'Rudder expo', 0, 0.8, 0.05, im.shaping.rudder.expo)}
        ${slider('latency', 'Radio link latency (ms): what a real 2.4 GHz link and receiver add', 0, 80, 5, this.latencyMs)}
        <p class="hint">Keyboard: arrows = cyclic, W/S = collective, A/D = rudder, 1/2/3 flight mode, H throttle hold, R reset, P pause.</p>
      </section>
      <section>
        <h4>Transmitter mapping</h4>
        <div id="pad-status">${g.available() ? `Connected: <code>${g.padId || '(move a stick)'}</code>` : 'No USB transmitter detected. Plug in the dongle and move a stick.'}</div>
        <div id="channels"></div>
        <p class="hint">Reverse flips a channel. Centre: hold the stick at rest and press to store its neutral (sub-trim). Travel widens by itself when you push past the stored range. Everything here is saved on this device and, when signed in, to your account.</p>
        <div id="axis-bars"></div>
        <div class="wizard">
          ${AXES.map((a) => `<button data-assign="${a}">Assign ${a}</button>`).join('')}
          ${SWITCHES.map(([k, l]) => `<button data-assign="${k}">Assign ${l}</button>`).join('')}
          <button id="clear-switches">Clear switches</button>
          <button id="calibrate">Calibrate travel</button>
          <button id="save-mapping">Save</button>
          <button id="radio-report" title="Samples your radio for 10 s and sends the axis/button data so a built-in mapping can be made for it">Send radio report</button>
        </div>
        <div id="wizard-status" class="hint"></div>
      </section>
      <section>
        <h4>Camera</h4>
        ${sel('camera', CAMERA_MODES.map((m) => [m, CAMERA_LABELS[m]]), this.cameraMode)}
        <p class="hint">Cam button or C key cycles. "Pilot" is the realistic one: you stand on the field.</p>
        <label>Pilot stands at ${sel('spot', getSite() === 'gym' ? [['pad', 'The helipad (default)'], ['bleachers', 'On the bleachers'], ['end', 'At the far end']] : getSite() === 'lot' ? [['pad', 'The helipad (default)'], ['cars', 'By the parked cars'], ['container', 'By the container'], ['fence', 'At the fence']] : getSite() === 'hill' ? [['pad', 'The helipad (default)'], ['slope', 'On the slope mark'], ['bank', 'On the bank mark'], ['fence', 'At the fence line']] : [['pad', 'The helipad (default)'], ['barn', 'By the barn'], ['pond', 'By the pond'], ['tower', 'By the tower'], ['road', 'On the road']], this.spot)}</label>
        <button id="walk">Walk to the heli (G)</button>
        <label><input type="checkbox" id="arrow" ${this.arrowOn ? 'checked' : ''}> Orientation arrow under the heli (beginner aid)</label>
        <label><input type="checkbox" id="trail" ${this.trailOn ? 'checked' : ''}> Smoke trail: fading path of the last 12 s (T)</label>
        <label><input type="checkbox" id="graph" ${this.graphOn ? 'checked' : ''}> Telemetry graph: head speed, collective, altitude and G over the last 30 s (Y)</label>
        <label><input type="checkbox" id="minimap" ${this.minimapOn ? 'checked' : ''}> Minimap: top-down view with the model's nose, targets, obstacles and wind (N)</label>
      </section>
      <section>
        <label>Load a saved flight (.json) <input type="file" id="load-flight" accept="application/json,.json"></label>
        <p class="hint">Save flight on the debrief card writes the file; load it here, on any machine, to watch it with the sticks shown.</p>
        <label>Load a flight as a ghost (.json) <input type="file" id="load-ghost" accept="application/json,.json"></label>
        <p class="hint">The ghost flies the saved flight on a loop while you fly: match your own best hover, or an instructor's. <button id="clear-ghost" class="inline">Stop ghost</button></p>
        <h4>Sound</h4>
        ${slider('volume', 'Volume', 0, 1, 0.05, this.audio.volume)}
        <label><input type="checkbox" id="voice" ${this.voiceOn ? 'checked' : ''}> Spoken captions: the instructor reads lesson steps and emergencies aloud</label>
      </section>
      <section>
        ${getSite() === 'gym' ? '' : `<label>Time of day ${sel('tod', [['morning', 'Morning'], ['noon', 'Noon (default)'], ['evening', 'Evening: low sun, long shadows, a dark silhouette']], this.tod)}</label>`}
        <label>Graphics ${sel('quality', [['high', 'High: lake reflections, dense grass, bloom'], ['low', 'Low: phones and older laptops (reloads)']], this.cb.getQuality())}</label>
        <h4>Emergencies</h4>
        <div class="wizard"><button id="fail-tail">Tail rotor failure now</button></div>
        <label><input type="checkbox" id="random-failures" ${this.randomFailures ? 'checked' : ''}> Random tail failure: once per flight, somewhere above 15 m</label>
        <p class="hint">The fix is always the same: throttle hold at once, then autorotate. Counts for the Tail rotor failure challenge.</p>
        <h4>Wind</h4>${getSite() === 'gym' ? '<p class="hint">No wind indoors: the sliders are ignored in the gym.</p>' : ''}
        ${slider('wind', 'Speed (m/s)', 0, 10, 0.5, this.wind.speed)}
        ${slider('winddir', 'From (°)', 0, 359, 5, this.wind.fromDeg)}
        ${slider('gust', 'Gustiness', 0, 1, 0.1, this.wind.gustiness)}
      </section>`;

    const q = <T extends HTMLElement>(s: string) => this.panel.querySelector(s) as T;
    q('#close').addEventListener('click', () => this.toggle());
    q<HTMLSelectElement>('#site').addEventListener('change', (e) => {
      savePrefs({ site: (e.target as HTMLSelectElement).value as SiteId });
      location.reload();
    });
    q<HTMLSelectElement>('#lang').addEventListener('change', (e) => {
      const lang = (e.target as HTMLSelectElement).value as Lang;
      savePrefs({ lang });
      setLang(lang);
      this.render();
    });
    q<HTMLSelectElement>('#model').addEventListener('change', (e) => {
      const m = this.models.find((x) => x.id === (e.target as HTMLSelectElement).value)!;
      this.currentModelId = m.id;
      this.cb.onModel(m);
      savePrefs({ model: m.id });
      this.render();
    });
    this.bindSetup();
    q<HTMLInputElement>('#gear').addEventListener('change', (e) => {
      this.gearOn = (e.target as HTMLInputElement).checked;
      this.cb.onTrainingGear(this.gearOn);
      savePrefs({ gear: this.gearOn });
      this.refreshLevel();
    });
    q<HTMLSelectElement>('#source').addEventListener('change', (e) => {
      const choice = (e.target as HTMLSelectElement).value as SourceChoice;
      const status = q('#source-status');
      savePrefs({ source: choice });
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
    q<HTMLSelectElement>('#level').addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      if (v === 'custom') this.refreshLevel(); // nothing to apply: Custom is whatever the sliders say
      else this.applyLevel(v as SimLevel);
    });
    q('#fail-tail').addEventListener('click', () => { this.cb.onFailTail(); this.toggle(); });
    q<HTMLInputElement>('#latency').addEventListener('input', (e) => {
      this.latencyMs = Number((e.target as HTMLInputElement).value);
      q('#latency-v').textContent = String(this.latencyMs);
      savePrefs({ latency: this.latencyMs });
      this.cb.onLatency(this.latencyMs);
    });
    q<HTMLInputElement>('#voice').addEventListener('change', (e) => {
      this.voiceOn = (e.target as HTMLInputElement).checked;
      savePrefs({ voice: this.voiceOn });
      this.cb.onVoice(this.voiceOn);
    });
    q<HTMLInputElement>('#random-failures').addEventListener('change', (e) => {
      this.randomFailures = (e.target as HTMLInputElement).checked;
      savePrefs({ randomFailures: this.randomFailures });
      this.cb.onRandomFailures(this.randomFailures);
      this.refreshLevel();
    });
    {
      const status = q('#radio-status');
      const show = (html: string) => { status.innerHTML = html; };
      im.remote.onState = (s, code) => {
        const url = `${location.origin}/radio.html?c=${code}`;
        if (s === 'waiting') show(`${t('Code')}: <b class="radio-code">${code}</b><br>${t('On the phone open')} <b>${url}</b> ${t('(or /radio.html and type the code). Waiting for the phone…')}<div class="radio-qr" title="${t('Scan with the phone camera')}">${qrSvg(url, 150)}</div>`);
        else if (s === 'connecting') show(`<b>${code}</b> · ${t('Phone found, connecting…')}`);
        else if (s === 'connected') show(`<b>${code}</b> · <b>${t('Phone connected.')}</b> ${t('Move a stick on the phone and it takes over; the HUD shows "Phone radio".')}`);
        else if (s === 'failed') show(im.remote.apiBase ? `<b>${code}</b> · ${t('Phone dropped: re-offering under the same code, it reconnects by itself. Or press Pair for a new code.')}` : t('Pairing needs the online rankings server, which this build does not have.'));
        else if (s === 'closed') show(t('Phone disconnected.'));
      };
      q('#radio-pair').addEventListener('click', () => { im.remote.pair(); });
      q('#radio-unpair').addEventListener('click', () => { im.remote.unpair(); show(t('Phone disconnected.')); });
    }
    q<HTMLSelectElement>('#stickmode').addEventListener('change', (e) => { const v = Number((e.target as HTMLSelectElement).value) as StickMode; im.touch.setMode(v); savePrefs({ stickMode: v }); });
    const bind = (id: string, f: (v: number) => void) => {
      const el = q<HTMLInputElement>(`#${id}`);
      el.addEventListener('input', () => {
        q(`#${id}-v`).textContent = el.value;
        f(Number(el.value));
      });
    };
    bind('expo', (v) => { im.shaping.aileron.expo = v; im.shaping.elevator.expo = v; savePrefs({ expo: v }); this.refreshLevel(); });
    bind('rate', (v) => { im.shaping.aileron.rate = v; im.shaping.elevator.rate = v; savePrefs({ rate: v }); this.refreshLevel(); });
    bind('nrate', (v) => { im.normalRate = v; savePrefs({ nrate: v }); });
    bind('rexpo', (v) => { im.shaping.rudder.expo = v; savePrefs({ rexpo: v }); this.refreshLevel(); });
    bind('tilt', (v) => (im.motion.maxTiltDeg = v));
    q<HTMLSelectElement>('#spot').addEventListener('change', (e) => {
      this.spot = (e.target as HTMLSelectElement).value;
      this.cb.onPilotSpot(this.spot);
      savePrefs({ spot: this.spot });
    });
    q('#walk').addEventListener('click', () => this.cb.onPilotSpot('heli'));
    q<HTMLInputElement>('#arrow').addEventListener('change', (e) => {
      this.arrowOn = (e.target as HTMLInputElement).checked;
      this.cb.onArrow(this.arrowOn);
      savePrefs({ arrow: this.arrowOn });
    });
    this.panel.querySelector<HTMLSelectElement>('#quality')?.addEventListener('change', (e) => this.cb.onQuality((e.target as HTMLSelectElement).value as 'high' | 'low'));
    this.panel.querySelector<HTMLSelectElement>('#tod')?.addEventListener('change', (e) => {
      this.tod = (e.target as HTMLSelectElement).value as 'morning' | 'noon' | 'evening';
      this.cb.onTimeOfDay(this.tod);
      savePrefs({ tod: this.tod });
    });
    q<HTMLInputElement>('#load-flight').addEventListener('change', (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) this.cb.onLoadFlight(f, false);
      (e.target as HTMLInputElement).value = '';
      this.toggle();
    });
    q<HTMLInputElement>('#load-ghost').addEventListener('change', (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) this.cb.onLoadFlight(f, true);
      (e.target as HTMLInputElement).value = '';
      this.toggle();
    });
    q('#clear-ghost').addEventListener('click', () => this.cb.onClearGhost());
    q<HTMLInputElement>('#graph').addEventListener('change', (e) => {
      this.setGraph((e.target as HTMLInputElement).checked);
    });
    q<HTMLInputElement>('#minimap').addEventListener('change', (e) => {
      this.setMinimap((e.target as HTMLInputElement).checked);
    });
    q<HTMLInputElement>('#trail').addEventListener('change', (e) => {
      this.setTrail((e.target as HTMLInputElement).checked);
    });
    q<HTMLSelectElement>('#camera').addEventListener('change', (e) => {
      this.cameraMode = (e.target as HTMLSelectElement).value as CameraMode;
      this.applyCamera();
    });
    bind('volume', (v) => this.audio.setVolume(v));
    bind('wind', (v) => { this.wind.speed = v; savePrefs({ wind: v }); this.refreshLevel(); });
    bind('winddir', (v) => { this.wind.fromDeg = v; savePrefs({ windDir: v }); });
    bind('gust', (v) => { this.wind.gustiness = v; savePrefs({ gust: v }); this.refreshLevel(); });

    this.wizardStatus = q('#wizard-status');
    this.axisBars = q('#axis-bars');
    for (const b of this.panel.querySelectorAll<HTMLButtonElement>('[data-assign]')) {
      b.addEventListener('click', () => this.startAssign(b.dataset.assign as AxisName | SwitchName));
    }
    q('#calibrate').addEventListener('click', () => this.startCalibrate());
    q('#radio-report').addEventListener('click', () => this.startRadioReport());
    q('#clear-switches').addEventListener('click', () => {
      if (g.mapping) {
        delete g.mapping.flightModeSwitch;
        delete g.mapping.throttleHoldSwitch;
        delete g.mapping.rescueSwitch;
        delete g.mapping.flightModeAxis;
        delete g.mapping.throttleHoldButton;
        this.wizardStatus!.textContent = 'Switches cleared; flight mode and hold come from the buttons / keys again. Click Save to keep.';
      }
    });
    q('#save-mapping').addEventListener('click', () => {
      if (g.mapping) {
        saveMapping(g.mapping);
        this.onMappingChanged?.();
        this.wizardStatus!.textContent = 'Mapping saved for this transmitter (and to your account when signed in).';
      }
    });
    localizeDom(this.panel);
    localizeDom(this.bar);
  }

  private startAssign(axis: AxisName | SwitchName): void {
    const g = this.input.gamepad;
    if (!g.available()) {
      this.wizardStatus!.textContent = 'No transmitter detected.';
      return;
    }
    this.wizardState = { axis, baseline: [...g.rawAxes], baselineButtons: [...g.rawButtons] };
    this.wizardStatus!.textContent = `Now ${AXIS_HINT[axis]} and hold it...`;
  }

  private report: { until: number; samples: number[][]; buttons: number[]; id: string } | null = null;
  onRadioReport: ((report: unknown) => Promise<unknown>) | null = null;

  private startRadioReport(): void {
    const g = this.input.gamepad;
    if (!g.available()) {
      // Still send what the browser says, so the problem can be diagnosed remotely.
      const payload = { id: '(none detected)', pads: g.dump(), events: g.events, ua: navigator.userAgent, secure: window.isSecureContext, hasApi: !!navigator.getGamepads };
      this.wizardStatus!.textContent = 'No transmitter detected by the browser; sending a diagnostic report anyway…';
      void this.onRadioReport?.(payload).then(() => (this.wizardStatus!.textContent = 'Diagnostic report sent. Tip: press a button or move a stick, then try again; browsers only list a gamepad after it is used.')).catch((e) => (this.wizardStatus!.textContent = `Could not send: ${(e as Error).message}`));
      return;
    }
    this.report = { until: performance.now() + 10000, samples: [], buttons: g.rawButtons.map(() => 0), id: g.padId };
    this.wizardStatus!.textContent = 'Recording 10 s: move every stick to all corners, then flip every switch...';
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

  cameraMode: CameraMode = 'pilot';
  spot = 'pad';
  arrowOn = true;
  trailOn = false;
  graphOn = false;
  minimapOn = false;
  tod: 'morning' | 'noon' | 'evening' = 'noon';
  gearOn = false;

  /** Telemetry graph on/off (settings checkbox, Y key); persisted. */
  setGraph(on: boolean): void {
    this.graphOn = on;
    this.cb.onGraph(on);
    const box = this.panel.querySelector<HTMLInputElement>('#graph');
    if (box) box.checked = on;
    savePrefs({ graph: on });
  }

  /** Minimap on/off (settings checkbox, N key); persisted. */
  setMinimap(on: boolean): void {
    this.minimapOn = on;
    this.cb.onMinimap(on);
    const box = this.panel.querySelector<HTMLInputElement>('#minimap');
    if (box) box.checked = on;
    savePrefs({ minimap: on });
  }

  /** Smoke trail on/off (settings checkbox, T key); persisted. */
  setTrail(on: boolean): void {
    this.trailOn = on;
    this.cb.onTrail(on);
    const box = this.panel.querySelector<HTMLInputElement>('#trail');
    if (box) box.checked = on;
    savePrefs({ trail: on });
  }

  setCamera(mode: CameraMode): void {
    this.cameraMode = mode;
    this.applyCamera();
  }

  cycleCamera(): void {
    this.cameraMode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.cameraMode) + 1) % CAMERA_MODES.length];
    this.applyCamera();
  }

  private applyCamera(): void {
    savePrefs({ camera: this.cameraMode });
    const label = this.cb.onCamera(this.cameraMode);
    (this.bar.querySelector('#btn-camera') as HTMLElement).textContent = `🎥 ${t({ pilot: 'Pilot', chase: 'Chase', front: 'Front', top: 'Top', drone: 'Drone' }[this.cameraMode])}`;
    void label;
    const sel = this.panel.querySelector('#camera') as HTMLSelectElement | null;
    if (sel) sel.value = this.cameraMode;
  }

  setPaused(paused: boolean): void {
    const b = this.bar.querySelector('#btn-pause') as HTMLElement;
    b.textContent = paused ? '▶' : '⏸';
    b.classList.toggle('active', paused);
    b.title = paused ? 'Resume (P)' : 'Pause (P)';
  }

  setPilotLabel(name: string, verified: boolean): void {
    (this.bar.querySelector('#btn-pilot') as HTMLElement).textContent = `👤 ${name.length > 12 ? name.slice(0, 11) + '…' : name}${verified ? ' ✔' : ''}`;
  }

  setAssist(mode: AssistMode): void {
    this.assist = mode;
    savePrefs({ assist: mode });
    const sel = this.panel.querySelector('#assist') as HTMLSelectElement | null;
    if (sel) sel.value = mode;
    this.cb.onAssist(mode);
    this.refreshLevel();
  }

  private updateRecentre(): void {
    (this.bar.querySelector('#btn-recentre') as HTMLElement).style.display = this.input.choice === 'motion' ? '' : 'none';
  }

  /** Fired after any mapping change the player asked for (reverse, centre, assign, save), so the host can sync it. */
  onMappingChanged: (() => void) | null = null;
  private channelsBuiltFor = '';

  private buildChannels(): void {
    const g = this.input.gamepad;
    const m = g.mapping;
    const host = this.panel.querySelector('#channels') as HTMLElement | null;
    if (!host || !m) return;
    const known = builtinName(g.padId);
    host.innerHTML = `${known ? `<p class="hint">Built-in profile: <b>${known}</b></p>` : ''}<table class="channels">
      <tr><th>Channel</th><th>Axis</th><th>Reverse</th><th>Centre</th><th>Now</th></tr>
      ${AXES.map((a) => `<tr data-ch="${a}"><td>${a}</td><td>${m[a].index}</td><td><input type="checkbox" data-rev="${a}" ${m[a].invert ? 'checked' : ''}></td><td>${a === 'collective' ? '—' : `<button data-centre="${a}">Set</button>`}</td><td><div class="bar"><i data-live="${a}"></i></div></td></tr>`).join('')}
    </table>`;
    for (const cb of host.querySelectorAll<HTMLInputElement>('[data-rev]')) {
      cb.addEventListener('change', () => {
        m[cb.dataset.rev as AxisName].invert = cb.checked;
        saveMapping(m);
        this.onMappingChanged?.();
        this.wizardStatus!.textContent = `${cb.dataset.rev} ${cb.checked ? 'reversed' : 'normal'}. Saved.`;
      });
    }
    for (const b of host.querySelectorAll<HTMLButtonElement>('[data-centre]')) {
      b.addEventListener('click', () => {
        const a = b.dataset.centre as AxisName;
        const raw = g.rawAxes[m[a].index];
        if (raw === undefined) return;
        m[a].center = raw;
        if (m[a].min > raw - 0.05) m[a].min = raw - 0.05;
        if (m[a].max < raw + 0.05) m[a].max = raw + 0.05;
        saveMapping(m);
        this.onMappingChanged?.();
        this.wizardStatus!.textContent = `${a} centre stored at ${raw.toFixed(2)}. Saved.`;
      });
    }
    this.channelsBuiltFor = `${g.padId}|${AXES.map((a) => m[a].index).join(',')}`;
  }

  /** Called every frame while the panel is open: live axis bars plus the assign/calibrate state machines. */
  tick(): void {
    if (this.panel.style.display === 'none') return;
    const g = this.input.gamepad;
    if (g.available() && g.mapping) {
      const key = `${g.padId}|${AXES.map((a) => g.mapping![a].index).join(',')}`;
      if (key !== this.channelsBuiltFor) this.buildChannels();
      for (const a of AXES) {
        const live = this.panel.querySelector<HTMLElement>(`[data-live="${a}"]`);
        if (live) live.style.left = `${50 + readAxis(g.rawAxes, g.mapping[a]) * 50}%`;
      }
    }
    if (this.axisBars && g.available()) {
      const m = g.mapping;
      const label = (i: number) => (m ? AXES.find((a) => m[a].index === i) ?? '' : '');
      this.axisBars.innerHTML = g.rawAxes
        .map((v, i) => `<div class="axis"><span>${i} ${label(i)}</span><div class="bar"><i style="left:${50 + v * 50}%"></i></div></div>`)
        .join('');
      const status = this.panel.querySelector('#pad-status');
      if (status && g.padId) status.innerHTML = `Connected: <code>${g.padId}</code>`;
    } else if (this.axisBars) {
      const status = this.panel.querySelector('#pad-status');
      const dump = g.dump();
      if (status) status.innerHTML = dump.length
        ? `Browser lists: ${dump.map((p) => `<code>${p.id}</code> (${p.axes} axes, ${p.buttons} buttons${p.connected ? '' : ', not connected'})`).join(', ')}`
        : `No USB transmitter listed by the browser yet. Plug in the dongle, then <b>move a stick or press a button</b> (browsers only list a gamepad after it is used).${g.events.length ? ` Events: ${g.events.slice(-3).join('; ')}` : ''}`;
    }
    if (this.report) {
      const r = this.report;
      if (performance.now() % 100 < 20) r.samples.push([...g.rawAxes]); // ~10 Hz, enough to see ranges and which axis moved
      g.rawButtons.forEach((b, i) => { if (b) r.buttons[i] = (r.buttons[i] ?? 0) + 1; });
      const left = Math.ceil((r.until - performance.now()) / 1000);
      this.wizardStatus!.textContent = `Recording… ${left}s. Move every stick to all corners, flip every switch.`;
      if (performance.now() > r.until) {
        this.report = null;
        const axes = g.rawAxes.map((_, i) => ({ index: i, min: Math.min(...r.samples.map((s) => s[i] ?? 0)), max: Math.max(...r.samples.map((s) => s[i] ?? 0)), rest: r.samples[0]?.[i] ?? 0 }));
        const payload = { id: r.id, axesCount: g.rawAxes.length, buttonsCount: g.rawButtons.length, axes, buttonPresses: r.buttons, mapping: g.mapping, samples: r.samples.filter((_, i) => i % 5 === 0).slice(0, 60), pads: g.dump(), events: g.events, ua: navigator.userAgent };
        this.wizardStatus!.textContent = 'Sending…';
        void this.onRadioReport?.(payload).then(() => (this.wizardStatus!.textContent = `Report sent for "${r.id}". Thank you.`)).catch((e) => (this.wizardStatus!.textContent = `Could not send: ${(e as Error).message}`));
      }
    }
    if (this.calibrating) {
      for (let i = 0; i < g.rawAxes.length; i++) {
        this.calibrating.min[i] = Math.min(this.calibrating.min[i] ?? 1, g.rawAxes[i]);
        this.calibrating.max[i] = Math.max(this.calibrating.max[i] ?? -1, g.rawAxes[i]);
      }
    }
    if (this.wizardState && g.mapping) {
      const { axis, baseline, baselineButtons } = this.wizardState;
      let best = -1;
      let bestDelta = 0;
      for (let i = 0; i < g.rawAxes.length; i++) {
        const d = g.rawAxes[i] - (baseline[i] ?? 0);
        if (Math.abs(d) > Math.abs(bestDelta)) {
          bestDelta = d;
          best = i;
        }
      }
      const isSwitch = axis === 'flightModeSwitch' || axis === 'throttleHoldSwitch' || axis === 'rescueSwitch';
      if (isSwitch) {
        // Switches on sim dongles show up as a button or as an axis that jumps between fixed values.
        const pressed = g.rawButtons.findIndex((b, i) => b && !baselineButtons[i]);
        let sw: SwitchMapping | null = null;
        if (pressed >= 0) sw = { kind: 'button', index: pressed, rest: 0 };
        else if (best >= 0 && Math.abs(bestDelta) > 0.6) sw = { kind: 'axis', index: best, rest: baseline[best] };
        if (sw) {
          (g.mapping as GamepadMapping)[axis] = sw;
          this.wizardState = null;
          this.wizardStatus!.textContent = `${axis === 'flightModeSwitch' ? 'Idle-Up' : axis === 'rescueSwitch' ? 'Rescue' : 'Throttle hold'} → ${sw.kind} ${sw.index}. Flip it back, then Save.`;
        }
        return;
      }
      if (best >= 0 && Math.abs(bestDelta) > 0.6) {
        // The hint asks for the positive direction, so a negative delta means the axis is inverted.
        const am: AxisMapping = { ...g.mapping[axis as AxisName], index: best, invert: bestDelta < 0 };
        (g.mapping as GamepadMapping)[axis as AxisName] = am;
        this.wizardState = null;
        this.channelsBuiltFor = '';
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
