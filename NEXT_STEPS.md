# Next steps

State on 2026-10-12: version 0.83.0 is live at https://heli.filipenevola.com (web and rankings API on Quave ONE,
CI green including the headless-browser smoke). Tree clean. Full picture of what exists: README.md and CHANGELOG.md.

## How to resume

1. `npm run dev` (port 5173), `npx tsc --noEmit && npx vitest run && npx vite build && scripts/smoke.sh`.
2. Every change: bump `package.json`, add a top entry to `CHANGELOG.md` (a test enforces both), commit, push to
   `main`, then poll `https://heli.filipenevola.com/version.txt` for the short SHA. Server changes (`server/`) also
   redeploy the API: wait for `/api/health` to answer `{"ok":true}` on
   `https://rc-heli-sim-rankings-production-filipenevola.svc-us5.zcloud.ws`.
3. Browser checks: `node scripts/drive.mjs <url> wait:… eval:… shot:…` (headless Chrome via CDP). Phone-radio end to
   end: run the API locally (`PORT=8787 DB_PATH=/tmp/x/rankings.sqlite node server/index.mjs`) and a second dev
   server (`VITE_API_URL=http://localhost:8787 npx vite --port 5174`), then one drive for the desk
   (`rcHeli.input.remote.pair('TEST')`) and one for `/radio.html?c=TEST`.

## Planned next (in order)

- [ ] **Ghost gap readout.** While flying against a ghost (Settings → load a flight as a ghost, or "Fly against it"
      in the debrief), show the live distance to the ghost in the drill badge and, at flight end, the average gap
      and a match percentage. Hook: `flightGhost` loop in `src/main.ts` (≈ line 832) and `flightTimer.onFlightEnd`.
- [ ] **Crash analysis: tail-VRS and VRS rules.** `src/game/crash-analysis.ts` only sees recorder frames (pos, ori,
      sticks). Add `vrs`/`tailVrs` to the recorded frame (`record()` in main.ts, `ReplayFrame` in
      `src/game/replay-file.ts`, keep the file format backward compatible) and add two rules with tips.
- [ ] **Spanish (es).** `src/i18n/`: add `es.ts` + `es-lessons.ts` mirroring `pt-br.ts` / `pt-br-lessons.ts`, extend
      `Lang`, the language select in `src/ui/settings.ts`, and the coverage test in `src/i18n/i18n.test.ts` so every
      challenge/lesson string must exist in both languages. Manual (`help.ts`) can stay EN/PT at first.
- [ ] **Per-challenge attempts.** Count attempts (a flight where the challenge's progress rose above 0 and then reset)
      in `ChallengeTracker`, show "n attempts" in the Challenges list, sync with the profile like `completed`.
- [ ] **Phone radio: haptic ticks** on mode/hold changes on the phone page (`src/radio.ts`, `navigator.vibrate`).
- [ ] **Sampled sound layer** (roadmap): needs real recordings (nitro and electric); keep the synth as fallback.
      Only worth it with assets in hand.
- [ ] **Coaxial / fixed-pitch trainer model** (roadmap): a different rotor model (no collective, throttle = thrust);
      touches `src/sim/physics.ts` and `heli-model.ts`. Use Fable for this one.

## Needs Filipe (blocking for the real-radio polish)

- [ ] Confirm channel directions on the E-Sky 0905A dongle (Settings → Transmitter mapping → the Reverse boxes).
- [ ] Send a radio report (Settings → Transmitter mapping → "Send radio report") with the switches flipped, so a
      built-in mapping for the dongle's switches (Idle-Up, hold, rescue) can be shipped.
- [ ] Optional: regenerate the Quave ONE env tokens used by the deploy workflow if they were ever shared.

## Model choice

Routine cycles (UI, translations, logbook, docs, small features) are fine on Opus 5.5 with this file plus the memory
notes. Keep Fable for rotor/physics changes, lesson recipes (the demo pilot is tuned to the physics; see
"Physics notes" in the memory) and the WebRTC pairing protocol.

## Things that bit before (do not repeat)

- Using the motor torque for the fuselage yaw reaction broke the rate-gyro, wake, rescue and debrief tests; the
  current rule is `spin · max(main.torque, 0)` only while `motorTorque > 0`.
- A new server module must be copied by `server/Dockerfile` (`server/*.mjs`), or the API crash-loops with a 503.
- The autorotation and tail-failure demos need the flybarless 450 (micro/flybar models are switched automatically
  and excluded in `src/game/matrix.test.ts`); the tail-failure demo needs 40 m and hold within 0.4 s.
- Phone radio: the PHONE offers, the desk answers the newest offer with a fresh RTCPeerConnection, answers carry
  `for: offerId`. Reversing this again reintroduces stale-answer deadlocks on reconnect.
