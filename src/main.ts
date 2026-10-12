import * as THREE from 'three';
import './style.css';
import { createScene } from './render/scene';
import { HeliMesh } from './render/heli-mesh';
import { PilotCamera, CAMERA_LABELS } from './render/camera';
import { createClouds, driftClouds } from './render/clouds';
import { createBillboards } from './render/billboards';
import { HelicopterSim, PHYSICS_DT } from './sim/physics';
import { HELI_MODELS } from './sim/heli-model';
import { Wind } from './sim/wind';
import { buildSite } from './sim/world';
import { createGymScene } from './render/gym';
import { createLotScene } from './render/lot';
import { createHillScene } from './render/hill';
import { getSite, homeLabel, setSite, unavailableHere, type SiteId } from './site';
import { InputManager } from './input/manager';
import { Hud } from './ui/hud';
import { SettingsPanel, MODE_HELP, HOLD_HELP } from './ui/settings';
import { AudioEngine } from './audio/engine';
import { HelpPanel } from './ui/help';
import { ChallengeTracker, FlightTimer, CHALLENGES } from './game/challenges';
import { HELI_450, applySetup, withTrainingGear, type HeliModel, type ModelSetup } from './sim/heli-model';
import { loadProfile, RankingClient, fmtTime } from './game/player';
import { FlightStats, debriefHtml } from './game/debrief';
import { FlightLog } from './game/flightlog';
import { GateMeshes } from './render/gates';
import { ChallengesPanel } from './ui/challenges-panel';
import { installTypingGuard } from './input/typing-guard';
import { Rescue } from './game/rescue';
import { Voice } from './ui/voice';
import { lessonFor, LessonRunner } from './game/lessons';
import { recordGhost, type GhostFrame } from './game/ghost';
import { Trail } from './render/trail';
import { parseFlight, serializeFlight } from './game/replay-file';
import { buildCustomModel, normalizeSpec, type CustomSpec } from './sim/custom-model';
import { detectLang, onLangChange, setLang, t, type Lang, getLang } from './i18n';
import { LessonOverlay } from './ui/lesson-overlay';
import type { AssistMode } from './sim/physics';

// Must be first: keeps every game hotkey out of text fields (name, email, code...). See input/typing-guard.ts.
installTypingGuard(() => (typeof input !== 'undefined' ? input.keyboard.release() : undefined));

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

// Site: ?site=gym or the saved preference; the field otherwise. Changing it reloads the page.
{
  const fromUrl = new URLSearchParams(location.search).get('site');
  let saved: SiteId | undefined;
  try { saved = (JSON.parse(localStorage.getItem('rc-heli-sim.prefs.v1') ?? '{}') as { site?: SiteId }).site; } catch { /* no prefs */ }
  const isSite = (v: string | null | undefined): v is SiteId => v === 'gym' || v === 'field' || v === 'lot' || v === 'hill';
  const site: SiteId = isSite(fromUrl) ? fromUrl : isSite(saved) ? saved : 'field';
  setSite(site);
}
const { layout, world } = buildSite(getSite());
const field = getSite() === 'gym' ? createGymScene(layout) : getSite() === 'lot' ? createLotScene(layout) : getSite() === 'hill' ? createHillScene(layout, world) : createScene(layout);
const { scene } = field;
const clouds = createClouds();
if (getSite() === 'field' || getSite() === 'hill') scene.add(clouds);
const billboards = createBillboards();
if (getSite() === 'field') scene.add(billboards.group);
const gates = new GateMeshes();
scene.add(gates.group);
const pilotCam = new PilotCamera(window.innerWidth / window.innerHeight);
pilotCam.groundAt = (x, z) => world.groundAt(x, z);

const wind = new Wind();
wind.obstacles = world.windObstacles();
wind.terrain = world.terrain;
if (getSite() === 'gym') wind.speed = 0;
const sim = new HelicopterSim(HELI_MODELS[0], wind, world);
let heliMesh = new HeliMesh(sim.model);
scene.add(heliMesh.root);
const trail = new Trail();
scene.add(trail.object);

let baseModel: HeliModel = HELI_MODELS[0];
let trainingGear = false;
let customModel: HeliModel | null = null;
/** Every model the pilot can pick: the built-ins plus their custom one. */
function allModels(): HeliModel[] {
  return customModel ? [...HELI_MODELS, customModel] : [...HELI_MODELS];
}
function setModel(model: HeliModel): void {
  baseModel = model;
  if (flightGhost) setFlightGhost(null);
  let tuned = applySetup(model, (profile.setup?.[model.id] as ModelSetup | undefined) ?? undefined);
  if (trainingGear) tuned = withTrainingGear(tuned);
  scene.remove(heliMesh.root);
  sim.reset(tuned);
  heliMesh = new HeliMesh(tuned);
  scene.add(heliMesh.root);
}

