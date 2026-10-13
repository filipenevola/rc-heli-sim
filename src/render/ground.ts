import * as THREE from 'three';
import type { LakeSpec } from '../sim/world';
import { NOISE_GLSL, lakeGlsl } from './glsl';
import { wash } from './wash';

/** The mown flying area (mowing stripes run across the pilot's view, which helps judge distance and drift). */
export const MOWN = { x0: -36, x1: 30, z0: -29, z1: 18, stripe: 6 };

/**
 * Ground: a detail texture sampled at two scales (no visible tiling), large-scale colour variation (lush and dry
 * patches), mowing stripes on the field, a worn patch where the pilot stands, then sand, wet sand and a lake bed with
 * caustics around and under the water. One plane, one draw call.
 */
export function createGround(lake: LakeSpec, anisotropy: number): THREE.Mesh {
  const detail = makeDetailTexture();
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.anisotropy = anisotropy;
  const mat = new THREE.MeshStandardMaterial({ map: detail, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.time = wash.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGroundPos;
        uniform float time;
        ${NOISE_GLSL}
        ${lakeGlsl(lake)}
        float boxMask(vec2 p, vec2 lo, vec2 hi, float soft) {
          vec2 a = smoothstep(lo - soft, lo + soft, p) * (1.0 - smoothstep(hi - soft, hi + soft, p));
          return a.x * a.y;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec2 wp = vGroundPos.xz;
        float t1 = texture2D(map, wp / 1.9).g;
        float t2 = texture2D(map, wp / 7.7 + 0.37).g;
        float tex = t1 * 0.65 + t2 * 0.35;
        float n1 = fbm(wp * 0.03);
        float n2 = fbm(wp * 0.19 + 5.0);
        // Grass palette (linear RGB).
        vec3 lush = vec3(0.075, 0.17, 0.035);
        vec3 dry = vec3(0.20, 0.21, 0.07);
        float dryness = clamp(smoothstep(0.4, 0.8, n1) * 0.75 + (n2 - 0.5) * 0.4, 0.0, 1.0);
        vec3 grass = mix(lush, dry, dryness * 0.55);
        // Field: mown in stripes. Outside: longer, darker, patchier grass.
        float mown = boxMask(wp, vec2(${MOWN.x0.toFixed(1)}, ${MOWN.z0.toFixed(1)}), vec2(${MOWN.x1.toFixed(1)}, ${MOWN.z1.toFixed(1)}), 1.5);
        float stripe = smoothstep(0.42, 0.58, abs(fract(wp.x / ${(2 * MOWN.stripe).toFixed(1)}) * 2.0 - 1.0));
        vec3 field = grass * mix(0.9, 1.12, stripe) * vec3(1.05, 1.08, 1.0);
        vec3 rough = grass * mix(0.72, 0.95, n2);
        vec3 col = mix(rough, field, mown);
        // Worn grass where the pilot stands.
        float worn = (1.0 - smoothstep(1.2, 2.6, length(wp))) * (0.55 + 0.45 * n2);
        col = mix(col, vec3(0.16, 0.13, 0.07), worn * 0.75);
        col *= 0.55 + tex * 0.9;
        // Shore: dry sand, wet sand at the waterline, then the lake bed getting darker with depth.
        float d = lakeDist(wp);
        vec3 sand = vec3(0.34, 0.28, 0.18) * (0.85 + 0.3 * n2);
        vec3 wet = vec3(0.12, 0.10, 0.065);
        vec3 bed = mix(vec3(0.09, 0.08, 0.05), vec3(0.025, 0.03, 0.02), smoothstep(0.0, -5.0, d));
        float beach = 1.0 - smoothstep(0.6, 1.9 + n2 * 1.2, d);
        col = mix(col, sand * (0.8 + tex * 0.4), beach);
        col = mix(col, wet, 1.0 - smoothstep(-0.2, 0.55, d));
        if (d < 0.0) {
          col = mix(wet, bed, smoothstep(0.0, -1.5, d));
          // Caustics: light focused by the ripples dancing on the shallow bed.
          float c1 = vnoise(wp * 2.2 + vec2(time * 0.35, time * 0.21));
          float c2 = vnoise(wp * 3.1 - vec2(time * 0.27, -time * 0.31));
          float caustic = pow(1.0 - abs(c1 - c2) * 2.0, 6.0);
          col += vec3(0.12, 0.13, 0.09) * caustic * (1.0 - smoothstep(-0.2, -3.0, d));
        }
        diffuseColor.rgb = col;
        float groundWet = 1.0 - smoothstep(-0.1, 0.7, d);
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.45, groundWet);',
      );
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}

/** Grey-green detail: thousands of short blade strokes. Used as a brightness multiplier, colour comes from the shader. */
function makeDetailTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(150,150,150)';
  g.fillRect(0, 0, 512, 512);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.lineCap = 'round';
  for (let i = 0; i < 14000; i++) {
    const v = (90 + rnd() * 140) | 0;
    g.strokeStyle = `rgba(${v},${v},${v},${0.35 + rnd() * 0.5})`;
    g.lineWidth = 0.8 + rnd() * 1.4;
    const x = rnd() * 512;
    const y = rnd() * 512;
    const a = rnd() * Math.PI * 2;
    const l = 2 + rnd() * 6;
    // Draw wrapped so the tile is seamless.
    for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) {
      if (x + ox < -10 || x + ox > 522 || y + oy < -10 || y + oy > 522) continue;
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  return t;
}
