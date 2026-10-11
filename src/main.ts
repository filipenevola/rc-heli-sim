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
import { buildField } from './sim/world';
import { InputManager } from './input/manager';
import { Hud } from './ui/hud';
import { SettingsPanel, MODE_HELP, HOLD_HELP } from './ui/settings';
import { AudioEngine } from './audio/engine';
import { HelpPanel } from './ui/help';
import { ChallengeTracker, FlightTimer, CHALLENGES } from './game/challenges';
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
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

const { layout, world } = buildField();
const field = createScene(layout);
const { scene } = field;
const clouds = createClouds();
scene.add(clouds);
const billboards = createBillboards();
scene.add(billboards.group);
const gates = new GateMeshes();
scene.add(gates.group);
const pilotCam = new PilotCamera(window.innerWidth / window.innerHeight);

const wind = new Wind();
const sim = new HelicopterSim(HELI_MODELS[0], wind, world);
let heliMesh = new HeliMesh(sim.model);
scene.add(heliMesh.root);

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
const lessonOverlay = new LessonOverlay(ui);
const challenges = new ChallengesPanel(ui, profile, tracker, flightTimer, rankingClient, startLesson);

/** "Teach me": a demo pilot flies the challenge on the real physics while the overlay shows the sticks. */
function startLesson(challengeId: string, mode: 'show' | 'teach' = 'show'): void {
  const l = lessonFor(challengeId);
  if (!l) return;
  stopLesson();
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
  if (resetHeli) {
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
    scene.remove(heliMesh.root);
    sim.reset(model);
    heliMesh = new HeliMesh(model);
    scene.add(heliMesh.root);
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
(window as unknown as { rcHeli: unknown }).rcHeli = { sim, input, wind, audio, camera: pilotCam, clouds, world, layout, tracker, flightTimer, profile, challengesList: CHALLENGES };

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
  if (moved > 8 || !quick) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, pilotCam.camera);
  const hit = raycaster.intersectObjects(billboards.panels, false)[0];
  const ad = hit?.object.userData.billboard as { url: string } | undefined;
  if (ad) window.open(ad.url, '_blank', 'noopener');
});
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
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

  if (!paused) {
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
  // Windsock points downwind and droops when it is calm; animals graze.
  const windAngle = Math.atan2(-w.x, -w.z);
  field.windsock.rotation.set(-(1 - Math.min(1, wind.speed / 6)) * 1.2, windAngle + Math.PI, 0, 'YXZ');
  field.animate(dt, sim.state.time);

  if (!paused && (!lesson || lesson.mode === 'teach')) {
    flightTimer.update(sim, dt);
    tracker.update(sim, dt, flightTimer.flying ? flightTimer.airTime : 0);
  }
  gates.update([tracker.nextGate('circuit'), tracker.nextGate('figure-eight')], [tracker.completed.has('circuit'), tracker.completed.has('figure-eight')]);
  challenges.tick();
  hud.update(sim, ctl, input.active.label, input.active.id, dt);
  audio.update(sim, pilotCam.eye, wind.speed);
  settings.tick();
  renderer.render(scene, pilotCam.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