const ui = document.getElementById('ui')!;
const audio = new AudioEngine();
audio.setIndoor(getSite() === 'gym');
// Browsers only allow audio after a user gesture; any key, click or touch unlocks it.
for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, () => audio.start(), { passive: true });
window.addEventListener('focus', () => audio.resume());
const input: InputManager = new InputManager(ui);
const hud = new Hud(ui);
const help = new HelpPanel(ui);
const profile = loadProfile();
// Language: the saved preference, else the browser's. Set before any panel renders.
{
  let saved: Lang | undefined;
  try { saved = (JSON.parse(localStorage.getItem('rc-heli-sim.prefs.v1') ?? '{}') as { lang?: Lang }).lang; } catch { /* no prefs */ }
  setLang(saved ?? detectLang());
}
if (profile.setup?.[baseModel.id]) setModel(baseModel);
const tracker = new ChallengeTracker(profile.completed);
const flightTimer = new FlightTimer();
const flightLog = new FlightLog();
const rankingClient = new RankingClient();
input.remote.apiBase = rankingClient.baseUrl;
input.remote.onReset = () => reset();
let lesson: LessonRunner | null = null;
let assistBeforeLesson: AssistMode = 'rate';
let lessonEndTimer: number | null = null;
let modelBeforeLesson: HeliModel | null = null;
let ghostFrames: GhostFrame[][] | null = null;
let ghostMesh: HeliMesh | null = null;
/** A previous flight (yours or a loaded one) flying alongside as a translucent ghost, looping, outside lessons. */
let flightGhost: { frames: GhostFrame[]; mesh: HeliMesh; clock: number } | null = null;
function setFlightGhost(frames: { pos: GhostFrame['pos']; ori: GhostFrame['ori']; a1: number; b1: number; rotorOmega: number }[] | null): void {
  if (flightGhost) {
    scene.remove(flightGhost.mesh.root);
    flightGhost = null;
  }
  if (!frames || frames.length < 30) return;
  // Recorded at 60 Hz; the ghost plays at 20 Hz like the lesson ghost.
  const sampled: GhostFrame[] = [];
  for (let i = 0; i < frames.length; i += 3) sampled.push({ pos: { ...frames[i].pos }, ori: { ...frames[i].ori }, a1: frames[i].a1, b1: frames[i].b1, rotorOmega: frames[i].rotorOmega });
  const mesh = new HeliMesh(sim.model, true);
  scene.add(mesh.root);
  flightGhost = { frames: sampled, mesh, clock: 0 };
  hud.notify(`<b>${t('Ghost on')}</b><br>${t('A translucent copy flies the recorded flight on a loop. Match it, beat it, or ignore it.')}<br><button data-action="ghost-off">${t('Stop ghost')}</button>`, 6000);
}
let ghostClock = 0;
const lessonOverlay = new LessonOverlay(ui);
const challenges = new ChallengesPanel(ui, profile, tracker, flightTimer, rankingClient, startLesson, flightLog);

/** "Teach me": a demo pilot flies the challenge on the real physics while the overlay shows the sticks. */
function startLesson(challengeId: string, mode: 'show' | 'teach' = 'show'): void {
  const l = lessonFor(challengeId);
  if (!l) return;
  if (unavailableHere(challengeId)) {
    hud.notify(`<b>${t(homeLabel(challengeId))}</b><br>${t('This one belongs to another site: its landing target, altitude or wind is not here. Settings → Flying site.')}`, 5000);
    return;
  }
  stopLesson();
  // 3D needs a flybarless head: a flybar trainer boom-strikes under full cyclic at negative G.
  const level = CHALLENGES.find((c) => c.id === challengeId)?.level;
  if (level === '3D' && sim.model.controller.type === 'flybar') {
    modelBeforeLesson = sim.model;
    setModel(HELI_450);
    hud.notify(`<b>${t('3D lesson: switched to the flybarless 450')}</b><br>${t('The flybar trainer cannot take full cyclic at negative G. Your model comes back after the lesson.')}`, 6000);
  } else if ((challengeId === 'autorotation' || challengeId === 'tail-failure') && (sim.model.rotor.radius < 0.3 || sim.model.controller.type === 'flybar')) {
    // A micro's rotor stores almost no energy to cushion with, and the demo pilot's hold entry (collective dumped
    // with cyclic in) boom-strikes a flybar head. The demo flies the flybarless 450; the challenge is open to any model.
    modelBeforeLesson = sim.model;
    setModel(HELI_450);
    hud.notify(sim.model.rotor.radius < 0.3
      ? `<b>${t('Autorotation: switched to the flybarless 450')}</b><br>${t("A micro's light blades store too little energy to cushion a landing. Your model comes back after the lesson.")}`
      : `<b>${t('Autorotation: switched to the flybarless 450')}</b><br>${t("The demo's hold entry would boom-strike the flybar head. Your model comes back after the lesson.")}`, 6000);
  }
  sim.reset();
  tracker.resetTransient();
  assistBeforeLesson = sim.assist;
  if (mode === 'show') sim.assist = 'attitude'; // the demo pilot flies with the self-levelling assist; the roll step switches to rate itself
  lesson = new LessonRunner(l, sim, mode);
  if (mode === 'teach') {
    // Pre-fly the lesson in a hidden sim so a translucent ghost can show each step while the player flies it.
    try {
      ghostFrames = recordGhost(l, sim.model, world, wind);
      ghostMesh = new HeliMesh(sim.model, true);
      scene.add(ghostMesh.root);
      ghostClock = 0;
    } catch {
      ghostFrames = null;
    }
  }
  lessonOverlay.show(lesson);
  hud.notify(
    mode === 'show'
      ? `<b>${t('Show me: {title}', { title: t(l.title) })}</b><br>${t('Watch the sticks. Press Stop lesson to take over at any time.')}`
      : `<b>${t('Teach me: {title}', { title: t(l.title) })}</b><br>${t('You fly. Match the dashed ring with your sticks; each step advances when you make it.')}`,
    5000,
  );
}

