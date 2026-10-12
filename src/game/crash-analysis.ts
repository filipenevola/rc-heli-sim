import type { ReplayFrame } from './replay-file';

/**
 * What an instructor would say after looking at the last two seconds before a crash: not the impact ("blade
 * strike") but the cause behind it. Rules in priority order; the first that fits wins. Frames are the flight
 * recorder's, one per render frame (60 Hz), oldest first, the last one the impact.
 */
export function analyseCrash(frames: ReplayFrame[], groundAt: (x: number, z: number) => number = () => 0): string | null {
  if (frames.length < 20) return null;
  const last = frames.slice(-120);
  const dt = 1 / 60;
  const agl = (f: ReplayFrame) => f.pos.y - groundAt(f.pos.x, f.pos.z);
  const upY = (f: ReplayFrame) => 1 - 2 * (f.ori.x * f.ori.x + f.ori.z * f.ori.z); // body up vector, world y
  const vy = (i: number) => (i > 0 ? (last[i].pos.y - last[i - 1].pos.y) / dt : 0);
  const vxz = (i: number) => (i > 0 ? Math.hypot(last[i].pos.x - last[i - 1].pos.x, last[i].pos.z - last[i - 1].pos.z) / dt : 0);
  const n = last.length;
  const lastHalf = last.slice(Math.floor(n * 0.75)); // ~0.5 s
  const lastSec = last.slice(Math.max(0, n - 60));
  const impact = last[n - 1];

  // Inverted close to the ground.
  if (lastHalf.some((f) => upY(f) < 0) && agl(impact) < 5) return 'Inverted below 5 m: there is no room to recover from there. Keep inverted work above 15 m.';
  // Throttle hold left on while low and sinking (not an auto that merely ended hard).
  if (lastSec.every((f) => f.ctl.throttleHold) && agl(last[Math.max(0, n - 60)]) < 10 && vy(n - 1) < -2 && frames.length > 300 && !frames[frames.length - 300].ctl.throttleHold) return 'Throttle hold was on in the last second with the heli low: the motor was off when you needed it. Check the switch.';
  // Sinking fast with the collective still low until the very end.
  const sinkLong = lastSec.filter((_, i) => vy(n - 60 + i) < -3).length > 40;
  const colLate = lastSec.slice(0, 40).every((f) => f.ctl.collective < 0.2);
  if (sinkLong && colLate && !impact.ctl.throttleHold) return 'A high sink rate and the collective came up too late: start arresting the descent at 3-4 m, not at 1.';
  // Collective dumped near the ground.
  if (lastHalf.some((f) => f.ctl.collective < -0.6 && agl(f) < 3) && vy(n - 1) < -2) return 'Collective dumped near the ground: the skids fold above 2.8 m/s of sink. Lower it slowly on the last metre.';
  // Full cyclic near the ground.
  if (lastHalf.some((f) => (Math.abs(f.ctl.aileron) > 0.8 || Math.abs(f.ctl.elevator) > 0.8) && agl(f) < 2)) return 'Full cyclic near the ground: close to the surface the cyclic must stay small. Climb away with collective, then sort it out.';
  // Landing with drift.
  if (agl(impact) < 1 && vxz(n - 1) > 2.5) return 'Touched down with drift: stop the sideways movement in the hover before you come down.';
  // Fast into the ground in forward flight.
  if (vxz(n - 1) > 8 && agl(impact) < 1.5) return 'Flew into the ground at speed: in forward flight look ahead of the model and keep 5 m under it until you slow down.';
  return null;
}
