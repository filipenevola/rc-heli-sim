import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

/**
 * Smoke-on: a fading ribbon of where the heli has been over the last several seconds. Makes the shape of a loop,
 * a figure eight or a funnel visible from the pilot's spot, which is how real pilots judge their figures.
 * Drawn as a screen-space "fat line" so it stays readable at a distance.
 */
export class Trail {
  readonly object: Line2;
  private material: LineMaterial;
  private positions: Float32Array;
  private ages: Float32Array;
  private head = 0;
  private count = 0;
  private acc = 0;
  private readonly max: number;

  constructor(private seconds = 12, private hz = 30) {
    this.max = Math.ceil(seconds * hz);
    this.positions = new Float32Array(this.max * 3);
    this.ages = new Float32Array(this.max);
    this.material = new LineMaterial({ vertexColors: true, linewidth: 3, transparent: true, opacity: 0.9, depthWrite: false, worldUnits: false });
    this.material.resolution.set(window.innerWidth, window.innerHeight);
    const geo = new LineGeometry();
    geo.setPositions([0, 0, 0, 0, 0, 0]);
    geo.setColors([1, 1, 1, 1, 1, 1]);
    this.object = new Line2(geo, this.material);
    this.object.frustumCulled = false;
    this.object.visible = false;
  }

  setResolution(w: number, h: number): void {
    this.material.resolution.set(w, h);
  }

  get visible(): boolean {
    return this.object.visible;
  }

  set visible(v: boolean) {
    this.object.visible = v;
    if (!v) this.clear();
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.acc = 0;
    this.object.geometry.setPositions([0, 0, 0, 0, 0, 0]);
    this.object.geometry.setColors([0, 0, 0, 0, 0, 0]);
  }

  /** Call every frame with the heli position. Samples at `hz`, ages the rest. */
  update(pos: { x: number; y: number; z: number }, dt: number): void {
    if (!this.object.visible) return;
    this.acc += dt;
    for (let i = 0; i < this.count; i++) this.ages[i] += dt;
    if (this.acc >= 1 / this.hz) {
      this.acc = 0;
      this.positions[this.head * 3] = pos.x;
      this.positions[this.head * 3 + 1] = pos.y;
      this.positions[this.head * 3 + 2] = pos.z;
      this.ages[this.head] = 0;
      this.head = (this.head + 1) % this.max;
      this.count = Math.min(this.count + 1, this.max);
    }
    if (this.count < 2) return;
    // Unroll the ring oldest-first so the line is continuous and fades from the tail.
    const n = this.count;
    const p = new Array<number>(n * 3);
    const c = new Array<number>(n * 3);
    const start = (this.head - n + this.max) % this.max;
    for (let i = 0; i < n; i++) {
      const src = (start + i) % this.max;
      p[i * 3] = this.positions[src * 3];
      p[i * 3 + 1] = this.positions[src * 3 + 1];
      p[i * 3 + 2] = this.positions[src * 3 + 2];
      const fade = Math.max(0, 1 - this.ages[src] / this.seconds);
      // Warm white smoke that thins into the sky colour.
      c[i * 3] = 0.45 + 0.55 * fade;
      c[i * 3 + 1] = 0.5 + 0.45 * fade;
      c[i * 3 + 2] = 0.6 + 0.35 * fade;
    }
    const geo = new LineGeometry();
    geo.setPositions(p);
    geo.setColors(c);
    this.object.geometry.dispose();
    this.object.geometry = geo;
  }
}
