# Changelog

All notable changes to RC Heli Sim. The version shown in the game (Help and Settings) matches the latest
entry here; the commit hash next to it identifies the exact build.

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
