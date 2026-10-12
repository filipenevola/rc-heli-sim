import * as THREE from 'three';
import { lakeDistance, type FieldLayout } from '../sim/world';
import { LAYER_GRASS } from './environment';
import { MOWN } from './ground';
import { NOISE_GLSL } from './glsl';
import { wash } from './wash';

/**
 * Grass tufts near where you fly. Each tuft is a few curved blades; the vertex shader sways them with the simulated
 * wind (gusts roll across the field downwind) and lays them flat, outward, under the rotor wake in a low hover, with
 * the flutter you see in a real downwash. Visual only: grass never touches the physics.
 */
export function createGrass(layout: FieldLayout, density: number): THREE.InstancedMesh {
  const geo = makeTuftGeometry();
  let seed = 101;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const spots: { x: number; z: number; tall: number }[] = [];
  const blocked = (x: number, z: number) => {
    if (Math.hypot(x, z + 6) < 2.35) return true; // helipad
    if (Math.hypot(x, z) < 1.3) return true; // where the pilot stands
    if (lakeDistance(layout.lake, x, z) < 1.4) return true; // sand and water
    if (Math.abs(z - layout.road.z) < layout.road.width / 2 + 0.3) return true;
    for (const p of layout.platforms) if (Math.abs(x - p.x) < 1.3 && Math.abs(z - p.z) < (p.style === 'truck' ? 3.6 : 1.3)) return true;
    return false;
  };
  const scatter = (cx: number, cz: number, r0: number, r1: number, perM2: number) => {
    const n = Math.round(Math.PI * (r1 * r1 - r0 * r0) * perM2 * density);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(r0 * r0 + rnd() * (r1 * r1 - r0 * r0));
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (blocked(x, z)) continue;
      const mown = x > MOWN.x0 && x < MOWN.x1 && z > MOWN.z0 && z < MOWN.z1;
      spots.push({ x, z, tall: mown ? 0 : 1 });
    }
  };
  // Dense where the camera is close (around the pilot and the pad), lighter out to the fence, and around each platform.
  scatter(0, -3, 0, 13, 26);
  scatter(0, -3, 13, 46, 3.2);
  for (const p of layout.platforms) scatter(p.x, p.z, 0, 7, 12);

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wash);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 washPos; uniform float washStrength; uniform float washRadius; uniform float time; uniform vec2 wind;
        ${NOISE_GLSL}`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        vec4 baseW4 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec2 base = baseW4.xz;
        vec4 wpos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        float hgt = uv.y;
        float bladeH = length((instanceMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        float rnd = hash12(base * 13.7);
        // Wind: steady lean plus gusts that roll downwind across the field.
        float ws = length(wind);
        vec2 wd = ws > 0.05 ? wind / ws : vec2(1.0, 0.0);
        float gust = vnoise(base * 0.18 - wd * time * (0.6 + ws * 0.25));
        vec2 bend = wd * ws * 0.045 * (0.35 + gust) + vec2(sin(time * 2.1 + rnd * 6.28), cos(time * 1.7 + rnd * 4.0)) * (0.03 + ws * 0.006);
        // Rotor wake: straight down under the hub (blades pressed flat), turning into a radial wall jet outwards.
        vec2 rel = base - washPos.xz;
        float r = length(rel);
        vec2 rd = r > 1e-3 ? rel / r : vec2(1.0, 0.0);
        float R = washRadius;
        float foot = exp(-pow(r / (2.4 * R), 2.0));
        float flutter = 0.7 + 0.3 * sin(time * 41.0 + r * (14.0 / R) + rnd * 6.28);
        float push = washStrength * foot * flutter;
        bend = mix(bend, rd * 1.25, clamp(push, 0.0, 1.0));
        float b = min(length(bend), 1.35);
        vec2 bdir = length(bend) > 1e-4 ? normalize(bend) : vec2(1.0, 0.0);
        float ang = b * hgt;
        float yl = wpos.y - baseW4.y;
        wpos.xz += bdir * yl * sin(ang);
        wpos.y = baseW4.y + yl * cos(ang);
        vec4 mvPosition = viewMatrix * wpos;
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };

  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  spots.forEach((s, i) => {
    const h = s.tall ? 0.16 + rnd() * 0.2 : 0.055 + rnd() * 0.05;
    const w = s.tall ? 0.9 + rnd() * 0.5 : 0.7 + rnd() * 0.3;
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    m.compose(new THREE.Vector3(s.x, 0, s.z), q, new THREE.Vector3(w, h, w));
    mesh.setMatrixAt(i, m);
    // Per-tuft hue: mostly green, a few yellowed tufts in the long grass.
    const dry = s.tall ? rnd() * 0.6 : rnd() * 0.25;
    col.setRGB(0.55 + dry * 0.6, 0.85 + dry * 0.1, 0.45 - dry * 0.15);
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.layers.set(LAYER_GRASS);
  return mesh;
}

/** Five blades, each a tapered three-segment strip curving slightly outwards. Height 1, width ~0.12 (scaled per instance). */
function makeTuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const colr: number[] = [];
  const idx: number[] = [];
  const blades = 5;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + b * 0.7;
    const ox = Math.cos(a) * 0.035;
    const oz = Math.sin(a) * 0.035;
    const lean = 0.18 + (b % 3) * 0.08;
    const hb = 0.75 + ((b * 37) % 10) / 40;
    const facing = a + Math.PI / 2;
    const fx = Math.cos(facing);
    const fz = Math.sin(facing);
    const segs = 3;
    const start = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const width = 0.022 * (1 - t * 0.92);
      const cx = ox + Math.cos(a) * lean * t * t * hb;
      const cz = oz + Math.sin(a) * lean * t * t * hb;
      const y = t * hb;
      pos.push(cx - fx * width, y, cz - fz * width, cx + fx * width, y, cz + fz * width);
      // Normals tilted up so the tuft is lit like a canopy rather than flat cards.
      for (let k = 0; k < 2; k++) nor.push(Math.cos(a) * 0.35, 0.95, Math.sin(a) * 0.35);
      uv.push(0, t, 1, t);
      // Darker at the root (self-shadowed), sun-bleached at the tip. Linear RGB.
      const c = 0.35 + t * 0.75;
      for (let k = 0; k < 2; k++) colr.push(0.13 * c, 0.27 * c, 0.05 * c);
    }
    for (let s = 0; s < segs; s++) {
      const i0 = start + s * 2;
      idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  return g;
}
