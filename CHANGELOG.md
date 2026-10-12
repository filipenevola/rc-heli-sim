# Changelog

All notable changes to RC Heli Sim. The version shown in the game (Help and Settings) matches the latest
entry here; the commit hash next to it identifies the exact build.

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
