# RC Heli Sim

A browser-based **RC helicopter (modelism) flight simulator**, built to practice on before flying the real
model. Not a full-scale aircraft sim: the physics, sizes, head speeds, pitch curves, gyro behaviour and the
pilot-on-the-field camera are all about model helicopters.

**Play:** https://filipenevola.github.io/rc-heli-sim/ (deployed from `main` by GitHub Actions)

## What it does today

- **Physics first.** 1 kHz fixed-step rigid body with a blade-element + momentum-theory main rotor
  (Glauert inflow solved by Newton iteration), first-order tip-path-plane flapping with hub stiffness,
  flap-back with airspeed, translational lift, ground effect (Cheeseman–Bennett), tail rotor with its own
  inflow (so yaw rate and sideways drift change tail thrust the way they really do), torque reaction,
  rotor inertia with a governor and soft start, autorotation (torque goes negative in descent), fuselage
  drag, fin/stabiliser weathervaning, skid contacts with friction, blade strike and hard-contact crashes.
- **Controllers like the real gear.** Flybarless unit in rate mode (PI + feed-forward on body rates) and a
  heading-hold tail gyro, or a mechanical Bell-Hiller flybar model for the trainer.
- **Three models:** 450 flybar trainer, 450 flybarless, 700 3D flybarless.
- **Flight modes:** Normal (throttle curve spools down at low stick), Idle-Up 1/2 (symmetric pitch, fixed
  head speed), Throttle Hold.
- **Inputs, all mapped to one `ControlFrame` abstraction:**
  - **Real transmitter** through a USB simulator dongle/cable (Spektrum WS2000, FrSky, "22-in-1" cables,
    etc.). They show up as HID joysticks, which the browser reads with the Gamepad API. A mapping wizard
    assigns and calibrates axes per dongle and remembers them.
  - **Touch screen** sticks that behave like transmitter gimbals (ratcheted throttle, modes 1–4).
  - **Keyboard** (arrows = cyclic, W/S = collective, A/D = rudder, 1/2/3 = flight mode, H = hold, R = reset).
- **Pilot's-eye camera** standing on the field with auto-zoom, exactly like the sims you learned on.
- **Procedural sound** (Web Audio, no samples): motor whine that follows head speed and power, main-rotor blade chop at the blade-pass frequency, tail-rotor whine, wind and airspeed rush, distance attenuation and Doppler from the pilot's position, crash thump. M mutes.
- Expo, dual rates, wind with gusts, HUD with head speed / collective / power / ground effect.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # physics regression tests (hover trim, control signs, autorotation, crashes)
npm run build
```

## Technology choice

Hard requirement: run in the browser with nothing to install. The stack is:

| Piece | Choice | Why |
| --- | --- | --- |
| Rendering | three.js (WebGL2, WebGPU-ready) | Lightest mature 3D library; falls back cleanly on phones. |
| Physics | Hand-written TypeScript, fixed 1 kHz step | Rotorcraft dynamics are not in any general physics engine anyway; a single rigid body + rotor equations is cheap, so WebAssembly buys nothing yet. The `src/sim` folder has zero DOM/three.js dependencies so it can move to a Worker or Rust/wasm later without touching the rest. |
| Input | Gamepad API, Pointer Events, keyboard | Sim dongles are plain HID joysticks; no WebHID or drivers needed. |
| Build | Vite + TypeScript, Vitest | Fast, boring, static output for GitHub Pages. |

WebAssembly was evaluated and rejected for now: Bevy/Rust-to-wasm toolchains add megabytes and a slow
iteration loop, and the simulation cost here is dominated by rendering, not physics.

## Physics model notes

The rotor model follows the standard rotorcraft texts (Johnson, Leishman, Padfield):

- Thrust coefficient `C_T = (σ a / 2) [θ (1/3 + μ²/2) − λ/2] · η` with uniform inflow
  `λ = λ_i + λ_c`, `λ_i = C_T / (2 √(μ² + λ²))`.
- Torque `C_Q = λ C_T + σ c_d0 (1 + 4.6 μ²) / 8`; the first term goes negative in descent, which is what
  lets you practise autorotations.
- Tip-path plane: `τ_f ȧ1 = (a1_cmd + a1_speed − a1) − τ_f q`, `τ_f = 16 / (γ Ω)` with the Lock number γ.
  Hub moment `= (K_β + T h) · tilt`.
- Ground effect `T_IGE / T_OGE = 1 / (1 − (R / 4z)²)`, capped.

Parameters live in `src/sim/heli-model.ts` and are deliberately editable: mass, inertia, radius, chord,
Lock number, hub stiffness, head speeds, pitch curves, gyro gains. Calibrating them against your own
helicopters is the main realism lever; see the test file for the quantities that are pinned.

## Roadmap

- [ ] Scenery with photo-realistic skybox and a proper flying site; model skins.
- [ ] Sampled sound layer (real nitro / electric recordings) on top of the synth.
- [ ] Training aids: hover box, orientation drills, nose-in trainer, replay.
- [ ] Vortex-ring-state model and blade stall at high collective.
- [ ] Multi-blade heads, collective-pitch coaxial trainers.
- [ ] WebHID path for dongles that are not exposed as gamepads; Bluetooth transmitters.
- [ ] Optional Rust/wasm physics core in a Worker.

## Origins

Inspired by the CD-ROM era RC sims (Reflex XTR, FMS, Phoenix, Aerofly). None of their code is used; this
is a clean-room implementation from published rotor theory and open literature.

## License

MIT
