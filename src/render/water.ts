import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { LakeSpec } from '../sim/world';
import { LAYER_HELI, type EnvironmentHandles } from './environment';
import { NOISE_GLSL, lakeGlsl } from './glsl';
import { wash } from './wash';

/**
 * The lake. A planar mirror (the scene re-rendered from below the surface: sky, trees, your helicopter) distorted by
 * a procedural wave field. Waves follow the simulated wind (direction and strength), and the rotor wake writes on
 * the surface: a dark ruffled patch right under the disc and rings running outwards, like a real heli over water.
 * The shoreline is the same signed-distance shape the physics uses for ditching.
 */
export function createLake(lake: LakeSpec, env: EnvironmentHandles, quality: 'high' | 'low'): THREE.Mesh {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const l of lake.lobes) {
    minX = Math.min(minX, l.x - l.r); maxX = Math.max(maxX, l.x + l.r);
    minZ = Math.min(minZ, l.z - l.r); maxZ = Math.max(maxZ, l.z + l.r);
  }
  const pad = 3;
  const w = maxX - minX + pad * 2;
  const d = maxZ - minZ + pad * 2;
  const geo = new THREE.PlaneGeometry(w, d);

  const uniforms = {
    color: { value: new THREE.Color(0x7f7f7f) },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    sunDir: { value: env.sunDir },
    sunColor: { value: env.sunColor },
    skyColor: { value: env.skyColor },
    hazeColor: { value: env.hazeColor },
    reflections: { value: quality === 'high' ? 1 : 0 },
    ...wash,
    ...THREE.UniformsLib.fog,
  };

  const shader = {
    name: 'LakeShader',
    uniforms,
    vertexShader: /* glsl */ `
      uniform mat4 textureMatrix;
      varying vec4 vUv;
      varying vec3 vWorld;
      #include <common>
      #include <fog_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vUv = textureMatrix * vec4(position, 1.0);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 skyColor; uniform vec3 hazeColor;
      uniform float reflections;
      uniform vec3 washPos; uniform float washStrength; uniform float washRadius; uniform float time; uniform vec2 wind;
      varying vec4 vUv;
      varying vec3 vWorld;
      #include <common>
      #include <fog_pars_fragment>
      #include <logdepthbuf_pars_fragment>
      ${NOISE_GLSL}
      ${lakeGlsl(lake)}

      // Surface height (m) at p. Wind waves are stretched across the wind and travel with it.
      float waves(vec2 p) {
        float ws = length(wind);
        vec2 dir = ws > 0.05 ? wind / ws : vec2(0.7071, 0.7071);
        vec2 q = vec2(dot(p, dir), dot(p, vec2(-dir.y, dir.x)));
        float amp = 0.006 + 0.0045 * ws;
        float h = 0.0;
        h += vnoise(vec2(q.x * 0.9 - time * (0.5 + 0.12 * ws), q.y * 0.45)) * 0.55;
        h += vnoise(vec2(q.x * 2.1 - time * (0.9 + 0.2 * ws), q.y * 1.3 + 3.1)) * 0.3;
        h += vnoise(vec2(q.x * 5.3 - time * 1.7, q.y * 3.9 + 7.7)) * 0.15;
        h *= amp;
        // Rotor wake: rings running out from under the disc, and chop where the air column hits the water.
        float r = length(p - washPos.xz);
        float R = washRadius;
        float rings = sin(r * (9.0 / R) - time * 26.0) * exp(-r / (R * 3.2)) * smoothstep(0.2 * R, 0.9 * R, r);
        float chop = (vnoise(p * (14.0 / R) + time * 9.0) - 0.5) * exp(-pow(r / (1.3 * R), 2.0));
        h += washStrength * (0.010 * rings + 0.016 * chop) * (R / 0.36);
        return h;
      }

      void main() {
        #include <logdepthbuf_fragment>
        vec2 p = vWorld.xz;
        float d = lakeDist(p);
        if (d > 0.05) discard;

        float e = 0.04;
        float h0 = waves(p);
        vec3 n = normalize(vec3(-(waves(p + vec2(e, 0.0)) - h0) / e, 1.0, -(waves(p + vec2(0.0, e)) - h0) / e));
        vec3 V = normalize(cameraPosition - vWorld);
        float cosT = max(dot(n, V), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

        // Mirror image, nudged by the waves.
        vec4 uv = vUv;
        uv.xy += n.xz * 0.9 * uv.w * 0.05;
        vec3 refl = texture2DProj(tDiffuse, uv).rgb;
        vec3 skyRefl = mix(hazeColor, skyColor * 0.9, clamp(reflect(-V, n).y * 2.0, 0.0, 1.0));
        refl = mix(skyRefl, refl, reflections);

        // Body colour: green-brown in the shallows, dark blue-green in the middle; lit by sun and sky.
        float depth = clamp(-d / 6.0, 0.0, 1.0);
        vec3 shallow = vec3(0.10, 0.20, 0.15);
        vec3 deep = vec3(0.012, 0.045, 0.06);
        float sunUp = max(sunDir.y, 0.0);
        vec3 light = skyColor * 0.55 + sunColor * sunUp * 0.22;
        vec3 body = mix(shallow, deep, sqrt(depth)) * light;
        // Light scattered inside wave crests facing the sun.
        body += vec3(0.03, 0.08, 0.06) * light * max(dot(n.xz, sunDir.xz), 0.0) * 4.0;

        vec3 col = mix(body, refl, F);

        // Sun glitter: a sharp core plus a wider sheen, both following the wave normals.
        vec3 H = normalize(sunDir + V);
        float nh = max(dot(n, H), 0.0);
        col += sunColor * (pow(nh, 700.0) * 5.0 + pow(nh, 90.0) * 0.12);

        // Foam: a broken band on the shore and spray-whitened water right under a low rotor.
        float r = length(p - washPos.xz);
        float shore = smoothstep(-0.7, 0.0, d) * smoothstep(0.35, 0.75, vnoise(p * 2.7 + vec2(time * 0.15, 0.0)));
        float spray = washStrength * exp(-pow(r / (1.1 * washRadius), 2.0)) * smoothstep(0.5, 0.9, fbm(p * (9.0 / washRadius) + time * 6.0));
        col = mix(col, light * 0.85, clamp(shore * 0.55 + spray * 0.45, 0.0, 1.0));

        // Shallow edge lets the lake bed show through; the mirror stays opaque at grazing angles.
        float alpha = mix(0.6, 0.97, smoothstep(0.0, -2.5, d));
        alpha = mix(alpha, 1.0, F);
        alpha *= smoothstep(0.05, -0.12, d);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  };

  const px = Math.min(window.devicePixelRatio, 2);
  const mesh =
    quality === 'high'
      ? new Reflector(geo, {
          shader,
          textureWidth: Math.round(window.innerWidth * px * 0.5),
          textureHeight: Math.round(window.innerHeight * px * 0.5),
          clipBias: 0.002,
          multisample: 4,
        })
      : new THREE.Mesh(geo, new THREE.ShaderMaterial({ ...shader, uniforms: THREE.UniformsUtils.clone(shader.uniforms) }));
  const mat = mesh.material as THREE.ShaderMaterial;
  // Share the live uniforms (Reflector clones them): wash, sun and fog values update in place.
  for (const k of ['sunDir', 'sunColor', 'skyColor', 'hazeColor', 'washPos', 'washStrength', 'washRadius', 'time', 'wind'] as const) {
    mat.uniforms[k] = (uniforms as Record<string, THREE.IUniform>)[k];
  }
  if (!(mesh instanceof Reflector)) mat.uniforms.textureMatrix.value = new THREE.Matrix4();
  mat.transparent = true;
  mat.fog = true;
  mat.depthWrite = false;
  if (mesh instanceof Reflector) {
    // Reflect the scenery and the helicopter (its own layer), not the grass blades.
    mesh.camera.layers.set(0);
    mesh.camera.layers.enable(LAYER_HELI);
  }
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((minX + maxX) / 2, 0.015, (minZ + maxZ) / 2);
  mesh.renderOrder = 2;
  return mesh;
}