function stopLesson(resetHeli = true): void {
  if (!lesson) return;
  if (lessonEndTimer !== null) clearTimeout(lessonEndTimer);
  lessonEndTimer = null;
  lesson = null;
  lessonOverlay.hide();
  if (ghostMesh) {
    scene.remove(ghostMesh.root);
    ghostMesh = null;
    ghostFrames = null;
  }
  sim.assist = assistBeforeLesson;
  if (modelBeforeLesson) {
    setModel(modelBeforeLesson);
    modelBeforeLesson = null;
  } else if (resetHeli) {
    sim.reset();
    tracker.resetTransient();
  }
}
lessonOverlay.onStop = () => stopLesson();
tracker.onComplete = (c) => {
  stats.trick(c.id);
  voice.say(t('Challenge complete: {title}', { title: t(c.title) }), getLang());
  hud.notify(`<b>${t('Challenge complete: {title}', { title: t(c.title) })}</b><br>${t('+{points} points · {total} total', { points: c.points, total: tracker.points })}`, 5000);
  void challenges.sync();
};
const stats = new FlightStats();
let telemetryClock = 0;
// Rescue (buddy box): hold Space or the 🛟 button and the demo pilot levels the heli and holds a hover.
const voice = new Voice();
let spokenStep = -1;
let spokenLesson: unknown = null;
const rescue = new Rescue(sim);
// Emergencies: a tail rotor failure on demand, or once per flight at a random moment above 15 m.
let randomFailures = false;
let failureAt = Infinity;
function failTailNow(): void {
  if (sim.state.onGround || sim.state.crashed || sim.state.tailFailed || lesson || replay) return;
  sim.failTail();
  voice.say(t('Tail rotor failure. Throttle hold now.'), getLang(), true);
  hud.notify(`<b>⚠ ${t('TAIL ROTOR FAILURE')}</b><br>${t('Throttle hold now (H), then autorotate.')}`, 4000);
}
let rescueSwitchWas = false;
const drillBadge = document.createElement('div');
drillBadge.className = 'drill-badge';
drillBadge.style.display = 'none';
ui.appendChild(drillBadge);
let drillLine = '';
const rescueBadge = document.createElement('div');
rescueBadge.className = 'rescue-badge';
rescueBadge.style.display = 'none';
ui.appendChild(rescueBadge);
function setRescue(on: boolean): void {
  if (on) {
    if (lesson || replay) return;
    if (!rescue.engage()) { hud.notify(`<b>🛟 ${t('Rescue')}</b><br>${t('Nothing to rescue: the heli is on the ground or already crashed.')}`, 2000); return; }
    rescueBadge.innerHTML = `🛟 <b>${t('RESCUE')}</b> · ${t('the instructor has the sticks; let go to fly')}`;
    rescueBadge.style.display = '';
  } else {
    rescue.release();
    rescueBadge.style.display = 'none';
  }
}
flightTimer.onFlightEnd = (seconds, crashed) => {
  const d = stats.end(sim, seconds, crashed);
  lastFlight = flightFrames();
  if (d && seconds > 8) {
    flightLog.add(d, sim.model.name);
    const extra = !crashed && seconds >= flightTimer.best ? `<br>${t('Your longest clean flight')}` : '';
    hud.notify(debriefHtml(d, fmtTime, (id) => t(CHALLENGES.find((c) => c.id === id)?.title ?? id)) + extra + `<br><button data-action="replay-flight">${t('▶ Replay flight')}</button> <button data-action="save-flight">${t('Save flight')}</button> <button data-action="ghost-flight">${t('Fly against it')}</button>`, 12000);
  }
  if (!crashed) void challenges.sync();
};
const settings = new SettingsPanel(ui, input, wind, audio, {
  onModel(model) {
    setModel(model);
  },
  onCustom(spec) {
    customModel = buildCustomModel(spec);
    // The spec travels with the account setup so it follows the pilot across devices.
    profile.setup = { ...(profile.setup ?? {}), 'custom-spec': spec as unknown as Record<string, unknown> };
    void challenges.sync();
    return customModel;
  },
  onTrainingGear(on) {
    trainingGear = on;
    setModel(baseModel);
    hud.notify(on ? `<b>${t('Training gear fitted')}</b><br>${t('Nearly tip-proof. A bit heavier and slower; remove it when hovering is boring.')}` : `<b>${t('Training gear removed')}</b>`, 3500);
  },
  onSetup(modelId, setup) {
    profile.setup = { ...(profile.setup ?? {}), [modelId]: setup };
    // Re-apply without resetting the flight: patch the live model in place.
    const base = allModels().find((m) => m.id === modelId) ?? baseModel;
    let tuned = applySetup(base, setup);
    if (trainingGear) tuned = withTrainingGear(tuned);
    sim.model = tuned;
    void challenges.sync();
  },
  getSetup(modelId) {
    return profile.setup?.[modelId] as ModelSetup | undefined;
  },
  onReset: reset,
  onFlightMode(mode) {
    input.keyboard.poll(0).flightMode = mode;
    input.gamepad.flightMode = mode;
    input.touch.setFlightMode(mode);
  },
  onThrottleHold(hold) {
    input.keyboard.poll(0).throttleHold = hold;
    input.gamepad.throttleHold = hold;
    input.touch.setThrottleHold(hold);
  },
  onAssist(mode) {
    sim.assist = mode;
  },
  onHelp() {
    help.toggle();
  },
  onChallenges() {
    challenges.toggle();
  },
  onPilot() {
    challenges.open('pilot');
  },
  onPause() {
    setPaused(!paused);
  },
  onRescue(on) {
    setRescue(on);
  },
  onFailTail() {
    failTailNow();
  },
  onRandomFailures(on) {
    randomFailures = on;
  },
  onVoice(on) {
    voice.enabled = on;
    if (!on) voice.stop();
  },
  onPilotSpot(spot) {
    // The road spot stands beside the cerradoX billboard (x = 0, z = 56), not behind it.
    const spots: Record<string, [number, number]> = getSite() === 'gym'
      ? { pad: [0, 0], bleachers: [15, -14], end: [0, -34] }
      : getSite() === 'lot'
        ? { pad: [0, 0], cars: [-18, -8], container: [12, -14], fence: [0, 40] }
        : getSite() === 'hill'
          ? { pad: [0, 0], slope: [-4, -34], bank: [34, -12], fence: [0, 20] }
          : { pad: [0, 0], barn: [-40, -6], pond: [28, -12], tower: [14, -34], road: [14, 64] };
    let x: number;
    let z: number;
    if (spot === 'heli') {
      // Walk to about 4 m from where the heli is, approaching from where you stand.
      const hx = sim.state.pos.x;
      const hz = sim.state.pos.z;
      const dx = hx - pilotCam.eye.x;
      const dz = hz - pilotCam.eye.z;
      const d = Math.hypot(dx, dz) || 1;
      const back = Math.min(d, 4);
      x = hx - (dx / d) * back;
      z = hz - (dz / d) * back;
    } else [x, z] = spots[spot] ?? [0, 0];
    pilotCam.setEye(x, z, world.groundAt(x, z));
    field.pilotMarker.position.set(x, world.groundAt(x, z), z);
    hud.notify(spot === 'heli' ? `<b>${t('Walked to the heli')}</b>` : `<b>${t('Pilot moved')}</b><br>${spot}`, 2000);
  },
  onArrow(on) {
    field.arrow.visible = on;
  },
  onTrail(on) {
    trail.visible = on;
  },
  onGraph(on) {
    hud.graphOn = on;
  },
  onTimeOfDay(t) {
    field.setTimeOfDay(t);
  },
  onLoadFlight(file, asGhost) {
    file.text().then((text) => {
      try {
        if (asGhost) loadFlightGhostText(text);
        else loadFlightText(text);
      } catch (e) {
        hud.notify(`<b>${t('That file is not a saved flight.')}</b><br>${(e as Error).message}`, 4000);
      }
    });
  },
  onClearGhost() {
    setFlightGhost(null);
  },
  onCamera(mode) {
    if (mode) pilotCam.mode = mode;
    else pilotCam.cycle();
    return CAMERA_LABELS[pilotCam.mode];
  },
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyC') settings.cycleCamera();
});
settings.setPilotLabel(profile.name, profile.verified);
// A custom heli saved to the account (another device) comes back through the setup blob.
const accountSpec = profile.setup?.['custom-spec'] as Partial<CustomSpec> | undefined;
if (accountSpec && typeof accountSpec === 'object') {
  const spec = normalizeSpec(accountSpec);
  customModel = buildCustomModel(spec);
  settings.setCustom(spec, customModel);
}
settings.restore();
// Offline at the field: the service worker caches the build after the first visit (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
onLangChange(() => {
  challenges.refresh();
  help.setLanguage();
});
// Returning after an update: a one-line note with the release log link.
{
  let prefs: { seenVersion?: string } = {};
  try { prefs = JSON.parse(localStorage.getItem('rc-heli-sim.prefs.v1') ?? '{}') as { seenVersion?: string }; } catch { /* no prefs */ }
  if (prefs.seenVersion && prefs.seenVersion !== __VERSION__ && !settings.firstVisit) {
    hud.notify(`<b>${t('Updated to v{version}', { version: __VERSION__ })}</b><br><a href="https://github.com/filipenevola/rc-heli-sim/blob/main/CHANGELOG.md" target="_blank" rel="noopener">${t('Release log')}</a>`, 6000);
  }
  if (prefs.seenVersion !== __VERSION__) settings.markVersionSeen(__VERSION__);
}
// First visit: a short welcome card with the three things a newcomer needs. Dismissed by its button or by flying.
if (settings.firstVisit && !new URLSearchParams(location.search).get('lesson')) {
  const touch = matchMedia('(pointer: coarse)').matches;
  hud.notify(
    `<b>${t('Welcome to RC Heli Sim')}</b><br>${touch
      ? t('Left stick: throttle and rudder. Right stick: cyclic. Raise the throttle slowly.')
      : t('W / S collective, arrow keys cyclic, A / D rudder. Raise W slowly to lift off.')}<br>` +
      t('New to helis? Open <b>Challenges</b> and press <b>Show me</b> on First hover. The <b>?</b> button is the manual.') +
      `<br><button data-action="welcome-ok">${t('Got it')}</button>`,
    60000,
  );
  settings.markWelcomed();
}
settings.onRadioReport = (r) => rankingClient.sendRadioReport(r);
settings.onMappingChanged = () => void challenges.sync();
// Auto-calibration widened a range while flying: persist it to the account too (throttled).
setInterval(() => {
  if (input.gamepad.mappingDirty) {
    input.gamepad.mappingDirty = false;
    void challenges.sync();
  }
}, 15000);
challenges.onProfileChange = () => settings.setPilotLabel(profile.name, profile.verified);

