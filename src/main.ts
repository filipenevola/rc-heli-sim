import * as THREE from 'three';
import './style.css';
import { createScene, type Quality } from './render/scene';
import { LAYER_GRASS, LAYER_HELI, type TimeOfDay } from './render/environment';
import { updateWash } from './render/wash';
import { RotorSpray } from './render/spray';
import { PostFX } from './render/post';
import { HeliMesh } from './render/heli-mesh';
import { PilotCamera, CAMERA_LABELS } from './render/camera';
import { createClouds, driftClouds } from './render/clouds';
import { createBillboards } from './render/billboards';
import { HelicopterSim, PHYSICS_DT } from './sim/physics';
import { HELI_MODELS, pitchFromCurve } from './sim/heli-model';
import { HangarPanel, DEMO } from './ui/hangar';
import { Wind } from './sim/wind';
import { buildField } from './sim/world';
import { InputManager } from './input/manager';
import { Hud } from './ui/hud';
import { SettingsPanel, MODE_HELP, HOLD_HELP } from './ui/settings';
import { AudioEngine } from './audio/engine';
import { HelpPanel } from './ui/help';
import { ChallengeTracker, FlightTimer, CHALLENGES } from './game/challenges';
import { HELI_450, type HeliModel } from './sim/heli-model';
import { loadProfile, RankingClient, fmtTime } from './game/player';
import { GateMeshes } from './render/gates';
import { ChallengesPanel } from './ui/challenges-panel';
import { installTypingGuard } from './input/typing-guard';
import { lessonFor, LessonRunner } from './game/lessons';
import { LessonOverlay } from './ui/lesson-overlay';
import type { AssistMode } from './sim/physics';

// Must be first: keeps every game hotkey out of text fields (name, email, code...). See input/typing-guard.ts.
installTypingGuard(() => (typeof input !== 'undefined' ? input.keyboard.release() : undefined));

