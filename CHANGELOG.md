# Changelog

All notable changes to RC Heli Sim. The version shown in the game (Help and Settings) matches the latest
entry here; the commit hash next to it identifies the exact build.

## 0.40.0

- **The logbook follows your account**: signed-in pilots get their last sixty flights synced to the rankings
  server and merged on every device (union by time, newest first), so the progress line and the coach line see
  all your flying, not just this phone's.

## 0.39.0

- **Coach line in the logbook**: after a couple of crashes it names the most common way your recent flights
  ended and gives the one tip an instructor would, for blade strikes, hard landings, boom strikes, obstacles and
  upside-down arrivals.
- Manual: a **"Before you fly the real one"** checklist of what transfers from the sim to the field and what the
  sim cannot check (tracking, head speed and pitch, gyro gain, range check, wind, timer, stance).

## 0.38.0

- **Canopy colour** for your own helicopter (My helicopter → Canopy colour), so it looks like yours on the field.

## 0.37.0

- **Nitro helicopters** (My helicopter → Power → Nitro): a glow engine behind a centrifugal clutch with a fuel
  tank instead of a battery. Torque follows an engine curve that peaks near the Idle-Up head speed; below about
  10% throttle the clutch lets go and the rotor freewheels while the engine idles (hold and autorotations behave
  like nitro, not like a motor switching off); fuel burns with load and the engine quits dry. The HUD shows fuel,
  the debrief reports fuel used, and the engine sounds like an exhaust pulse rather than a motor whine.

## 0.36.0

- **Three-blade heads** for your own helicopter (Settings → My helicopter → Main blades): more solidity, so more
  thrust at the same pitch, and more rotor inertia. Drawn as three blades at 120°.

## 0.35.0

- **Indoor gym**, a second flying site (Settings → Flying site): a 36 × 48 m sports hall with a 12 m ceiling,
  bleachers, two hoops, a stack of mats and a vault box as landing targets, wooden floor with court lines, and
  no wind. Walls, ceiling, hoops and bleachers are all solid. Made for the 250 micro and tight hover work.
  Challenges that need altitude, wind or the field's targets are marked "Field only" there.

## 0.34.0

- **Português (Brasil)**: the whole interface, the 27 challenges, every lesson caption and the manual are
  available in Brazilian Portuguese (Settings → Language, or automatically for browsers set to Portuguese).
  English remains the source text; anything not yet translated shows in English.

## 0.33.0

- The distant hills are gentler and haze-coloured (0.32.0 made them too tall and dark from some angles).
- Fix: the "road" pilot spot stood right behind the cerradoX billboard, which blacked out the view; it now stands
  beside it.

## 0.32.0

- **Scenery**: pines are three stacked cones and every third tree is a broadleaf with a lumpy crown, each with
  its own shade of green; distant hills ring the horizon inside the haze; the sun has a disc where the light
  comes from.

## 0.31.0

- A short **welcome card** on the first visit: the controls for your device, where Show me is, and where the
  manual is. Shown once per device.

## 0.30.0

- **Shift+R: reset into a hover** at 6 m in Idle-Up 1 with the rotor at speed, for drilling 3D figures without
  spooling up every time. It stays frozen until the collective is near the hover point (the keyboard's is placed
  there for you), then flies.
- The help manual has a table of contents.
- Dev: a physics benchmark test (`tests/bench.test.ts`) keeps the step cost in view: 17-25 ms of CPU per simulated
  second on a laptop, 40-57x real time.

## 0.29.0

- **Logbook** (Challenges → Pilot): the last sixty flights on this device with duration, landing grade, peak
  altitude and G, plus a progress line comparing the last ten flights with the ten before (clean rate and landing
  softness).

## 0.28.0

- **Fly your own helicopter**: Settings → Helicopter → My helicopter takes the numbers from the box and the radio
  (blade length, all-up weight, battery cells and capacity, head speeds per mode, flybar or flybarless) and builds a
  physics model for it, scaling everything else between the 450 and 700 references with power laws in rotor
  radius. It appears in the Model list, keeps its own model setup, and is saved on the device and with your account.

## 0.27.0

- **Canopy**: a proper teardrop canopy with a two-tone scheme, bright on top and dark underneath, plus a white
  stripe along the frame, so the model's orientation reads at a distance the way a real paint scheme does. The 700
  is blue, the micro yellow, the 450s red.

## 0.26.0