// URL options, handy for sharing a view or for screenshots: ?cam=chase&pos=0,6,-28&yaw=180
{
  const q = new URLSearchParams(location.search);
  const cam = q.get('cam');
  const pos = q.get('pos')?.split(',').map(Number);
  if (pos && pos.length === 3 && pos.every(Number.isFinite)) {
    sim.state.pos = { x: pos[0], y: pos[1], z: pos[2] };
    sim.state.onGround = false;
  }
  const yaw = Number(q.get('yaw'));
  if (Number.isFinite(yaw) && q.has('yaw')) {
    const r = (yaw * Math.PI) / 180;
    sim.state.ori = { x: 0, y: Math.sin(r / 2), z: 0, w: Math.cos(r / 2) };
  }
  if (cam && (CAMERA_LABELS as Record<string, string>)[cam]) settings.setCamera(cam as keyof typeof CAMERA_LABELS);
  const lessonId = q.get('lesson');
  if (lessonId) startLesson(lessonId, q.get('mode') === 'teach' ? 'teach' : 'show');
  const panel = q.get('panel');
  if (panel === 'pilot' || panel === 'rankings' || panel === 'challenges') challenges.open(panel);
}

// Exposed for automated checks and tinkering from the devtools console.
(window as unknown as { rcHeli: unknown }).rcHeli = { sim, input, wind, audio, camera: pilotCam, clouds, scene, world, layout, loadFlightText, loadFlightGhostText, exportFlight, setFlightGhost, tracker, flightTimer, profile, flightLog, challengesList: CHALLENGES };