const app = document.getElementById('app')!;
// Graphics quality: high on desktops (reflections, dense grass, HDR bloom), low on phones. ?quality= overrides.
const GFX_KEY = 'rcheli.gfx';
const gfxSaved = JSON.parse(localStorage.getItem(GFX_KEY) ?? '{}') as { quality?: Quality; timeOfDay?: TimeOfDay };
const isPhone = navigator.maxTouchPoints > 0 && window.innerWidth < 1100;
const quality: Quality = (new URLSearchParams(location.search).get('quality') as Quality | null) ?? gfxSaved.quality ?? (isPhone ? 'low' : 'high');
const renderer = new THREE.WebGLRenderer({ antialias: quality === 'low', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

const { layout, world } = buildField();
const field = createScene(layout, renderer, quality);
const { scene, env } = field;
if (gfxSaved.timeOfDay) env.setTimeOfDay(gfxSaved.timeOfDay);
const clouds = createClouds();
scene.add(clouds);
const billboards = createBillboards();
scene.add(billboards.group);
const gates = new GateMeshes();
scene.add(gates.group);
const pilotCam = new PilotCamera(window.innerWidth / window.innerHeight);
pilotCam.camera.layers.enable(LAYER_HELI);
pilotCam.camera.layers.enable(LAYER_GRASS);
const post = quality === 'high' ? new PostFX(renderer, scene, pilotCam.camera) : null;
post?.setSize(window.innerWidth, window.innerHeight);
const spray = new RotorSpray(world);
scene.add(spray.points);

const wind = new Wind();
const sim = new HelicopterSim(HELI_MODELS[0], wind, world);
let heliMesh = new HeliMesh(sim.model);
scene.add(heliMesh.root);

function setModel(model: HeliModel): void {
  scene.remove(heliMesh.root);
  heliMesh.dispose();
  sim.reset(model);
  heliMesh = new HeliMesh(model);
  scene.add(heliMesh.root);
  if (inHangar) {
    heliMesh.spinOverride = hangarSpin ? HANGAR_SPIN : 0;
    hangar.open(model.controller.type, model.name);
    selectPart(null);
  }
}

/** Graphics settings: time of day applies live; quality needs a reload (it changes what gets built). */
function setGraphics(g: { quality?: Quality; timeOfDay?: TimeOfDay }): void {
  Object.assign(gfxSaved, g);
  localStorage.setItem(GFX_KEY, JSON.stringify(gfxSaved));
  if (g.timeOfDay) {
    env.setTimeOfDay(g.timeOfDay);
    tintClouds();
  }
  if (g.quality && g.quality !== quality) location.reload();
}
function tintClouds(): void {
  const tint = env.timeOfDay === 'golden' ? 0xffd9b8 : 0xffffff;
  clouds.traverse((o) => {
    const m = (o as THREE.Sprite).material as THREE.SpriteMaterial | undefined;
    if (m?.color) m.color.set(tint);
  });
}
tintClouds();

const ui = document.getElementById('ui')!;
const audio = new AudioEngine();
// Browsers only allow audio after a user gesture; any key, click or touch unlocks it.
for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, () => audio.start(), { passive: true });
window.addEventListener('focus', () => audio.resume());
const input: InputManager = new InputManager(ui);
const hud = new Hud(ui);
const help = new HelpPanel(ui);
const profile = loadProfile();
const tracker = new ChallengeTracker(profile.completed);
const flightTimer = new FlightTimer();
const rankingClient = new RankingClient();
let lesson: LessonRunner | null = null;
let assistBeforeLesson: AssistMode = 'rate';
let lessonEndTimer: number | null = null;
let modelBeforeLesson: HeliModel | null = null;
const lessonOverlay = new LessonOverlay(ui);
const challenges = new ChallengesPanel(ui, profile, tracker, flightTimer, rankingClient, startLesson);

/** "Teach me": a demo pilot flies the challenge on the real physics while the overlay shows the sticks. */
function startLesson(challengeId: string, mode: 'show' | 'teach' = 'show'): void {
  const l = lessonFor(challengeId);
  if (!l) return;
  stopLesson();
  // 3D needs a flybarless head: a flybar trainer boom-strikes under full cyclic at negative G.
  const level = CHALLENGES.find((c) => c.id === challengeId)?.level;
  if (level === '3D' && sim.model.controller.type === 'flybar') {
    modelBeforeLesson = sim.model;
    setModel(HELI_450);
    hud.notify('<b>3D lesson: switched to the flybarless 450</b><br>The flybar trainer cannot take full cyclic at negative G. Your model comes back after the lesson.', 6000);
  }
  sim.reset();
  tracker.resetTransient();
  assistBeforeLesson = sim.assist;
  if (mode === 'show') sim.assist = 'attitude'; // the demo pilot flies with the self-levelling assist; the roll step switches to rate itself
  lesson = new LessonRunner(l, sim, mode);
  lessonOverlay.show(lesson);
  hud.notify(
    mode === 'show'
      ? `<b>Show me: ${l.title}</b><br>Watch the sticks. Press Stop lesson to take over at any time.`
      : `<b>Teach me: ${l.title}</b><br>You fly. Match the dashed ring with your sticks; each step advances when you make it.`,
    5000,
  );
}

function stopLesson(resetHeli = true): void {
  if (!lesson) return;
  if (lessonEndTimer !== null) clearTimeout(lessonEndTimer);
  lessonEndTimer = null;
  lesson = null;
  lessonOverlay.hide();
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
  hud.notify(`<b>Challenge complete: ${c.title}</b><br>+${c.points} points · ${tracker.points} total`, 5000);
  void challenges.sync();
};
flightTimer.onFlightEnd = (seconds, crashed) => {
  if (seconds > 20) hud.notify(`<b>${crashed ? 'Flight ended in a crash' : 'Clean flight'}: ${fmtTime(seconds)}</b>${!crashed && seconds >= flightTimer.best ? '<br>Your longest clean flight' : ''}`, 4000);
  if (!crashed) void challenges.sync();
};
const settings = new SettingsPanel(ui, input, wind, audio, {
  onModel(model) {
    setModel(model);
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
  onHangar() {
    (inHangar ? exitHangar : enterHangar)();
  },
  onGraphics(g) {
    setGraphics(g);
  },
  getGraphics() {
    return { quality, timeOfDay: env.timeOfDay };
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

/* ------------------------------------------------------------------------------------------------ */
/* Hangar: the parts explorer                                                                         */
/* ------------------------------------------------------------------------------------------------ */
let inHangar = false;
let hangarDemo = false;
let hangarSpin = false;
let demoT = 0;
let hoverPart: string | null = null;
const HANGAR_SPIN = 3; // rad/s: slow enough to follow one blade round
const hangar = new HangarPanel(ui, {
  onClose: () => exitHangar(),
  onSelect: (id) => selectPart(id),
  onExplode: (t) => heliMesh.setExplode(t),
  onCanopy: (v) => heliMesh.setCanopy(v),
  onSpin: (on) => {
    hangarSpin = on;
    heliMesh.spinOverride = on ? HANGAR_SPIN : 0;
  },
  onDemo: (on) => {
    hangarDemo = on;
    demoT = 0;
    if (!on) {
      hangar.setDemoCaption(null);
      selectPart(hangar.selected);
    }
  },
});

function enterHangar(): void {
  if (inHangar) return;
  if (lesson) stopLesson();
  if (paused) setPaused(false);
  sim.reset();
  tracker.resetTransient();
  inHangar = true;
  document.body.classList.add('in-hangar');
  heliMesh.spinOverride = 0;
  hangar.open(sim.model.controller.type, sim.model.name);
  const p = sim.state.pos;
  pilotCam.beginOrbit(new THREE.Vector3(p.x, p.y + 0.03 * (sim.model.rotor.radius / 0.36), p.z), 2.35, 0.3, sim.model.rotor.radius * 2.6);
}

function exitHangar(): void {
  if (!inHangar) return;
  inHangar = false;
  hangarDemo = false;
  hangarSpin = false;
  document.body.classList.remove('in-hangar');
  hangar.close();
  pilotCam.orbit = null;
  heliMesh.highlight(null);
  heliMesh.setExplode(0);
  heliMesh.setCanopy(true);
  heliMesh.spinOverride = null;
  sim.reset();
}

/** Select a part: glow it, fade the rest and swing the camera to it. */
function selectPart(id: string | null): void {
  hangar.select(id);
  heliMesh.highlight(id, hoverPart);
  if (!pilotCam.orbit) return;
  const R = sim.model.rotor.radius;
  if (id) {
    const box = new THREE.Box3();
    for (const m of heliMesh.parts.get(id)?.meshes ?? []) box.expandByObject(m);
    const size = box.getSize(new THREE.Vector3()).length();
    pilotCam.orbit.target.copy(box.getCenter(new THREE.Vector3()));
    pilotCam.orbit.distance = THREE.MathUtils.clamp(size * 2.2, R * 0.45, R * 3);
  } else {
    const p = sim.state.pos;
    pilotCam.orbit.target.set(p.x, p.y + 0.03 * (R / 0.36), p.z);
    pilotCam.orbit.distance = R * 2.6;
  }
}

function pickPart(clientX: number, clientY: number): string | null {
  const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, pilotCam.camera);
  raycaster.layers.enableAll();
  for (const hit of raycaster.intersectObjects(heliMesh.pickables(), false)) {
    const id = hit.object.userData.part as string | undefined;
    if (!id || !hangar.has(id)) continue;
    // Skip parts faded out behind the selection so you can click through them.
    const mat = (hit.object as THREE.Mesh).material as THREE.Material;
    if (hangar.selected && id !== hangar.selected && mat.opacity < 0.5) continue;
    return id;
  }
  return null;
}

{
  // Orbit with drag, zoom with wheel or pinch, click to pick.
  const el = renderer.domElement;
  const pointers = new Map<number, { x: number; y: number }>();
  let dragged = false;
  let pinch = 0;
  el.addEventListener('pointerdown', (e) => {
    if (!inHangar) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragged = false;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!inHangar || !pilotCam.orbit) return;
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      const h = pickPart(e.clientX, e.clientY);
      if (h !== hoverPart) {
        hoverPart = h;
        heliMesh.highlight(hangar.selected, hoverPart);
        el.style.cursor = h ? 'pointer' : 'grab';
      }
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) pilotCam.orbit.distance = THREE.MathUtils.clamp(pilotCam.orbit.distance * (pinch / d), 0.08, 6);
      pinch = d;
      return;
    }
    pilotCam.orbit.yaw -= dx * 0.008;
    pilotCam.orbit.pitch = THREE.MathUtils.clamp(pilotCam.orbit.pitch + dy * 0.006, -0.35, 1.45);
  });
  const up = (e: PointerEvent) => {
    if (!inHangar) return;
    const had = pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (had && !dragged && e.type === 'pointerup') {
      const id = pickPart(e.clientX, e.clientY);
      selectPart(id === hangar.selected ? null : id);
    }
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => {
    if (!inHangar || !pilotCam.orbit) return;
    e.preventDefault();
    pilotCam.orbit.distance = THREE.MathUtils.clamp(pilotCam.orbit.distance * Math.exp(e.deltaY * 0.0012), 0.08, 6);
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyG') (inHangar ? exitHangar : enterHangar)();
    if (e.code === 'Escape' && inHangar) exitHangar();
  });
}

const deg = (r: number) => `${r >= 0 ? '+' : '−'}${Math.abs((r * 180) / Math.PI).toFixed(1)}°`;
const projected = new THREE.Vector3();

/** In the hangar the sim is not stepped: the sticks drive the servos directly, like a bench test with the motor unplugged. */
function updateHangar(dt: number, ctl: ReturnType<typeof input.poll>): void {
  const m = sim.model;
  const s = sim.state;
  let c = { collective: ctl.collective, elevator: ctl.elevator, aileron: ctl.aileron, rudder: ctl.rudder };
  let mode = ctl.flightMode;
  if (hangarDemo) {
    demoT += dt;
    const STEP = 3.6;
    const i = Math.floor(demoT / STEP) % DEMO.length;
    const f = (demoT % STEP) / STEP;
    const env = Math.sin(Math.min(1, f / 0.35) * Math.PI * 0.5) * (f > 0.8 ? 1 - (f - 0.8) / 0.2 : 1);
    const st = DEMO[i];
    c = { collective: st.collective * env, elevator: st.elevator * env, aileron: st.aileron * env, rudder: st.rudder * env };
    mode = 1; // Idle-Up curve: symmetric pitch so collective shows both ways
    hangar.setDemoCaption(st.caption);
    const part = hangar.has(st.part) ? st.part : 'swashplate';
    if (hangar.selected !== part) selectPart(part);
  }
  s.servoCollective = pitchFromCurve(m.pitchCurves[mode], c.collective);
  s.servoCycPitch = -c.elevator * m.maxCyclic;
  s.servoCycRoll = c.aileron * m.maxCyclic;
  s.servoTail = c.rudder * m.maxTailPitch * 0.8;
  s.fbA = s.servoCycPitch;
  s.fbB = s.servoCycRoll;
  s.a1 = s.b1 = 0;
  hangar.setReadout(`Blade pitch: collective <b>${deg(s.servoCollective)}</b> · cyclic fore/aft <b>${deg(-s.servoCycPitch)}</b> · left/right <b>${deg(s.servoCycRoll)}</b> · tail <b>${deg(s.servoTail)}</b>`);
  const id = hoverPart ?? hangar.selected;
  if (id) {
    heliMesh.partCentre(id, projected).project(pilotCam.camera);
    const vis = projected.z < 1;
    hangar.placeLabel(vis ? ((projected.x + 1) / 2) * window.innerWidth : null, ((1 - projected.y) / 2) * window.innerHeight, hangar.nameOf(id));
  } else hangar.placeLabel(null, 0, '');
}

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
  if (q.get('hangar') !== null) {
    // After start-up (the pause state and loop are defined further down).
    setTimeout(() => {
      enterHangar();
      const part = q.get('hangar');
      if (part) selectPart(part);
    }, 0);
  }
  const lessonId = q.get('lesson');
  if (lessonId) startLesson(lessonId, q.get('mode') === 'teach' ? 'teach' : 'show');
  const panel = q.get('panel');
  if (panel === 'pilot' || panel === 'rankings' || panel === 'challenges') challenges.open(panel);
}

