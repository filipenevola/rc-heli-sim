import * as THREE from 'three';
import type { World } from '../sim/world';
import { wash, washSpeed } from './wash';

/**
 * Spray and dust thrown out by the rotor wake: white mist over the lake, a light brown haze over the pad and
 * sand. Particles are born in a ring around the point under the rotor and travel outwards with the wall jet
 * (speed from the simulated wake), rising and slowing as they go. Visual only.
 */
export class RotorSpray {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private kind: Float32Array;
  private next = 0;
  private emitAcc = 0;

  constructor(private world: World, count = 900) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.kind = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('life', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('kind', new THREE.BufferAttribute(this.kind, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { scale: { value: 1 }, ...THREE.UniformsLib.fog },
      fog: true,
      vertexShader: /* glsl */ `
        attribute float life; attribute float kind;
        uniform float scale;
        varying float vLife; varying float vKind;
        #include <fog_pars_vertex>
        void main() {
          vLife = life; vKind = kind;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float size = mix(0.03, 0.16, 1.0 - life) * (kind > 0.5 ? 1.0 : 1.5);
          gl_PointSize = life > 0.0 ? size * scale / -mvPosition.z : 0.0;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying float vLife; varying float vKind;
        #include <fog_pars_fragment>
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c);
          if (r > 0.5) discard;
          float a = smoothstep(0.5, 0.0, r) * vLife * (vKind > 0.5 ? 0.3 : 0.16);
          vec3 col = vKind > 0.5 ? vec3(0.92, 0.95, 0.97) : vec3(0.55, 0.47, 0.36);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  /** viewportHeight in pixels and the camera's vertical fov, for point sizes in metres. */
  update(dt: number, viewportHeight: number, fovDeg: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    const hub = wash.washPos.value;
    const R = wash.washRadius.value;
    const strength = wash.washStrength.value;
    const water = this.world.isWater(hub.x, hub.z);
    // Only loose surfaces throw anything: water always, the pad/sand/dirt a little; mown grass hardly at all.
    const onSand = !water && this.world.lake !== null && Math.abs(Math.hypot(hub.x - 0, hub.z + 6)) < 2.4;
    const rate = strength > 0.25 ? (water ? 260 : onSand ? 70 : 0) * Math.min(1, (strength - 0.25) * 1.6) * (R / 0.36) : 0;
    this.emitAcc += rate * dt;
    while (this.emitAcc >= 1) {
      this.emitAcc -= 1;
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const a = Math.random() * Math.PI * 2;
      const r = R * (0.7 + Math.random() * 0.8);
      this.pos[i * 3] = hub.x + Math.cos(a) * r;
      this.pos[i * 3 + 1] = 0.03;
      this.pos[i * 3 + 2] = hub.z + Math.sin(a) * r;
      const v = washSpeed * (0.35 + Math.random() * 0.35);
      this.vel[i * 3] = Math.cos(a) * v;
      this.vel[i * 3 + 1] = 0.3 + Math.random() * 0.9;
      this.vel[i * 3 + 2] = Math.sin(a) * v;
      this.life[i] = 1;
      this.kind[i] = water ? 1 : 0;
    }
    const drag = Math.exp(-dt * 1.6);
    const wx = wash.wind.value.x;
    const wz = wash.wind.value.y;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt / (this.kind[i] > 0.5 ? 1.3 : 1.8);
      for (let k = 0; k < 3; k++) this.vel[i * 3 + k] *= drag;
      this.vel[i * 3] += (wx - this.vel[i * 3]) * dt * 0.8;
      this.vel[i * 3 + 2] += (wz - this.vel[i * 3 + 2]) * dt * 0.8;
      this.vel[i * 3 + 1] -= (this.kind[i] > 0.5 ? 0.6 : 0.15) * dt;
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      if (this.pos[i * 3 + 1] < 0.02) this.pos[i * 3 + 1] = 0.02;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.life.needsUpdate = true;
    g.attributes.kind.needsUpdate = true;
  }
}