function reset(): void {
  setRescue(false);
  if (replay) stopReplay();
  hoverArmed = false;
  recording.length = 0;
  trail.clear();
  if (lesson) stopLesson();
  sim.reset();
  tracker.resetTransient();
}

/** Shift+R: reset into a hover at 6 m in Idle-Up 1, for 3D drills. */
function resetHover(): void {
  if (replay) stopReplay();
  recording.length = 0;
  trail.clear();
  if (lesson) stopLesson(false);
  sim.resetInAir(6);
  tracker.resetTransient();
  // Idle-Up 1 on every source; the keyboard's collective goes to the hover stick, a transmitter must be held there.
  input.keyboard.poll(0).flightMode = 1;
  input.gamepad.flightMode = 1;
  input.keyboard.poll(0).collective = hoverStick(sim.model);
  // Freeze until the collective is near the hover point, so a transmitter stick left at the bottom does not
  // dump the heli from 6 m the instant it appears.
  hoverArmed = true;
  hud.notify(`<b>${t('Hover reset')}</b><br>${t('Idle-Up 1, 6 m up, rotor at speed. Frozen until your collective is near the middle.')}`, 4500);
}
let hoverArmed = false;
/** Stick position where the Idle-Up 1 pitch curve gives roughly the hover pitch (about 5.5 degrees). */
function hoverStick(model: HeliModel): number {
  const curve = model.pitchCurves[1];
  let best = 0;
  let bestErr = 1e9;
  for (let st = -1; st <= 1; st += 0.01) {
    const t = ((st + 1) / 2) * (curve.length - 1);
    const i = Math.min(curve.length - 2, Math.floor(t));
    const deg = curve[i] * (1 - (t - i)) + curve[i + 1] * (t - i);
    const err = Math.abs(deg - 5.5);
    if (err < bestErr) { bestErr = err; best = st; }
  }
  return best;
}

window.addEventListener('keyup', (e) => { if (e.code === 'Space') setRescue(false); });
window.addEventListener('blur', () => setRescue(false));
window.addEventListener('keydown', (e) => {
  if (replay) {
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); lessonOverlay.onReplay?.({ toggle: true }); }
    if (e.code === 'ArrowLeft') lessonOverlay.onReplay?.({ step: -1 });
    if (e.code === 'ArrowRight') lessonOverlay.onReplay?.({ step: 1 });
    return;
  }
  if (e.code === 'Space' && !e.repeat) { e.preventDefault(); setRescue(true); }
  if (e.code === 'KeyR' && e.shiftKey) resetHover();
  else if (e.code === 'KeyR') reset();
  if (e.code === 'KeyT') settings.setTrail(!trail.visible);
  if (e.code === 'KeyY') settings.setGraph(!hud.graphOn);
});

// Tap a billboard to open the site. A short press with no drag only, so camera-free touches on the field do nothing.
const raycaster = new THREE.Raycaster();
let pressAt: { x: number; y: number; t: number } | null = null;
renderer.domElement.addEventListener('pointerdown', (e) => (pressAt = { x: e.clientX, y: e.clientY, t: performance.now() }));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!pressAt) return;
  const moved = Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y);
  const quick = performance.now() - pressAt.t < 400;
  pressAt = null;
  if (moved > 8 || !quick) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, pilotCam.camera);
  const hit = raycaster.intersectObjects(billboards.panels, false)[0];
  const ad = hit?.object.userData.billboard as { url: string } | undefined;
  if (ad) window.open(ad.url, '_blank', 'noopener');
});
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  trail.setResolution(window.innerWidth, window.innerHeight);
  pilotCam.resize(window.innerWidth / window.innerHeight);
});