// Exposed for automated checks and tinkering from the devtools console.
(window as unknown as { rcHeli: unknown }).rcHeli = {
  env, setGraphics, getHeliMesh: () => heliMesh, enterHangar, exitHangar, selectPart,
  setModelById: (id: string) => setModel(HELI_MODELS.find((m) => m.id === id) ?? sim.model),
  /** Orbit the camera around the model (yaw/pitch rad, distance m); handy for screenshots of the model. */
  inspect(yaw: number, pitch: number, distance: number, dy = 0.03): void {
    const p = sim.state.pos;
    pilotCam.beginOrbit(new THREE.Vector3(p.x, p.y + dy, p.z), yaw, pitch, distance);
  },
  sim, input, wind, audio, camera: pilotCam, clouds, world, layout, tracker, flightTimer, profile, challengesList: CHALLENGES };

function reset(): void {
  if (lesson) stopLesson();
  sim.reset();
  tracker.resetTransient();
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') reset();
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
  if (moved > 8 || !quick || inHangar) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, pilotCam.camera);
  const hit = raycaster.intersectObjects(billboards.panels, false)[0];
  const ad = hit?.object.userData.billboard as { url: string } | undefined;
  if (ad) window.open(ad.url, '_blank', 'noopener');
});
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  post?.setSize(window.innerWidth, window.innerHeight);
  pilotCam.resize(window.innerWidth / window.innerHeight);
});

