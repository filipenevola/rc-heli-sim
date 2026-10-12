import type { HelicopterSim } from '../sim/physics';
import type { World, FieldLayout } from '../sim/world';
import { rotate, v3 } from '../sim/math';

/**
 * A small top-down map: the pilot, the model with its nose, the landing targets, the obstacles and the wind.
 * North (away from the pilot, -z) is up. The scale grows with the distance to the model so it never leaves the map.
 */
export class Minimap {
  readonly el: HTMLCanvasElement;
  visible = false;
  private ctx: CanvasRenderingContext2D | null;
  private size = 150;

  constructor(container: HTMLElement) {
    this.el = document.createElement('canvas');
    this.el.className = 'minimap';
    this.el.width = this.el.height = this.size * 2; // 2x for crisp lines
    this.el.style.display = 'none';
    container.appendChild(this.el);
    this.ctx = this.el.getContext('2d');
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.el.style.display = on ? '' : 'none';
  }

  /** Radius of ground covered by the map, m: at least 40, more when the model is far. */
  static radiusFor(pilot: { x: number; z: number }, heli: { x: number; z: number }): number {
    return Math.max(40, Math.hypot(heli.x - pilot.x, heli.z - pilot.z) * 1.25 + 8);
  }

  draw(sim: HelicopterSim, world: World, layout: FieldLayout, pilot: { x: number; z: number }, wind: { x: number; z: number; speed: number }): void {
    const g = this.ctx;
    if (!g || !this.visible) return;
    const S = this.size * 2;
    const c = S / 2;
    const radius = Minimap.radiusFor(pilot, sim.state.pos);
    const k = (S / 2 - 8) / radius;
    const X = (x: number) => c + (x - pilot.x) * k;
    const Y = (z: number) => c + (z - pilot.z) * k; // -z (north) is up: canvas y grows downward, world z grows toward the pilot
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.beginPath();
    g.arc(c, c, S / 2 - 2, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.beginPath();
    g.arc(c, c, S / 2 - 4, 0, Math.PI * 2);
    g.clip();
    // Obstacles: boxes and cylinders from the world; the helipad and the ground targets as rings.
    g.fillStyle = 'rgba(255,255,255,0.22)';
    for (const o of world.colliders) {
      if (o.kind === 'box') g.fillRect(X(o.min.x), Y(o.min.z), (o.max.x - o.min.x) * k, (o.max.z - o.min.z) * k);
      else { g.beginPath(); g.arc(X(o.x), Y(o.z), Math.max(2, o.r * k), 0, Math.PI * 2); g.fill(); }
    }
    g.strokeStyle = '#ffd34d';
    g.lineWidth = 2;
    for (const t of world.targets) { g.beginPath(); g.arc(X(t.centre.x), Y(t.centre.z), Math.max(4, 1.5 * k), 0, Math.PI * 2); g.stroke(); }
    if (world.pad) { g.strokeStyle = '#ffffff'; g.beginPath(); g.arc(X(world.pad.centre.x), Y(world.pad.centre.z), Math.max(5, 2.2 * k), 0, Math.PI * 2); g.stroke(); }
    // Gates of the circuits, faint.
    void layout;
    // The pilot.
    g.fillStyle = '#9ec5ff';
    g.beginPath();
    g.arc(X(pilot.x), Y(pilot.z), 5, 0, Math.PI * 2);
    g.fill();
    // The model: a triangle pointing where the nose points; its shadow dot when high.
    const s = sim.state;
    const fwd = rotate(s.ori, v3(0, 0, -1));
    const ang = Math.atan2(fwd.x, -fwd.z); // 0 = north (up on the map)
    g.save();
    g.translate(X(s.pos.x), Y(s.pos.z));
    g.rotate(ang);
    g.fillStyle = s.crashed ? '#ff6a5a' : '#ff8c1a';
    g.beginPath();
    g.moveTo(0, -11);
    g.lineTo(7, 9);
    g.lineTo(0, 5);
    g.lineTo(-7, 9);
    g.closePath();
    g.fill();
    g.restore();
    // Wind arrow (points where the wind blows to) in the corner, length with speed.
    if (wind.speed > 0.2) {
      const wl = Math.min(1, wind.speed / 10);
      const wa = Math.atan2(wind.x, -wind.z);
      g.save();
      g.translate(S - 34, 34);
      g.rotate(wa);
      g.strokeStyle = '#7fd3ff';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, 14 * wl);
      g.lineTo(0, -16 * wl);
      g.moveTo(-6, -8 * wl);
      g.lineTo(0, -16 * wl);
      g.lineTo(6, -8 * wl);
      g.stroke();
      g.restore();
    }
    g.restore();
    // Scale label.
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = '20px system-ui, sans-serif';
    g.fillText(`${Math.round(radius)} m`, 14, S - 14);
  }
}
