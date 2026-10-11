// Minimal, allocation-light vector/quaternion math for the physics core.
// Kept independent from the renderer so the sim can later move to Rust/wasm
// or run inside a Web Worker without dragging three.js along.

export type V3 = { x: number; y: number; z: number };
export type Q = { x: number; y: number; z: number; w: number };

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const q = (x = 0, y = 0, z = 0, w = 1): Q => ({ x, y, z, w });

export function add(a: V3, b: V3): V3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function sub(a: V3, b: V3): V3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function scale(a: V3, s: number): V3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
export function dot(a: V3, b: V3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function cross(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
export function len(a: V3): number { return Math.hypot(a.x, a.y, a.z); }
export function norm(a: V3): V3 {
  const l = len(a);
  return l > 1e-12 ? scale(a, 1 / l) : v3();
}
export function clamp(x: number, lo: number, hi: number): number { return x < lo ? lo : x > hi ? hi : x; }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

/** Rotate vector by quaternion (body -> world when q is body orientation). */
export function rotate(qq: Q, v: V3): V3 {
  const { x, y, z, w } = qq;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  // v' = v + w*t + cross(q.xyz, t)
  return {
    x: v.x + w * tx + (y * tz - z * ty),
    y: v.y + w * ty + (z * tx - x * tz),
    z: v.z + w * tz + (x * ty - y * tx),
  };
}

export function conj(qq: Q): Q { return { x: -qq.x, y: -qq.y, z: -qq.z, w: qq.w }; }

/** Rotate world vector into body frame. */
export function rotateInv(qq: Q, v: V3): V3 { return rotate(conj(qq), v); }

export function qmul(a: Q, b: Q): Q {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function qnorm(a: Q): Q {
  const l = Math.hypot(a.x, a.y, a.z, a.w) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l, w: a.w / l };
}

export function qFromAxisAngle(axis: V3, angle: number): Q {
  const h = angle / 2;
  const s = Math.sin(h);
  const n = norm(axis);
  return { x: n.x * s, y: n.y * s, z: n.z * s, w: Math.cos(h) };
}

/** Integrate orientation with body angular velocity w (rad/s) over dt. */
export function qIntegrate(qq: Q, wBody: V3, dt: number): Q {
  const wl = len(wBody);
  if (wl < 1e-9) return qq;
  const dq = qFromAxisAngle(wBody, wl * dt);
  return qnorm(qmul(qq, dq));
}

/** Yaw/pitch/roll (ZYX-ish) from quaternion, for HUD only. Y-up world. */
export function eulerFromQ(qq: Q): { yaw: number; pitch: number; roll: number } {
  const fwd = rotate(qq, v3(0, 0, -1));
  const up = rotate(qq, v3(0, 1, 0));
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  const pitch = Math.asin(clamp(fwd.y, -1, 1));
  // roll: angle of body up around forward axis relative to world up projection
  const right = rotate(qq, v3(1, 0, 0));
  const roll = Math.atan2(-right.y, up.y);
  return { yaw, pitch, roll };
}