// Fixed-timestep physics driven by the render clock. Simulation time never runs ahead of wall time,
// and a hitch (tab switch) is capped so the heli does not teleport.
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
  const dt = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  let ctl = input.poll(dt);
  if (lesson && lesson.mode === 'teach') {
    // The player flies; the runner judges the step and computes the ghost-stick hint.
    lesson.coach(dt, ctl);
    lessonOverlay.update(lesson, ctl, lesson.hint);
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
    if (lastMode !== -1) hud.notify(`<b>${['Normal', 'Idle-Up 1', 'Idle-Up 2'][ctl.flightMode]}</b><br>${MODE_HELP[ctl.flightMode].replace(/^[^:]+: /, '')}`);
    lastMode = ctl.flightMode;
  }
  if (ctl.throttleHold !== lastHold) {
    hud.notify(`<b>Throttle hold ${ctl.throttleHold ? 'ON' : 'off'}</b><br>${(ctl.throttleHold ? HOLD_HELP.on : HOLD_HELP.off).replace(/^[^:]+: /, '')}`);
    lastHold = ctl.throttleHold;
  }

  if (inHangar) updateHangar(dt, ctl);
  else if (!paused) {
    accumulator += dt;
    while (accumulator >= PHYSICS_DT) {
      sim.step(ctl, PHYSICS_DT);
      accumulator -= PHYSICS_DT;
    }
  }

  heliMesh.update(sim.state, paused ? 0 : dt);
  target.set(sim.state.pos.x, sim.state.pos.y, sim.state.pos.z);
  heliQuat.set(sim.state.ori.x, sim.state.ori.y, sim.state.ori.z, sim.state.ori.w);
  pilotCam.update(target, heliQuat, dt);
  const w = wind.at(sim.state.pos, sim.state.time);
  driftClouds(clouds, dt, w.x, w.z);
  updateWash(sim, paused ? 0 : dt, w.x, w.z);
  env.followHeli(target, sim.model.rotor.radius);
  spray.update(paused ? 0 : dt, renderer.domElement.height, pilotCam.camera.fov);
  field.pilot.visible = pilotCam.orbit !== null || pilotCam.mode !== 'pilot';
  // Windsock points downwind and droops when it is calm; animals graze.
  const windAngle = Math.atan2(-w.x, -w.z);
  field.windsock.rotation.set(-(1 - Math.min(1, wind.speed / 6)) * 1.2, windAngle + Math.PI, 0, 'YXZ');
  field.animate(dt, sim.state.time);

  if (!paused && !inHangar && (!lesson || lesson.mode === 'teach')) {
    flightTimer.update(sim, dt);
    tracker.update(sim, dt, flightTimer.flying ? flightTimer.airTime : 0);
  }
  gates.update([tracker.nextGate('circuit'), tracker.nextGate('figure-eight')], [tracker.completed.has('circuit'), tracker.completed.has('figure-eight')]);
  challenges.tick();
  hud.update(sim, ctl, input.active.label, input.active.id, dt);
  audio.update(sim, pilotCam.eye, wind.speed);
  settings.tick();
  env.bakeStaticShadow(pilotCam.camera, [heliMesh.root, spray.points]);
  if (post) post.render(dt);
  else renderer.render(scene, pilotCam.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
