import type { HelicopterSim } from '../sim/physics';
import type { V3 } from '../sim/math';

const SPEED_OF_SOUND = 343;

/**
 * Procedural sound, no samples. Everything is synthesised from the simulation state so the sound
 * tells you what the model is doing, like it does at the field:
 *  - brushless motor whine: harmonic of the motor shaft speed (head speed x gear ratio), louder with power
 *  - main rotor: broadband noise chopped at the blade-pass frequency (2 blades x rpm / 60), louder with thrust
 *  - tail rotor: higher-pitched whine at tail-blade-pass frequency, louder with tail thrust
 *  - wind: filtered noise from the wind setting plus the model's own airspeed
 *  - distance attenuation and Doppler from the pilot's position
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private motorOsc!: OscillatorNode;
  private motorOsc2!: OscillatorNode;
  private motorGain!: GainNode;
  private motorFilter!: BiquadFilterNode;
  private rotorNoiseGain!: GainNode;
  private rotorChop!: OscillatorNode;
  private rotorChopDepth!: GainNode;
  private rotorFilter!: BiquadFilterNode;
  private tailOsc!: OscillatorNode;
  private tailGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private heliBus!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private crashedBefore = false;
  private started = false;
  muted = false;
  volume = 0.8;

  /** Must be called from a user gesture (browsers block audio before one). Safe to call repeatedly. */
  start(): void {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.started = true;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    this.noiseBuffer = makeNoise(ctx, 2);

    // Everything that comes from the helicopter goes through one bus for distance attenuation.
    this.heliBus = ctx.createGain();
    this.heliBus.gain.value = 0;
    this.heliBus.connect(this.master);

    // Motor: two detuned sawtooths through a resonant lowpass. Brushless whine is mostly the
    // commutation harmonics, so the fundamental is motor rpm x pole pairs / 60.
    this.motorOsc = ctx.createOscillator();
    this.motorOsc.type = 'sawtooth';
    this.motorOsc2 = ctx.createOscillator();
    this.motorOsc2.type = 'square';
    this.motorFilter = ctx.createBiquadFilter();
    this.motorFilter.type = 'lowpass';
    this.motorFilter.Q.value = 2;
    this.motorFilter.frequency.value = 800;
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    const motor2Gain = ctx.createGain();
    motor2Gain.gain.value = 0.25;
    this.motorOsc.connect(this.motorFilter);
    this.motorOsc2.connect(motor2Gain).connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain).connect(this.heliBus);

    // Main rotor: noise -> bandpass -> amplitude modulated by the blade-pass frequency.
    const rotorNoise = ctx.createBufferSource();
    rotorNoise.buffer = this.noiseBuffer;
    rotorNoise.loop = true;
    this.rotorFilter = ctx.createBiquadFilter();
    this.rotorFilter.type = 'bandpass';
    this.rotorFilter.frequency.value = 250;
    this.rotorFilter.Q.value = 0.7;
    const chopGain = ctx.createGain(); // modulated gain
    chopGain.gain.value = 0.5;
    this.rotorChop = ctx.createOscillator();
    this.rotorChop.type = 'sine';
    this.rotorChopDepth = ctx.createGain();
    this.rotorChopDepth.gain.value = 0.5;
    this.rotorChop.connect(this.rotorChopDepth).connect(chopGain.gain);
    this.rotorNoiseGain = ctx.createGain();
    this.rotorNoiseGain.gain.value = 0;
    rotorNoise.connect(this.rotorFilter).connect(chopGain).connect(this.rotorNoiseGain).connect(this.heliBus);
    rotorNoise.start();

    // Tail rotor whine.
    this.tailOsc = ctx.createOscillator();
    this.tailOsc.type = 'triangle';
    this.tailGain = ctx.createGain();
    this.tailGain.gain.value = 0;
    const tailFilter = ctx.createBiquadFilter();
    tailFilter.type = 'bandpass';
    tailFilter.frequency.value = 1800;
    tailFilter.Q.value = 1.5;
    this.tailOsc.connect(tailFilter).connect(this.tailGain).connect(this.heliBus);

    // Wind: noise through a slowly wandering lowpass, heard at the pilot's ears (not attenuated by distance).
    const windNoise = ctx.createBufferSource();
    windNoise.buffer = this.noiseBuffer;
    windNoise.loop = true;
    windNoise.playbackRate.value = 0.7;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 300;
    this.windFilter.Q.value = 0.5;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windNoise.connect(this.windFilter).connect(this.windGain).connect(this.master);
    windNoise.start();

    this.motorOsc.start();
    this.motorOsc2.start();
    this.rotorChop.start();
    this.tailOsc.start();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (!this.muted && this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  update(sim: HelicopterSim, pilotEye: V3, windSpeed: number): void {
    if (!this.ctx || !this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = sim.state;
    const m = sim.model;
    const tel = sim.telemetry;
    const tau = 0.03;

    // Geometry: distance and radial velocity for attenuation and Doppler.
    const dx = s.pos.x - pilotEye.x;
    const dy = s.pos.y - pilotEye.y;
    const dz = s.pos.z - pilotEye.z;
    const dist = Math.max(1, Math.hypot(dx, dy, dz));
    const radialVel = (s.vel.x * dx + s.vel.y * dy + s.vel.z * dz) / dist; // positive = moving away
    const doppler = SPEED_OF_SOUND / Math.max(50, SPEED_OF_SOUND + radialVel);
    // Inverse-distance with a gentle floor so a far-away model is still audible, like at the field.
    const atten = Math.min(1, 6 / dist) * 0.9 + 0.05;
    this.heliBus.gain.setTargetAtTime(atten, t, tau);

    const rpm = tel.headspeedRpm;
    const rpmFrac = Math.min(1, rpm / ((m.headspeeds[1] * 60) / (2 * Math.PI)));

    // Motor: assume ~10 pole-pair outrunner on a 10:1 (450) or 8:1 (700) pinion ratio. The exact value only sets the pitch.
    const gear = m.rotor.radius > 0.6 ? 8.5 : 11;
    const motorHz = Math.max(1, (rpm * gear * 7) / 60) * doppler;
    this.motorOsc.frequency.setTargetAtTime(Math.min(motorHz, 6000), t, tau);
    this.motorOsc2.frequency.setTargetAtTime(Math.min(motorHz * 0.5, 3000), t, tau);
    const powerFrac = Math.min(1, tel.motorPower / (m.maxMotorTorque * m.headspeeds[2] * 0.5));
    this.motorFilter.frequency.setTargetAtTime(600 + 2500 * powerFrac + 1500 * rpmFrac, t, tau);
    this.motorGain.gain.setTargetAtTime(rpmFrac > 0.02 ? 0.06 + 0.14 * powerFrac : 0, t, tau);

    // Main rotor chop: blade-pass frequency; depth and level grow with thrust (loaded blades slap harder).
    const bladePass = Math.max(0.5, (rpm * m.rotor.blades) / 60) * doppler;
    this.rotorChop.frequency.setTargetAtTime(bladePass, t, tau);
    const thrustFrac = Math.min(1.5, tel.thrust / (m.mass * 9.81));
    this.rotorFilter.frequency.setTargetAtTime(150 + 250 * rpmFrac + 200 * thrustFrac, t, tau);
    this.rotorChopDepth.gain.setTargetAtTime(0.3 + 0.4 * thrustFrac, t, tau);
    this.rotorNoiseGain.gain.setTargetAtTime(rpmFrac * (0.25 + 0.45 * thrustFrac), t, tau);

    // Tail rotor whine.
    const tailHz = Math.max(1, (rpm * m.tailGearRatio * m.tail.blades) / 60) * doppler;
    this.tailOsc.frequency.setTargetAtTime(Math.min(tailHz, 5000), t, tau);
    const tailFrac = Math.min(1, Math.abs(tel.tailThrust) / (m.mass * 2));
    this.tailGain.gain.setTargetAtTime(rpmFrac * (0.015 + 0.05 * tailFrac), t, tau);

    // Wind at the pilot plus the rush of the model's own airspeed (audible when it flies past fast).
    const airspeed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
    const windLevel = Math.min(1, windSpeed / 10) * 0.5 + Math.min(1, airspeed / 30) * 0.35 * atten;
    const gust = 1 + 0.25 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1);
    this.windGain.gain.setTargetAtTime(windLevel * gust, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(200 + 500 * windLevel + 150 * Math.sin(t * 0.6), t, 0.2);

    if (s.crashed && !this.crashedBefore) this.crashThump();
    this.crashedBefore = s.crashed;
  }

  private crashThump(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.8);
  }
}

function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Pink-ish noise (Paul Kellet's filter) sounds less harsh than white for rotor wash and wind.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buf;
}