// Fixed-timestep physics driven by the render clock. Simulation time never runs ahead of wall time,
// and a hitch (tab switch) is capped so the heli does not teleport.
// Flight recorder: state and sticks once per render frame. The crash replay uses the last 10 s; the debrief's
// "Replay flight" plays the whole flight from lift-off (capped at 15 minutes).
interface Frame { pos: { x: number; y: number; z: number }; ori: { x: number; y: number; z: number; w: number }; a1: number; b1: number; rotorOmega: number; ctl: ReturnType<typeof input.poll> }
const REC_SECONDS = 10;
const REC_MAX = 60 * 15 * 60;
const recording: Frame[] = [];
let recFrameNo = 0;
let flightStartFrame = 0;
let lastFlight: Frame[] | null = null;
let replay: { frames: Frame[]; i: number; acc: number; kind: 'crash' | 'flight'; speed: number; playing: boolean } | null = null;
let recordedCrash = false;
let wasOnGround = true;
function record(ctl: ReturnType<typeof input.poll>): void {
  const st = sim.state;
  recording.push({ pos: { ...st.pos }, ori: { ...st.ori }, a1: st.a1, b1: st.b1, rotorOmega: st.rotorOmega, ctl: { ...ctl } });
  recFrameNo++;
  if (recording.length > REC_MAX) recording.shift();
}
/** Frames since the current flight began (a second of ground run before lift-off included). */
function flightFrames(): Frame[] {
  const n = Math.min(recording.length, recFrameNo - flightStartFrame + 60);
  return recording.slice(recording.length - n);
}
function startReplay(kind: 'crash' | 'flight' = 'crash', loaded: Frame[] | null = null): void {
  const frames = loaded ?? (kind === 'crash' ? recording.slice(-60 * REC_SECONDS) : lastFlight ?? []);
  if (frames.length < 10) return;
  replay = { frames, i: 0, acc: 0, kind, speed: 1, playing: true };
  hud.crashHidden = true;
  trail.clear();
  lessonOverlay.showReplay(kind);
  lessonOverlay.onStop = stopReplay;
  lessonOverlay.onReplay = (cmd) => {
    if (!replay) return;
    const last = replay.frames.length - 1;
    if (cmd.seek !== undefined) { replay.i = Math.round(cmd.seek * last); replay.acc = 0; trail.clear(); }
    if (cmd.step !== undefined) { replay.i = Math.max(0, Math.min(last, replay.i + Math.round(cmd.step * 60))); replay.acc = 0; trail.clear(); }
    if (cmd.toggle) replay.playing = !replay.playing;
    if (cmd.speed) replay.speed = replay.speed === 1 ? 0.5 : replay.speed === 0.5 ? 0.25 : 1;
  };
}
/** Download the last flight as a .json the Settings panel can load back, here or on another machine. */
function exportFlight(): void {
  const frames = lastFlight ?? [];
  if (frames.length < 10) return;
  const text = serializeFlight(frames, sim.model.name, __VERSION__);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `rc-heli-flight-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** Replay a saved flight from its JSON text. Returns the model it was flown on. */
function loadFlightText(text: string): string {
  const file = parseFlight(text);
  startReplay('flight', file.frames);
  hud.notify(`<b>${t('Loaded flight: {model}', { model: file.model || '?' })}</b><br>${t('Replaying with its sticks. Close replay to fly.')}`, 4000);
  return file.model;
}
hud.onAction = (id) => {
  if (id === 'replay-flight') startReplay('flight');
  if (id === 'save-flight') exportFlight();
  if (id === 'ghost-flight') setFlightGhost(lastFlight);
  if (id === 'ghost-off') setFlightGhost(null);
  // 'welcome-ok' just closes the card.
};
/** A saved flight as a ghost instead of a replay. Returns the model it was flown on. */
function loadFlightGhostText(text: string): string {
  const file = parseFlight(text);
  setFlightGhost(file.frames);
  return file.model;
}
function stopReplay(): void {
  replay = null;
  hud.crashHidden = false;
  trail.clear();
  lessonOverlay.hide();
  lessonOverlay.restoreStopLabel();
  lessonOverlay.onStop = () => stopLesson();
  // Put the mesh back on the real (crashed) state.
  heliMesh.update(sim.state, 0);
}
hud.onReplay = () => startReplay('crash');

let paused = false;
function setPaused(p: boolean): void {
  paused = p;
  settings.setPaused(p);
  hud.setPaused(p);
  audio.setPaused(p);
  if (!p) last = performance.now(); // do not integrate the time spent paused
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') setPaused(!paused);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !paused) setPaused(true);
});

let last = performance.now();
let lastMode = -1;
let lastHold = false;
let accumulator = 0;
const target = new THREE.Vector3();
const heliQuat = new THREE.Quaternion();
const MAX_FRAME = 0.1;

function frame(now: number): void {
  const dt = Math.max(0, Math.min((now - last) / 1000, MAX_FRAME)); // never negative, even with odd clocks
  last = now;
  let ctl = input.poll(dt);
  if (lesson && lesson.mode === 'teach') {
    // The player flies; the runner judges the step and computes the ghost-stick hint.
    lesson.coach(dt, ctl);
    lessonOverlay.update(lesson, ctl, lesson.hint);
    // Ghost: loop the demo pilot's recording of the current step.
    if (ghostFrames && ghostMesh) {
      const frames = ghostFrames[lesson.stepIndex] ?? [];
      if (frames.length > 1) {
        ghostClock += dt;
        const idx = ((Math.floor(ghostClock * 20) % frames.length) + frames.length) % frames.length;
        const f = frames[idx] ?? frames[0];
        ghostMesh.root.visible = true;
        ghostMesh.update({ ...sim.state, pos: f.pos, ori: f.ori, a1: f.a1, b1: f.b1, rotorOmega: f.rotorOmega, crashed: false }, dt);
      } else ghostMesh.root.visible = false;
    }
    if (lesson.crashed && lessonEndTimer === null) {
      const l = lesson;
      lessonEndTimer = window.setTimeout(() => {
        lessonEndTimer = null;
        if (lesson === l) {
          sim.reset();
          tracker.resetTransient();
          l.restart();
        }
      }, 2500);
    }
    if (lesson.finished && lessonEndTimer === null) {
      const done = lesson;
      lessonEndTimer = window.setTimeout(() => {
        if (lesson === done) stopLesson(false);
      }, 6000);
    }
  } else if (lesson) {
    // The demo pilot has the sticks; the player's input is ignored until Stop (or Reset).
    ctl = lesson.update(dt);
    lessonOverlay.update(lesson, ctl);
    if (lesson.finished && lessonEndTimer === null) {
      // Leave the overlay with the final caption for a few seconds, then hand the sticks back.
      const done = lesson;
      lessonEndTimer = window.setTimeout(() => {
        if (lesson === done) stopLesson();
      }, 6000);
    }
  }
  settings.reflect(ctl.flightMode, ctl.throttleHold);
  if (ctl.flightMode !== lastMode) {
    if (lastMode !== -1) hud.notify(`<b>${['Normal', 'Idle-Up 1', 'Idle-Up 2'][ctl.flightMode]}</b><br>${t(MODE_HELP[ctl.flightMode]).replace(/^[^:]+: /, '')}`);
    lastMode = ctl.flightMode;
  }
  if (ctl.throttleHold !== lastHold) {
    hud.notify(`<b>${ctl.throttleHold ? t('Throttle hold ON') : t('Throttle hold off')}</b><br>${t(ctl.throttleHold ? HOLD_HELP.on : HOLD_HELP.off).replace(/^[^:]+: /, '')}`);
    lastHold = ctl.throttleHold;
  }

  if (replay) {
    // Replay: no physics; walk the recorded frames (taken once per render frame) at the chosen speed.
    if (replay.playing) replay.acc += dt * replay.speed;
    while (replay.acc > 1 / 60 && replay.i < replay.frames.length - 1) {
      replay.acc -= 1 / 60;
      replay.i++;
    }
    lessonOverlay.setReplayState(replay.i / Math.max(1, replay.frames.length - 1), replay.playing, replay.speed);
    const f = replay.frames[replay.i];
    const fake = { ...sim.state, pos: f.pos, ori: f.ori, a1: f.a1, b1: f.b1, rotorOmega: f.rotorOmega, crashed: false };
    heliMesh.update(fake, dt);
    trail.update(f.pos, dt);
    lessonOverlay.updateReplay(f.ctl, (replay.frames.length - 1 - replay.i) / 60, replay.i / 60);
    if (replay.playing && replay.i >= replay.frames.length - 1 && replay.acc > 2) { replay.i = 0; trail.clear(); } // loop after a pause at the end
    target.set(f.pos.x, f.pos.y, f.pos.z);
    heliQuat.set(f.ori.x, f.ori.y, f.ori.z, f.ori.w);
    pilotCam.update(target, heliQuat, dt);
    renderer.render(scene, pilotCam.camera);
    requestAnimationFrame(frame);
    return;
  }
  if (hoverArmed) {
    if (Math.abs(ctl.collective - hoverStick(sim.model)) < 0.2) {
      hoverArmed = false;
      hud.notify(`<b>${t('Go')}</b>`, 800);
    } else {
      accumulator = 0;
    }
  }
  // Rescue switch on the transmitter: edge-triggered so Space and the button still work alongside it.
  if (ctl.rescue !== undefined && ctl.rescue !== rescueSwitchWas) {
    rescueSwitchWas = ctl.rescue;
    setRescue(ctl.rescue);
  }
  // Rescue: the instructor's sticks replace the pilot's while the key or button is held.
  if (rescue.active) {
    ctl = rescue.update(ctl);
    if (!rescue.active) setRescue(false); // it let go by itself (crash)
  }
  if (!paused && !hoverArmed) {
    accumulator += dt;
    while (accumulator >= PHYSICS_DT) {
      sim.step(ctl, PHYSICS_DT);
      accumulator -= PHYSICS_DT;
    }
    if (!sim.state.crashed) record(ctl);
    else if (!recordedCrash) {
      record(ctl); // keep the impact frame once
      recordedCrash = true;
      // Phones: a thump in the hand on a crash, like the real thing minus the repair bill.
      if ('vibrate' in navigator) navigator.vibrate([120, 60, 200]);
    }
    if (!sim.state.crashed) recordedCrash = false;
    // A firm touchdown taps the phone once.
    if (sim.state.onGround && !wasOnGround && !sim.state.crashed && sim.state.touchdownSpeed > 1.0 && 'vibrate' in navigator) navigator.vibrate(60);
    wasOnGround = sim.state.onGround;
  }

  heliMesh.update(sim.state, paused ? 0 : dt);
  if (!paused) trail.update(sim.state.pos, dt);
  if (flightGhost && !lesson) {
    if (!paused) flightGhost.clock += dt;
    const fr = flightGhost.frames;
    const idx = Math.floor(flightGhost.clock * 20) % fr.length;
    const f = fr[idx] ?? fr[0];
    flightGhost.mesh.root.visible = true;
    flightGhost.mesh.update({ ...sim.state, pos: f.pos, ori: f.ori, a1: f.a1, b1: f.b1, rotorOmega: f.rotorOmega, crashed: false }, paused ? 0 : dt);
  } else if (flightGhost) flightGhost.mesh.root.visible = false;
  target.set(sim.state.pos.x, sim.state.pos.y, sim.state.pos.z);
  heliQuat.set(sim.state.ori.x, sim.state.ori.y, sim.state.ori.z, sim.state.ori.w);
  pilotCam.update(target, heliQuat, dt);
  const w = wind.at(sim.state.pos, sim.state.time);
  driftClouds(clouds, dt, w.x, w.z);
  // Windsock points downwind and droops when it is calm; animals graze.
  const windAngle = Math.atan2(-w.x, -w.z);
  field.windsock.rotation.set(-(1 - Math.min(1, wind.speed / 6)) * 1.2, windAngle + Math.PI, 0, 'YXZ');
  field.animate(dt, sim.state.time);
  // Trees lean and flutter with the wind where they stand: read the gusts off the treeline, as on the field.
  field.setWind?.((x, y, z) => wind.at({ x, y, z }, sim.state.time), sim.state.time);
  // Orientation arrow under the model, pointing where the nose points; faces the pilot figure toward the model.
  if (field.arrow.visible) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(heliQuat);
    field.arrow.position.set(sim.state.pos.x, world.groundAt(sim.state.pos.x, sim.state.pos.z) + 0.03, sim.state.pos.z);
    field.arrow.rotation.set(-Math.PI / 2, 0, Math.atan2(-fwd.x, -fwd.z));
  }
  field.pilotMarker.rotation.y = Math.atan2(-(sim.state.pos.x - field.pilotMarker.position.x), -(sim.state.pos.z - field.pilotMarker.position.z));

  if (!paused && (!lesson || lesson.mode === 'teach')) {
    const wasFlying = flightTimer.flying;
    flightTimer.update(sim, dt);
    if (flightTimer.flying && !wasFlying) { stats.begin(sim); flightStartFrame = recFrameNo; failureAt = 10 + Math.random() * 40; }
    if (randomFailures && flightTimer.flying && flightTimer.airTime > failureAt && sim.telemetry.altitude > 15) { failureAt = Infinity; failTailNow(); }
    if (flightTimer.flying) stats.update(sim, dt, ctl);
    tracker.update(sim, dt, flightTimer.flying ? flightTimer.airTime : 0);
  }
  gates.update([tracker.nextGate('circuit'), tracker.nextGate('figure-eight')], [tracker.completed.has('circuit'), tracker.completed.has('figure-eight')]);
  challenges.tick();
  // The instructor reads each new lesson caption aloud (and the intro on the first step).
  if (lesson && !lesson.finished) {
    if (lesson !== spokenLesson) { spokenLesson = lesson; spokenStep = -1; }
    if (lesson.stepIndex !== spokenStep) {
      spokenStep = lesson.stepIndex;
      const cap = lesson.step?.caption ?? '';
      voice.say(spokenStep === 0 ? `${t(lesson.lesson.intro)} ${t(cap)}` : t(cap), getLang());
    }
  } else if (!lesson && spokenLesson) { spokenLesson = null; voice.stop(); }
  hud.update(sim, ctl, input.active.label, input.active.id, dt);
  // A live instruction from a challenge in progress (the orientation drill's next heading).
  {
    const line = lesson ? '' : tracker.hudLine();
    if (line !== drillLine) {
      drillLine = line;
      drillBadge.textContent = line ? `🧭 ${line.replace(/^([^:]+):/, (_, title: string) => `${t(title)}:`).replace(/(Tail-in|Left side-in|Nose-in|Right side-in)/, (m) => t(m))}` : '';
      drillBadge.style.display = line ? '' : 'none';
    }
  }
  // Phone radio: a glance strip on the phone (head speed, height, battery) and a buzz when the heli crashes.
  if (input.remote.state === 'connected' && (telemetryClock += dt) > 0.1) {
    telemetryClock = 0;
    input.remote.sendTelemetry({ rpm: Math.round(sim.telemetry.headspeedRpm), alt: Math.round(sim.telemetry.altitude * 10) / 10, bat: Math.round(sim.telemetry.battery * 100), mode: ctl.flightMode, hold: ctl.throttleHold, crash: sim.state.crashReason });
  }
  audio.update(sim, pilotCam.eye, wind.speed);
  settings.tick();
  renderer.render(scene, pilotCam.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
