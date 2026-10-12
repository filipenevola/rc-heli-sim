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
  private stallOsc!: OscillatorNode;
  private stallGain!: GainNode;
  private beepGain!: GainNode;
  private nextBeep = 0;
  private nextChirp = 0;
  private ambience!: GainNode;
  private crashedBefore = false;
  private started = false;
  muted = false;
  paused = false;
  volume = 0.8;

  /** Must be called from a user gesture (browsers block audio before one). Safe to call repeatedly. */
  /** Resume the context if the browser suspended or interrupted it (background tab, phone call, iOS lock). */
  resume(): void {
    const st = this.ctx?.state as string | undefined;
    if (this.ctx && st && st !== 'running' && st !== 'closed') void this.ctx.resume();
  }

  start(): void {
    if (this.started) {
      this.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.started = true;

    this.master = ctx.createGain();
    this.master.gain.value = this.effectiveGain();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.resume();
    });
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

    // Blade stall: a rough low buzz at the blade-pass frequency, only when the physics reports separated flow.
    this.stallOsc = ctx.createOscillator();
    this.stallOsc.type = 'square';
    const stallFilter = ctx.createBiquadFilter();
    stallFilter.type = 'lowpass';
    stallFilter.frequency.value = 400;
    this.stallGain = ctx.createGain();
    this.stallGain.gain.value = 0;
    this.stallOsc.connect(stallFilter).connect(this.stallGain).connect(this.heliBus);
    this.stallOsc.start();

    // Radio-style low-battery alarm, heard at the pilot (not from the heli).
    const beep = ctx.createOscillator();
    beep.type = 'sine';
    beep.frequency.value = 2200;
    this.beepGain = ctx.createGain();
    this.beepGain.gain.value = 0;
    beep.connect(this.beepGain).connect(this.master);
    beep.start();

    // Field ambience at the pilot: a soft rustle bed; birds are synthesised on the fly.
    const amb = ctx.createBufferSource();
    amb.buffer = this.noiseBuffer;
    amb.loop = true;
    amb.playbackRate.value = 0.5;
    const ambF = ctx.createBiquadFilter();
    ambF.type = 'bandpass';
    ambF.frequency.value = 900;
    ambF.Q.value = 0.4;
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.012;
    amb.connect(ambF).connect(this.ambience).connect(this.master);
    amb.start();

    this.motorOsc.start();
    this.motorOsc2.start();
    this.rotorChop.start();
    this.tailOsc.start();
  }

  private effectiveGain(): number {
    return this.muted || this.paused ? 0 : this.volume;
  }

  private applyGain(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.effectiveGain(), this.ctx.currentTime, 0.05);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  /** Pause silences everything (rotor, wind) without touching the mute setting; resume restores it. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyGain();
    if (!paused) this.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyGain();
  }

  update(sim: HelicopterSim, pilotEye: V3, windSpeed: number): void {
    if (!this.ctx || !this.started || this.paused) return;
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
    // High G (pulling hard, aerobatics) and vortex ring state make the chop harsher and rougher.
    const bladePass = Math.max(0.5, (rpm * m.rotor.blades) / 60) * doppler;
    this.rotorChop.frequency.setTargetAtTime(bladePass, t, tau);
    const thrustFrac = Math.min(2.5, Math.abs(tel.thrust) / (m.mass * 9.81));
    const slap = Math.max(0, thrustFrac - 1.2); // blade slap beyond ~1.2 g
    const rough = tel.vrs * (0.6 + 0.4 * Math.sin(t * 13.7) * Math.sin(t * 5.1));
    this.rotorFilter.frequency.setTargetAtTime(150 + 250 * rpmFrac + 200 * thrustFrac + 400 * slap, t, tau);
    this.rotorChopDepth.gain.setTargetAtTime(Math.min(0.95, 0.3 + 0.4 * thrustFrac + 0.3 * slap + 0.3 * rough), t, tau);
    this.rotorNoiseGain.gain.setTargetAtTime(rpmFrac * (0.25 + 0.45 * thrustFrac + 0.25 * rough), t, tau);
    // Stall buzz.
    this.stallOsc.frequency.setTargetAtTime(bladePass * 2, t, tau);
    this.stallGain.gain.setTargetAtTime(rpmFrac * tel.stall * 0.08, t, tau);

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

    // Birds: a short frequency-swept chirp every few seconds, quieter when the heli is loud nearby.
    if (t > this.nextChirp) {
      this.nextChirp = t + 2.5 + Math.random() * 6;
      const o = ctx.createOscillator();
      o.type = 'sine';
      const g = ctx.createGain();
      const f0 = 2200 + Math.random() * 1800;
      const n = 2 + Math.floor(Math.random() * 3);
      o.connect(g).connect(this.master);
      const loud = Math.min(1, rpmFrac * atten);
      const vol = 0.05 * (1 - 0.7 * loud);
      for (let i = 0; i < n; i++) {
        const ts = t + i * 0.16;
        o.frequency.setValueAtTime(f0, ts);
        o.frequency.exponentialRampToValueAtTime(f0 * 1.6, ts + 0.06);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.9, ts + 0.13);
        g.gain.setValueAtTime(0, ts);
        g.gain.linearRampToValueAtTime(vol, ts + 0.02);
        g.gain.linearRampToValueAtTime(0, ts + 0.14);
      }
      o.start(t);
      o.stop(t + n * 0.16 + 0.05);
    }
    this.ambience.gain.setTargetAtTime(0.012 + 0.01 * Math.min(1, windSpeed / 8), t, 0.5);
    // Low battery: double beep every 2 s under 10%, continuous fast beeps at 0% (the radio's timer alarm style).
    if (tel.battery < 0.1 && rpmFrac > 0.1) {
      if (t > this.nextBeep) {
        const period = tel.battery <= 0 ? 0.5 : 2;
        this.nextBeep = t + period;
        for (const off of [0, 0.15]) {
          this.beepGain.gain.setValueAtTime(0.12, t + off);
          this.beepGain.gain.setValueAtTime(0, t + off + 0.08);
        }
      }
    }
    if (s.crashed && !this.crashedBefore) this.crashThump(s.crashReason);
    this.crashedBefore = s.crashed;
  }

  /** Crash sounds by cause: blades (a sharp crack, then bits), the frame (a dull thump), a boom strike (crack + thump). */
  private crashThump(reason: string): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const blades = /blade|boom/i.test(reason);
    const frame = !/^blade/i.test(reason) || /boom/i.test(reason);
    if (blades) {
      // Crack: short bright noise burst.
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.8, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      src.connect(f).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + 0.25);
      // Debris: a few quieter clicks.
      for (const off of [0.25, 0.4, 0.62]) {
        const d = ctx.createBufferSource();
        d.buffer = this.noiseBuffer;
        const dg = ctx.createGain();
        dg.gain.setValueAtTime(0.25, t + off);
        dg.gain.exponentialRampToValueAtTime(0.001, t + off + 0.08);
        d.connect(dg).connect(this.master);
        d.start(t + off);
        d.stop(t + off + 0.1);
      }
    }
    if (frame) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9, t + (blades ? 0.08 : 0));
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      src.connect(f).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + 0.8);
    }
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