- **Tail wag is detected, warned and heard**: a fast yaw oscillation now raises a HUD warning ("tail gyro gain too
  high") and puts a 7 Hz flutter in the tail rotor's whine, the way you would notice it at the field.

## 0.25.0

- **Physics: dynamic inflow.** The air column through the main rotor has mass, so the induced velocity takes a
  few tens of milliseconds to follow a collective change (about 60 ms on a 450, 125 ms on a 700). Thrust now
  overshoots on a quick pull, the "pop" you feel on a real heli, and lags on a quick dump.
- Skids now fold above about 2.8 m/s of sink (was 2.2): plastic skids and landing gear flex more than that
  first guess allowed. The training gear's foam balls take about 3.5 m/s.
- Vortex-ring roughness is now deterministic (a hash of time), so replays and tests reproduce exactly.
- Autorotation demo retuned for the new inflow dynamics (lands the 450 at about 1.4 m/s, the 700 at 0.6).

## 0.24.0

- **Governor off** (Settings → Helicopter → Model setup → ESC): an open-loop throttle curve instead of the
  governor. The motor model loses torque with speed, so the head droops a few percent on a hard pull and the
  Idle-Up throttle has to be matched to the pitch, as every throttle-curve pilot knows.
- **Rate-mode tail gyro** (same panel): no heading hold. The tail damps but swings with every collective change
  and the pilot holds the heading with the rudder. Both options are saved in the model setup (and to your account).

## 0.23.0

- **Smoke trail** (T, or Settings → Smoke trail): a fading ribbon of the last 12 seconds of flight, so the shape
  of a loop, an eight or a funnel is visible from the pilot's spot. Also drawn during replays. Saved with your
  preferences.
- Fix: with a transmitter plugged in, holding a keyboard key for more than 4 s handed the sticks back to the
  transmitter mid-climb. A held key now counts as keyboard activity.
- Dev: `scripts/drive.mjs` gained a `shot:<file.png>` step.

## 0.22.0

- **Physics: the tail gyro loop is now a real loop.** The gyro's anti-vibration filter, the tail servo's finite
  speed (full throw in about 80 ms) and a few milliseconds of transport delay are modelled, so too much gyro gain
  wags the tail instead of just feeling tighter: the wag starts around 250% on a 450, 200% on a micro, higher on
  the 700. The setup slider now goes to 300% so you can find the wag and back off, as on the field. Factory gains
  were retuned for the same feel (a little less overshoot on rudder steps).
- The mechanical flybar now senses the true body rate (it is a gyroscope, not a sensor).

## 0.21.0

- **Physics: hard landings break things.** Skids fold above about 2.2 m/s of sink at touchdown (the training gear's
  foam balls take about 3 m/s). Before this, a 6 m/s slam counted as a clean flight.
- **Autorotation lesson rewritten as the real technique**: throttle hold with the collective at the bottom, a
  forward descent, a nose-up flare at about 12 m that bleeds the airspeed and raises the head speed, level skids and
  one smooth pull. The demo flies it on the flybarless 450 and the 700; on a micro or the flybar trainer it switches
  to the 450 for the demo and switches back after.
- The "Landed on the helipad" note now only appears after a real flight, not for sitting on the pad at start-up,
  and it joins the debrief card instead of replacing it.
- Dev: `scripts/drive.mjs` drives the game in headless Chrome over the DevTools protocol (used to verify the
  debrief and replay end to end).

## 0.20.0

- **Replay any flight**: the debrief card has a Replay flight button that plays the whole flight back from
  lift-off with your sticks shown, and the camera modes work while it runs. The crash replay still covers the
  last 10 seconds.

## 0.19.0

- **Physics: the main-rotor wake at the tail.** The wake is modelled as a skewed column leaving the disc along the
  relative airflow plus the induced velocity. In a hover it misses the tail; between about 2 and 6 m/s it hits the
  stabiliser (the nose-up transition bump) and, when its rolled-up edge passes through the tail rotor, costs tail
  thrust and adds a rough yaw, as in slow sideways flight on a real heli.
- **Physics: directional skid friction.** Skids slide along their length but dig in sideways, so a drifting
  sideways touchdown is now the tip-over it is in real life.

## 0.18.0

- **Flight debrief**: after every flight longer than a few seconds, a card grades the touchdown (greaser / soft / firm /
  hard from the measured sink rate), and lists peak altitude, speed and G, time in vortex ring state or blade stall,
  battery used, and the challenges completed on the way.
- **Dual rates on the mode switch** (Settings → Input): a separate, lower cyclic rate for Normal mode, as on a real
  radio. Saved with your preferences.

## 0.17.0

- **Training gear** (Settings → Helicopter): the cross of rods with foam balls every instructor fits to a first
  heli. Four wide soft contact points make tip-overs nearly impossible, and the physics also carries the extra
  weight, drag and roll inertia. Landing targets still only count the real skids, so the small platforms stay
  landable. Saved with your preferences.
- **Field ambience**: a soft rustle bed that rises with the wind and birds chirping between flights, quieter
  when the heli is loud nearby.

## 0.16.0 — 2026-10-12

- Teach me shows a ghost: the demo pilot's flight for the current step, pre-flown in a hidden simulation when
  the lesson starts, plays as a translucent blue helicopter next to yours so you see the shape of the move while
  you fly it.
- Settings are remembered across reloads: helicopter, input device, stick mode, expo and rates, assist, camera,
  pilot spot, orientation arrow, wind, volume and mute.
- Ghost helicopters cast no shadows and never collide; they are only a hint.
- Release smoke test (`scripts/smoke.sh`) loads the game in headless Chrome and fails on any uncaught error.

## 0.15.0 — 2026-10-12

- Sound follows the physics: blade slap sharpens above ~1.2 g, vortex ring state makes the chop rough, blade
  stall adds a low buzz, and the radio's low-battery alarm beeps under 10% (fast at 0%). Crashes sound like
  their cause: a crack and debris for blades and boom strikes, a thump for the frame.
- Deploys: the rankings API (single container with a volume) only redeploys when server code changed, so a
  game update no longer takes the rankings down for a minute.

## 0.14.0 — 2026-10-12

- Walk around the field: Settings → Camera lets the pilot stand at the helipad, the barn, the pond, the tower or the
  road, and G (or "Walk to the heli") walks to wherever the model is, like you would at the field. The pilot figure
  turns to follow the model.
- Orientation arrow on the grass under the model showing where the nose points (beginner aid, can be switched off).

## 0.13.0 — 2026-10-12

- New helicopter: 250 Micro CP (flybarless), a 210 g collective-pitch micro with 4,000 rpm head speed and a
  5.5 Wh pack: twitchy, quick, short flights.
- Model setup, like your radio's model memory: per flight mode pitch curve (low / centre / high) and head
  speed, tail gyro gain and cyclic rate, in Settings → Helicopter → Model setup. Applies live, saved per
  helicopter on the device and to your account when signed in.
- Drivetrain friction now scales with the motor (the micro could not reach head speed against a 450's bearings).

## 0.12.0 — 2026-10-12

- Wind is now a field, not a number: a boundary layer (calmer at skid height than at tree height), wakes behind
  trees and buildings (slower and rougher downwind, within a few obstacle heights), and position-dependent
  turbulence. Hovering in the lee of the barn is a different job from the open field.
- New challenge: Crosswind landing (Intermediate, 40 points) with a lesson that sets 5 m/s gusty wind from the
  side and restores your setting afterwards. 27 challenges, 1,385 points.

## 0.11.0 — 2026-10-12

- Crash replay: after a crash, "Replay last 10 s" on the crash banner plays your flight back with your own stick
  inputs on the big gimbals and a countdown to the impact; loops until you close it. Reset clears it.

## 0.10.0 — 2026-10-11

- Boom strike on the flybar trainer: big cyclic while pushing negative G folds the blades into the boom (the
  real reason 3D is flown on flybarless heads). 3D lessons therefore run on the flybarless 450 automatically
  and your model comes back afterwards.
- Teach me now coaches in words: one instruction at a time from the biggest gap between your sticks and the
  ghost ring ("a bit more collective", "nose left (rudder)", "Switch to Idle-Up 1", "Good, hold it there").
- HUD shows the rotor G load.

## 0.9.0 — 2026-10-11

- Five more challenges, the hard ones: Three clean landings (streak), Stall turn, Funnel, Tic-toc, Piro flip.
  26 challenges, 1,345 points. Each has Show me and Teach me; every lesson is verified on all three
  helicopters and with a hint-following player.
- Manoeuvre detection built on attitude geometry rather than Euler angles where those break down: the stall
  turn is recognised by the nose going from up to down by yaw with the body-up vector staying put and the
  heading reversed (a loop-over inverts the up vector instead); the piro flip by inversion and recovery with
  more than 270° of heading change during the flip; the tic-toc only counts tail-low swings (never past 75°
  of bank, nearly stationary).
- The demo pilot flies the piro flip with an attitude-tracking controller (target up-vector rotating about a
  fixed world axis with feed-forward), so the pirouette underneath does not disturb the flip.

## 0.8.0 — 2026-10-11

- Physics: blade stall (lift plateaus at ~13° blade angle of attack and decays beyond, with a steep drag rise, so
  pulling too much collective at low head speed bogs the rotor instead of lifting more), vortex ring state
  (a near-vertical descent at about the induced velocity loses up to 35% thrust and gets rough; forward speed
  clears it), ground effect that fades with forward speed, and a battery model (pack energy per model, voltage
  sag below 30%, motor quits at 0%: autorotate). HUD shows battery and warnings for stall, vortex ring and
  low battery.
- Fixed a latent bug: with the rotor stopped the inflow ratio was computed against a near-zero tip speed and
  could flip a parked helicopter through the flap-back term.

## 0.7.0 — 2026-10-11

- Nine new challenges following the classic RC heli progression (hover in every orientation, pirouettes,
  figure eights, precision, 3D): Side-in hover left and right, Elevator, Spot landing on the H, Pirouette,
  Figure eight (new seven-ring course in blue), Loop, Inverted hover, Nose-in circuit. 21 challenges, 1,020 points.
- Challenges are grouped by level: Beginner, Intermediate, Advanced, 3D, with per-level progress.
- Every new challenge has Show me and Teach me lessons, tested on all three helicopters.
- The helipad counts as a landing target (spot landing precision).
- Lift/climb steps in lessons now hold position instead of drifting.

## 0.6.2 — 2026-10-11

- Show me reviewed on all three helicopters (36 lesson/model combinations now run in the test suite). Fixed the
  700's table and pontoon landings: the final collective ramp started from a generic hover value, which in ground
  effect lifted the big heli off again and slid it sideways; it now ramps from where the descent left the
  collective, keeps position hold until the skids are planted, and only commits to the descent when centred.
- Landing lessons use each model's real skid height.
- Removed a duplicated account-sync block that ran twice.

## 0.6.1 — 2026-10-11

- Fixed the pond (and pad/road) flickering against the grass when seen from far away (depth z-fighting): ground
  decals now use a polygon offset and the camera near plane went from 5 cm to 30 cm for better depth precision.

## 0.6.0 — 2026-10-11

- Version number and release log: Help and Settings show the version and commit hash with a link to this file.
- Sound: pause now silences everything; audio resumes after the tab was in the background or interrupted (iOS).
- Transmitter: built-in profile for the E-Sky 0905A (FMS) dongle from a recorded radio report; per-channel
  Reverse and Set centre (sub-trim); travel auto-calibrates while flying; mapping and calibration are saved on
  the device and synced to the account when signed in.
- Top bar is icons with hover tooltips (desktop) and long-press mini help (touch); the eye at the top-left always
  stays to show/hide the rest; pause button and P key; the sim pauses when the tab goes to the background.
- Settings → Transmitter mapping can send a radio report (axes and buttons sampled for 10 s) for diagnostics.

## 0.5.0 — 2026-10-11

- Show me: a demo pilot flies every challenge on the real physics while big gimbals show its sticks and a caption
  explains each step. Teach me: you fly the same steps with a ghost ring showing where the sticks should be.
- Pilot sign-in: generated callsign by default, Pilot button in the top bar, email + 6-digit code sign-in that syncs
  callsign, challenges and best flight across devices; account name wins; sign-out; device progress merged on sign-in.
- Game hotkeys never fire while typing in a text field.
- Game served from heli.filipenevola.com on Quave ONE; the old GitHub Pages link redirects there.

## 0.4.0 — 2026-10-11

- Challenge mode: 12 challenges (hover, nose-in, four landings, gate circuit, roll, autorotation, endurance) with live
  progress and points; longest-clean-flight timer; two rankings (device and online); rankings server on Quave ONE with
  Resend email verification.
- Quave Holdings portfolio billboards around the field, with the official logos; tap one to open the site.
- Mode / Hold buttons fixed (labels did not repaint) and every mode change explains itself on screen.

## 0.3.0 — 2026-10-11

- Flying field: farm, houses, barn, pond, road, hay bales, cows and sheep, windsock that follows the live wind.
- Everything on the field is solid: rotor strikes and hard contacts crash; skids can land on objects.
- Four landing targets (picnic table, pickup bed, pontoon, 7 m tower) with precision scoring and a per-device best.
- Shadows for every object on the field; clouds that drift with the wind.
- Camera modes: pilot on the field (auto-zoom), chase, front, top-down, orbiting camera drone.
- Transmitter switch mapping (Idle-Up, Throttle hold) and an inverted-flight manual.

## 0.2.0 — 2026-10-11

- Procedural sound: motor whine, rotor blade chop, tail rotor, wind, distance and Doppler, crash thump.
- Mobile layout: compact HUD, hide UI, fullscreen, safe areas; touch gimbals no longer blocked.
- Help panel, attitude assist mode, phone-tilt input.

## 0.1.0 — 2026-10-11

- First version: 1 kHz rotor physics (blade-element + momentum theory, flapping, FBL/flybar, governor,
  autorotation, ground effect, skid contacts, blade strike), three helicopters, keyboard / touch / USB transmitter
  input with a mapping wizard, pilot's-eye camera, GitHub Pages deployment.
