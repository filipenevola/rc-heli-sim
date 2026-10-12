import type { LakeSpec } from '../sim/world';

/** Shared GLSL helpers: hash/value noise and the lake's signed-distance function (same maths as sim/world.ts). */
export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
`;

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/** `float lakeDist(vec2 p)`: negative over water, metres. Mirrors lakeDistance() in sim/world.ts. */
export function lakeGlsl(lake: LakeSpec): string {
  const k = f(lake.blend);
  const lines = lake.lobes.map((l, i) => {
    const di = `length(p - vec2(${f(l.x)}, ${f(l.z)})) - ${f(l.r)}`;
    return i === 0 ? `  float d = ${di};` : `  d = sminLake(d, ${di}, ${k});`;
  });
  return /* glsl */ `
float sminLake(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float lakeDist(vec2 p) {
${lines.join('\n')}
  return d;
}
`;
}
