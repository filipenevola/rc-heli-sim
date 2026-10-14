# RC Heli Sim

A browser-based **RC helicopter (modelism) flight simulator**, built to practice on before flying the real
model. Not a full-scale aircraft sim: the physics, sizes, head speeds, pitch curves, gyro behaviour and the
pilot-on-the-field camera are all about model helicopters.

**Play:** https://heli.filipenevola.com (the old filipenevola.github.io/rc-heli-sim link redirects there)

## What it does today

- **Physics first.** 1 kHz fixed-step rigid body with a blade-element + momentum-theory main rotor
  (Glauert inflow solved by Newton iteration, dynamic-inflow lag), first-order tip-path-plane flapping with
  hub stiffness, flap-back with airspeed, translational lift, ground effect (Cheeseman–Bennett), blade stall,
  vortex ring state, the main-rotor wake skewing onto the tail (transition bump, tail-thrust loss band), tail
  rotor with its own inflow, torque reaction, rotor inertia with a governor and soft start (or an open-loop
  throttle curve that droops), battery sag and cut-off, autorotation (torque goes negative in descent),
  fuselage drag, fin/stabiliser weathervaning, directional skid friction, world collisions (houses, trees,
  platforms), blade strike, boom strike on flybar heads, and skids that fold above about 2.8 m/s of sink.
  Real terrain on the hillside (contacts follow the slope: slope landings, dynamic rollover named as such,
  wind upwash on the windward face). The torque reaction follows the one-way bearing (none in autorotation).
  Emergencies: tail rotor failure on demand or at random; a lean nitro needle overheats and quits.
- **Controllers like the real gear.** Flybarless unit in rate mode (PI + feed-forward on body rates), a
  heading-hold tail gyro with the sensor filter, servo slew and delay that make too much gain wag the tail
  (or a plain rate gyro), a mechanical Bell-Hiller flybar for the trainer, and an attitude assist for beginners.
- **Models:** 450 flybar trainer, 450 flybarless, 700 3D flybarless, 250 micro, plus **your own helicopter**
  built from the numbers on the box (blade length, weight, battery or nitro tank, head speeds, flybar or not,
  two or three blades, canopy colour). A **nitro** option models a glow engine behind a centrifugal clutch with
  fuel. Training gear option. Model setup like a radio: pitch curves, head speeds, gyro gain, dual rates, expo,
  governor on/off, heading-hold or rate gyro.
- **Inputs, all mapped to one `ControlFrame` abstraction:** a real transmitter through a USB simulator
  dongle (Gamepad API, with a mapping and calibration wizard, sub-trim and a rescue switch), touch-screen
  gimbals with modes 1–4, phone tilt, the keyboard, and **your phone as the transmitter** (pair with a code or
  QR, WebRTC peer to peer at 50 Hz with telemetry back, auto-reconnect, rescue and reset on the phone).
- **Rescue (buddy box):** hold Space, the 🛟 button or a transmitter switch and the instructor levels the heli and
  holds a hover until you let go.
- **Training:** 35 challenges on the classic progression (hover, orientation drill, circuits, precision and
  slope landings, slope take-off, autorotation, tail rotor failure, 3D) with **Show me** (the demo pilot flies it) and
  **Teach me** (you fly, a ghost helicopter and a ring guide you), a flight **debrief** after every flight
  (landing grade from the measured sink rate, peaks, time in VRS or stall, stick work graded calm / busy /
  chasing), full-flight and crash **replays** with your sticks shown and a transport bar (slow motion, scrub),
  **saved flights** (.json you can load on any machine, or fly against as a ghost), a **logbook** with a progress
  chart, the over-control trend and a coach tip that follows your account, a physics report in the manual
  (hover power, figure of merit, climb, autorotation sink, power bucket) pinned to published numbers by tests, a smoke trail, a telemetry strip chart, an orientation arrow,
  Shift+R hover resets for 3D drills, and rankings (longest clean flight, challenge points) that follow an
  email across devices.
- **Hangar (K): learn the parts.** The helicopter is built from ~40 real, named parts (grips, feathering shaft, flybar,
  mixer, swashplate, CCPM servos, main gear and one-way bearing, belt or torque tube, tail slider, ESC or glow engine,
  FBL unit...). Click one for what it does, how it breaks and what to know when buying a spare; exploded view;
  bench-test the sticks and watch the swashplate and grips move.
- **Graphics that help you fly:** a sharp contact shadow of the model (with a faint rotor-disc shadow) for judging height,
  rotor wash flattening the grass and rippling the lake, a mirror-like lake with wind-driven waves, mowed stripes for
  depth cues, image-based lighting, and a quality setting for phones.
- **Pilot's-eye camera** standing on the field with auto-zoom, plus chase, front, top and drone cameras.
- **Procedural sound** (Web Audio, no samples): motor, blade chop, tail whine with wag flutter, wind,
  Doppler, slap at high G, VRS roughness, stall buzz, battery alarm, crash sounds, birds and field ambience.
- Wind with a log boundary layer, obstacle wakes, terrain following and turbulence; the windsock shows the mean
  and the trees lean and flutter with the local gusts.
- Interface, challenges, lessons and manual in English and Brazilian Portuguese.
- Four flying sites: the outdoor field, the club's parking lot and the hillside (morning, noon or evening light,
  wind) and an indoor gym (walls, ceiling, bleachers and hoops all solid, no wind, hall echo). Works offline after
  the first visit and installs to a phone's home screen.

## Versions

Every change bumps `package.json` and adds an entry at the top of [CHANGELOG.md](CHANGELOG.md) (a test enforces
it). The game shows the version and commit hash in Help and Settings, with a link to the release log.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # physics regression tests (hover trim, control signs, autorotation, crashes)
npm run build
scripts/smoke.sh   # loads a few URLs in headless Chrome against the dev server, fails on uncaught errors
node scripts/drive.mjs "http://localhost:5173/?cam=chase" "wait:rcHeli.sim.state.time > 5" "eval:rcHeli.sim.state.pos.y"
                   # drives the running game over the DevTools protocol (real time): wait:<expr> polls, eval:<expr> prints
```

## Challenges and rankings

Thirty challenges following the classic progression (hover in every orientation, elevator, pirouette, figure eight, circuits, seven landing targets across the three sites, landing streak, stall turn, autorotation, roll, loop, inverted hover, funnel, tic-toc, piro flip, endurance), grouped by level,
and two rankings: longest clean flight (one board per pilot level) and challenge points. Pilot levels (Beginner,
Amateur, Pro) are presets over the assist, rates, wind and failure settings; a flight is ranked by the settings it was
actually flown with (`src/game/sim-level.ts`), never by the label. Records live on the device under a pilot name;
the production build also syncs them to a small rankings server (`server/`, deployed on Quave ONE) and a
player can verify an email with a 6-digit code to carry the profile across devices.

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

- [x] A slope site (the hillside). [x] Paint schemes (stripes, flames, checker) on the canopy.
- [ ] Sampled sound layer (real nitro / electric recordings) on top of the synth.
- [x] Nitro engines with a clutch and a needle. [ ] Collective-pitch coaxial trainers.
- [ ] WebHID path for dongles that are not exposed as gamepads; Bluetooth transmitters.
- [ ] Optional Rust/wasm physics core in a Worker (the TypeScript core runs 40–57x real time on a laptop).

## Origins

Inspired by the CD-ROM era RC sims (Reflex XTR, FMS, Phoenix, Aerofly). None of their code is used; this
is a clean-room implementation from published rotor theory and open literature.

## License

MIT
