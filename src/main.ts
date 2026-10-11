import * as THREE from 'three';
import './style.css';
import { createScene } from './render/scene';
import { HeliMesh } from './render/heli-mesh';
import { PilotCamera, CAMERA_LABELS } from './render/camera';
import { createClouds, driftClouds } from './render/clouds';
import { HelicopterSim, PHYSICS_DT } from './sim/physics';
import { HELI_MODELS } from './sim/heli-model';
import { Wind } from './sim/wind';
import { InputManager } from './input/manager';
import { Hud } from './ui/hud';
import { SettingsPanel } from './ui/settings';
import { AudioEngine } from './audio/engine';
import { HelpPanel } from './ui/help';

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

const { scene, sun } = createScene();
const clouds = createClouds();
scene.add(clouds);
const pilotCam = new PilotCamera(window.innerWidth / window.innerHeight);

const wind = new Wind();
const sim = new HelicopterSim(HELI_MODELS[0], wind);
let heliMesh = new HeliMesh(sim.model);
scene.add(heliMesh.root);

const ui = document.getElementById('ui')!;
const audio = new AudioEngine();
// Browsers only allow audio after a user gesture; any key, click or touch unlocks it.
for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, () => audio.start(), { passive: true });
const input = new InputManager(ui);
const hud = new Hud(ui);
const help = new HelpPanel(ui);
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
  onCamera(mode) {
    if (mode) pilotCam.mode = mode;
    else pilotCam.cycle();
    return CAMERA_LABELS[pilotCam.mode];
  },
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyC') settings.cycleCamera();
});

// Exposed for automated checks and tinkering from the devtools console.
(window as unknown as { rcHeli: unknown }).rcHeli = { sim, input, wind, audio, camera: pilotCam, clouds };

function reset(): void {
  sim.reset();
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') reset();
});
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  pilotCam.resize(window.innerWidth / window.innerHeight);
});

// Fixed-timestep physics driven by the render clock. Simulation time never runs ahead of wall time,
// and a hitch (tab switch) is capped so the heli does not teleport.
let last = performance.now();
let accumulator = 0;
const target = new THREE.Vector3();
const heliQuat = new THREE.Quaternion();
const MAX_FRAME = 0.1;

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  const ctl = input.poll(dt);
  settings.reflect(ctl.flightMode, ctl.throttleHold);

  accumulator += dt;
  while (accumulator >= PHYSICS_DT) {
    sim.step(ctl, PHYSICS_DT);
    accumulator -= PHYSICS_DT;
  }

  heliMesh.update(sim.state, dt);
  target.set(sim.state.pos.x, sim.state.pos.y, sim.state.pos.z);
  heliQuat.set(sim.state.ori.x, sim.state.ori.y, sim.state.ori.z, sim.state.ori.w);
  pilotCam.update(target, heliQuat, dt);
  const w = wind.at(sim.state.pos, sim.state.time);
  driftClouds(clouds, dt, w.x, w.z);
  // Keep the shadow frustum centred on the model so shadows stay crisp anywhere on the field.
  sun.target.position.copy(target);
  sun.position.set(target.x - 40, 70, target.z - 30);

  hud.update(sim, ctl, input.active.label, input.active.id, dt);
  audio.update(sim, pilotCam.eye, wind.speed);
  settings.tick();
  renderer.render(scene, pilotCam.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
