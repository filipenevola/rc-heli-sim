import type { V3 } from './math';
import { BILLBOARDS, billboardFootprint } from './ads';

/**
 * Static world geometry shared by the physics (collisions, landing targets) and the renderer (meshes).
 * One definition so what you see is exactly what you can hit or land on. World frame: y up, the pilot
 * stands at the origin, the helipad is at z = -6 (in front of the pilot).
 */
export type Collider =
  | { kind: 'box'; name: string; min: V3; max: V3; target?: LandingTarget }
  | { kind: 'cylinder'; name: string; x: number; z: number; r: number; y0: number; y1: number; target?: LandingTarget };

export interface LandingTarget {
  id: string;
  name: string;
  /** Centre of the landing surface (world) and the radius that counts as "on target". */
  centre: V3;
  radius: number;
}

export interface ContactHit {
  normal: V3;
  depth: number;
  collider: Collider;
}

/** Ground height field. Flat sites have none (ground is y = 0 everywhere). */
export interface Terrain {
  heightAt(x: number, z: number): number;
}

/** A landing target painted on the ground itself (the helipad, a slope mark): no collider, detected by distance. */
export interface GroundTarget extends LandingTarget {
  /** Skids resting within this distance of the centre count as "on it" (the ring you see on the ground). */
  reach: number;
}

export class World {
  readonly colliders: Collider[] = [];
  readonly targets: LandingTarget[] = [];
  /** The helipad (flat on the ground, so not a collider). */
  pad: LandingTarget | null = null;
  /** Marks painted on the ground (slope landing spots): targets without a collider. */
  readonly groundTargets: GroundTarget[] = [];
  /** Height field, when the site is not flat. */
  terrain: Terrain | null = null;

  /** Ground height under a point. */
  groundAt(x: number, z: number): number {
    return this.terrain ? this.terrain.heightAt(x, z) : 0;
  }

  /** Unit ground normal under a point (central differences on the height field). */
  groundNormal(x: number, z: number, out: V3): V3 {
    if (!this.terrain) { out.x = 0; out.y = 1; out.z = 0; return out; }
    const e = 0.25;
    const gx = (this.terrain.heightAt(x + e, z) - this.terrain.heightAt(x - e, z)) / (2 * e);
    const gz = (this.terrain.heightAt(x, z + e) - this.terrain.heightAt(x, z - e)) / (2 * e);
    const l = Math.hypot(gx, 1, gz);
    out.x = -gx / l; out.y = 1 / l; out.z = -gz / l;
    return out;
  }

  /** Ground slope under a point, degrees. */
  slopeDeg(x: number, z: number): number {
    const n = this.groundNormal(x, z, { x: 0, y: 1, z: 0 });
    return (Math.acos(Math.min(1, n.y)) * 180) / Math.PI;
  }

  /** Trees and buildings as wind obstacles (footprint radius + height). */
  windObstacles(): { x: number; z: number; r: number; h: number }[] {
    const out: { x: number; z: number; r: number; h: number }[] = [];
    for (const c of this.colliders) {
      if (c.kind === 'cylinder' && c.y1 > 2.5) out.push({ x: c.x, z: c.z, r: c.r, h: c.y1 });
      else if (c.kind === 'box' && c.max.y > 2.5 && c.max.x - c.min.x < 30) out.push({ x: (c.min.x + c.max.x) / 2, z: (c.min.z + c.max.z) / 2, r: Math.max(c.max.x - c.min.x, c.max.z - c.min.z) / 2, h: c.max.y });
    }
    return out;
  }

  add(c: Collider): void {
    this.colliders.push(c);
    if (c.target) this.targets.push(c.target);
  }

  addGroundTarget(t: GroundTarget): void {
    this.groundTargets.push(t);
    this.targets.push(t);
  }

  /** Deepest penetration of a point into any collider, or null when free. */
  hit(p: V3, out: ContactHit): boolean {
    let best = 0;
    let found = false;
    for (const c of this.colliders) {
      if (c.kind === 'box') {
        if (p.x < c.min.x || p.x > c.max.x || p.y < c.min.y || p.y > c.max.y || p.z < c.min.z || p.z > c.max.z) continue;
        // Smallest way out.
        const cand: [number, V3][] = [
          [p.x - c.min.x, { x: -1, y: 0, z: 0 }],
          [c.max.x - p.x, { x: 1, y: 0, z: 0 }],
          [c.max.y - p.y, { x: 0, y: 1, z: 0 }],
          [p.y - c.min.y, { x: 0, y: -1, z: 0 }],
          [p.z - c.min.z, { x: 0, y: 0, z: -1 }],
          [c.max.z - p.z, { x: 0, y: 0, z: 1 }],
        ];
        let d = Infinity;
        let n = cand[2][1];
        for (const [dd, nn] of cand) if (dd < d) { d = dd; n = nn; }
        if (!found || d > best) { best = d; found = true; out.normal = n; out.depth = d; out.collider = c; }
      } else {
        if (p.y < c.y0 || p.y > c.y1) continue;
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        const dist = Math.hypot(dx, dz);
        if (dist > c.r) continue;
        const radial = c.r - dist;
        const top = c.y1 - p.y;
        const bottom = p.y - c.y0;
        let d: number;
        let n: V3;
        if (top <= radial && top <= bottom) { d = top; n = { x: 0, y: 1, z: 0 }; }
        else if (bottom < radial) { d = bottom; n = { x: 0, y: -1, z: 0 }; }
        else { d = radial; n = dist > 1e-6 ? { x: dx / dist, y: 0, z: dz / dist } : { x: 1, y: 0, z: 0 }; }
        if (!found || d > best) { best = d; found = true; out.normal = n; out.depth = d; out.collider = c; }
      }
    }
    return found;
  }
}

export const emptyHit = (): ContactHit => ({ normal: { x: 0, y: 1, z: 0 }, depth: 0, collider: { kind: 'box', name: '', min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } } });

/* ------------------------------------------------------------------------------------------------ */
/* The flying field                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

export interface TreeSpec { x: number; z: number; scale: number }
export interface HouseSpec { x: number; z: number; w: number; d: number; h: number; rot: number; color: number; roof: number }
export interface AnimalSpec { x: number; z: number; kind: 'cow' | 'sheep'; rot: number }
export interface BaleSpec { x: number; z: number; rot: number }

export interface HallSpec {
  /** Inner half-width (x) and the z extent of the hall; height of the ceiling. */
  halfW: number;
  zFront: number;
  zBack: number;
  height: number;
}

export interface LotSpec {
  /** Half extents of the asphalt. */
  halfW: number;
  halfD: number;
  poles: { x: number; z: number }[];
  cars: { x: number; z: number; rot: number; color: number }[];
  warehouses: { x: number; z: number; w: number; d: number; h: number; color: number }[];
}

export interface SlopeMark {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Ring radius drawn on the grass; skids resting inside it count. */
  r: number;
  /** Nominal slope at the mark, degrees (for labels). */
  deg: number;
}

export interface HillSpec {
  /** Boulders: position, radius. Solid. */
  rocks: { x: number; z: number; r: number }[];
  marks: SlopeMark[];
}

export interface FieldLayout {
  /** 'field' (outdoors, default), 'gym' (an indoor sports hall), 'lot' (the club's parking lot) or 'hill' (the hillside). */
  site: 'field' | 'gym' | 'lot' | 'hill';
  /** Parking-lot furniture (lot only). */
  lot?: LotSpec;
  /** Hillside furniture (hill only); the height field itself lives on the World. */
  hill?: HillSpec;
  hall?: HallSpec;
  trees: TreeSpec[];
  houses: HouseSpec[];
  animals: AnimalSpec[];
  bales: BaleSpec[];
  pond: { x: number; z: number; r: number };
  road: { x: number; z: number; length: number; width: number; rot: number };
  windsock: { x: number; z: number; height: number };
  platforms: PlatformSpec[];
}

export interface PlatformSpec {
  id: string;
  name: string;
  /** Centre of the landing surface. */
  x: number;
  z: number;
  /** Surface height above ground. */
  height: number;
  /** Landing surface size (square side or disc diameter). */
  size: number;
  /** How the thing looks. */
  style: 'table' | 'truck' | 'tower' | 'pontoon';
  /** Radius that counts as a precise landing. */
  radius: number;
}

export function buildField(): { layout: FieldLayout; world: World } {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const world = new World();
  const layout: FieldLayout = {
    site: 'field',
    trees: [],
    houses: [],
    animals: [],
    bales: [],
    pond: { x: 42, z: -22, r: 11 },
    road: { x: 0, z: 70, length: 260, width: 5, rot: 0 },
    windsock: { x: -6, z: -3, height: 3.5 },
    platforms: [
      { id: 'table', name: 'Picnic table', x: 9, z: -12, height: 0.9, size: 1.4, style: 'table', radius: 0.5 },
      { id: 'truck', name: 'Pickup bed', x: -14, z: -22, height: 1.0, size: 1.6, style: 'truck', radius: 0.55 },
      { id: 'tower', name: 'Tower pad', x: 22, z: -42, height: 7, size: 1.6, style: 'tower', radius: 0.6 },
      { id: 'pontoon', name: 'Pond pontoon', x: 42, z: -22, height: 0.25, size: 1.5, style: 'pontoon', radius: 0.5 },
    ],
  };

  // Trees: a ring around the field, denser at the back, none on the road or the pond.
  for (let i = 0; i < 140; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = 45 + rnd() * 60;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    if (Math.hypot(x - layout.pond.x, z - layout.pond.z) < layout.pond.r + 3) continue;
    if (Math.abs(z - layout.road.z) < 5) continue;
    const scale = 0.8 + rnd() * 0.8;
    layout.trees.push({ x, z, scale });
    // Trunk + crown as one slightly conservative cylinder.
    world.add({ kind: 'cylinder', name: 'a tree', x, z, r: 1.7 * scale, y0: 0, y1: 8.5 * scale });
  }

  // A small farm on the left and a couple of houses on the right.
  const houses: HouseSpec[] = [
    { x: -58, z: -38, w: 9, d: 7, h: 3.2, rot: 0.2, color: 0xe8e2d2, roof: 0x8a3b2b },
    { x: -70, z: -22, w: 7, d: 6, h: 3, rot: -0.3, color: 0xf0e6c8, roof: 0x6b4a3a },
    { x: -52, z: -12, w: 14, d: 8, h: 4.5, rot: 0.05, color: 0xa33a2d, roof: 0x3a3a3a }, // barn
    { x: 60, z: -48, w: 8, d: 7, h: 3.1, rot: 0.6, color: 0xdfe6ee, roof: 0x4b4f66 },
    { x: 68, z: -30, w: 6, d: 6, h: 2.8, rot: -0.1, color: 0xf5efe0, roof: 0x7a4a2a },
  ];
  for (const h of houses) {
    layout.houses.push(h);
    // Rotated boxes are approximated by their bounding box plus the roof height. Good enough for a crash.
    const ext = (Math.abs(Math.cos(h.rot)) * h.w + Math.abs(Math.sin(h.rot)) * h.d) / 2;
    const extZ = (Math.abs(Math.sin(h.rot)) * h.w + Math.abs(Math.cos(h.rot)) * h.d) / 2;
    world.add({ kind: 'box', name: 'a house', min: { x: h.x - ext, y: 0, z: h.z - extZ }, max: { x: h.x + ext, y: h.h + h.d * 0.3, z: h.z + extZ } });
  }

  // Cattle and sheep grazing between the farm and the field.
  for (let i = 0; i < 7; i++) layout.animals.push({ x: -34 + rnd() * 14, z: -30 + rnd() * 16, kind: 'cow', rot: rnd() * Math.PI * 2 });
  for (let i = 0; i < 10; i++) layout.animals.push({ x: 20 + rnd() * 14, z: 8 + rnd() * 14, kind: 'sheep', rot: rnd() * Math.PI * 2 });
  for (const a of layout.animals) {
    const r = a.kind === 'cow' ? 0.9 : 0.5;
    world.add({ kind: 'cylinder', name: a.kind === 'cow' ? 'a cow' : 'a sheep', x: a.x, z: a.z, r, y0: 0, y1: a.kind === 'cow' ? 1.5 : 0.9 });
  }

  // Hay bales to hop over.
  for (let i = 0; i < 6; i++) {
    const b = { x: -8 + rnd() * 26, z: 6 + rnd() * 14, rot: rnd() * Math.PI };
    layout.bales.push(b);
    world.add({ kind: 'cylinder', name: 'a hay bale', x: b.x, z: b.z, r: 0.8, y0: 0, y1: 1.5 });
  }

  // Fence along the back and the windsock pole.
  world.add({ kind: 'box', name: 'the fence', min: { x: -45, y: 0, z: -30.15 }, max: { x: 45, y: 1.2, z: -29.85 } });
  world.add({ kind: 'cylinder', name: 'the windsock pole', x: layout.windsock.x, z: layout.windsock.z, r: 0.08, y0: 0, y1: layout.windsock.height });

  // Landing platforms: the surface is a thin box so skids can rest on it; the support below is a collider too.
  for (const p of layout.platforms) {
    const half = p.size / 2;
    const target: LandingTarget = { id: p.id, name: p.name, centre: { x: p.x, y: p.height, z: p.z }, radius: p.radius };
    world.add({ kind: 'box', name: p.name, target, min: { x: p.x - half, y: Math.max(0, p.height - 0.08), z: p.z - half }, max: { x: p.x + half, y: p.height, z: p.z + half } });
    if (p.style === 'tower') world.add({ kind: 'cylinder', name: 'the tower', x: p.x, z: p.z, r: 0.35, y0: 0, y1: p.height - 0.08 });
    if (p.style === 'truck') world.add({ kind: 'box', name: 'the pickup cab', min: { x: p.x - 1.0, y: 0, z: p.z - 3.3 }, max: { x: p.x + 1.0, y: 1.9, z: p.z - 1.1 } });
    if (p.style === 'table') world.add({ kind: 'box', name: 'the table', min: { x: p.x - 0.5, y: 0, z: p.z - 0.5 }, max: { x: p.x + 0.5, y: p.height - 0.08, z: p.z + 0.5 } });
  }

  world.pad = { id: 'pad', name: 'helipad', centre: { x: 0, y: 0, z: -6 }, radius: 0.5 };

  // Billboards: the panel plus its posts, as one box each.
  for (const b of BILLBOARDS) {
    const f = billboardFootprint(b);
    world.add({ kind: 'box', name: `the ${b.name} billboard`, min: { x: f.minX, y: 0, z: f.minZ }, max: { x: f.maxX, y: b.elevation + b.height + 0.2, z: f.maxZ } });
  }

  return { layout, world };
}


/**
 * An indoor sports hall: 36 x 48 m, 12 m to the ceiling, bleachers along one side and a hoop at each end. No wind,
 * walls and ceiling that bite, two low landing targets (a stack of mats and a vault box). Micro-sized practice.
 */
export function buildGym(): { layout: FieldLayout; world: World } {
  const world = new World();
  const hall: HallSpec = { halfW: 18, zFront: 10, zBack: -38, height: 12 };
  const layout: FieldLayout = {
    site: 'gym',
    hall,
    trees: [],
    houses: [],
    animals: [],
    bales: [],
    pond: { x: 0, z: 0, r: 0 },
    road: { x: 0, z: 0, length: 0, width: 0, rot: 0 },
    windsock: { x: -6, z: -3, height: 0 },
    platforms: [
      { id: 'mat', name: 'Mat stack', x: 8, z: -16, height: 0.5, size: 2.0, style: 'table', radius: 0.6 },
      { id: 'vault', name: 'Vault box', x: -9, z: -22, height: 1.2, size: 1.2, style: 'table', radius: 0.45 },
    ],
  };
  for (const p of layout.platforms) {
    const half = p.size / 2;
    const target: LandingTarget = { id: p.id, name: p.name, centre: { x: p.x, y: p.height, z: p.z }, radius: p.radius };
    world.add({ kind: 'box', name: p.name, target, min: { x: p.x - half, y: Math.max(0, p.height - 0.08), z: p.z - half }, max: { x: p.x + half, y: p.height, z: p.z + half } });
    world.add({ kind: 'box', name: p.name, min: { x: p.x - half, y: 0, z: p.z - half }, max: { x: p.x + half, y: p.height - 0.08, z: p.z + half } });
  }
  world.pad = { id: 'pad', name: 'helipad', centre: { x: 0, y: 0, z: -6 }, radius: 0.5 };
  // Walls, ceiling.
  const t = 1;
  world.add({ kind: 'box', name: 'the wall', min: { x: -hall.halfW - t, y: 0, z: hall.zBack - t }, max: { x: -hall.halfW, y: hall.height + t, z: hall.zFront + t } });
  world.add({ kind: 'box', name: 'the wall', min: { x: hall.halfW, y: 0, z: hall.zBack - t }, max: { x: hall.halfW + t, y: hall.height + t, z: hall.zFront + t } });
  world.add({ kind: 'box', name: 'the wall', min: { x: -hall.halfW, y: 0, z: hall.zFront }, max: { x: hall.halfW, y: hall.height + t, z: hall.zFront + t } });
  world.add({ kind: 'box', name: 'the wall', min: { x: -hall.halfW, y: 0, z: hall.zBack - t }, max: { x: hall.halfW, y: hall.height + t, z: hall.zBack } });
  world.add({ kind: 'box', name: 'the ceiling', min: { x: -hall.halfW, y: hall.height, z: hall.zBack }, max: { x: hall.halfW, y: hall.height + t, z: hall.zFront } });
  // Bleachers along the +x wall: five steps.
  for (let i = 0; i < 5; i++) {
    world.add({ kind: 'box', name: 'the bleachers', min: { x: hall.halfW - 5 + i, y: 0, z: hall.zBack + 8 }, max: { x: hall.halfW, y: 0.45 * (i + 1), z: hall.zFront - 8 } });
  }
  // Hoops at each end: pole and backboard.
  for (const z of [hall.zFront - 1.2, hall.zBack + 1.2]) {
    world.add({ kind: 'cylinder', name: 'the hoop post', x: 0, z, r: 0.08, y0: 0, y1: 3.9 });
    world.add({ kind: 'box', name: 'the backboard', min: { x: -0.9, y: 2.9, z: z - 0.05 }, max: { x: 0.9, y: 3.95, z: z + 0.05 } });
  }
  return { layout, world };
}

/**
 * The club's parking lot: a big slab of asphalt with bays, light poles, a few parked cars, a shipping container
 * with a flat roof to land on (2.6 m, no ground effect to speak of) and warehouses along the back. Open and
 * windy; the poles and the container are what bite.
 */
export function buildLot(): { layout: FieldLayout; world: World } {
  const world = new World();
  const lot: LotSpec = {
    halfW: 55,
    halfD: 45,
    poles: [
      { x: -30, z: -30 }, { x: 0, z: -30 }, { x: 30, z: -30 },
      { x: -30, z: 10 }, { x: 30, z: 10 },
      { x: -45, z: -10 }, { x: 45, z: -10 },
    ],
    cars: [
      { x: -22, z: -16, rot: 0, color: 0xc8d0d8 }, { x: -18, z: -16, rot: 0, color: 0x3a3f47 }, { x: -14, z: -16, rot: 0, color: 0x8b1e1e },
      { x: 24, z: 6, rot: Math.PI / 2, color: 0x1f5fd6 }, { x: 24, z: 12, rot: Math.PI / 2, color: 0xf2f2f2 },
      { x: 36, z: -22, rot: 0.2, color: 0x2a8f4a },
    ],
    warehouses: [
      { x: -25, z: -60, w: 40, d: 18, h: 7, color: 0x9aa3ad }, { x: 25, z: -60, w: 36, d: 18, h: 6, color: 0xb8a98a },
    ],
  };
  const layout: FieldLayout = {
    site: 'lot',
    lot,
    trees: [],
    houses: [],
    animals: [],
    bales: [],
    pond: { x: 0, z: 0, r: 0 },
    road: { x: 0, z: 0, length: 0, width: 0, rot: 0 },
    windsock: { x: -6, z: -3, height: 3.5 },
    platforms: [{ id: 'container', name: 'Container roof', x: 12, z: -24, height: 2.6, size: 2.4, style: 'table', radius: 0.6 }],
  };
  for (const p of layout.platforms) {
    const half = p.size / 2;
    const target: LandingTarget = { id: p.id, name: p.name, centre: { x: p.x, y: p.height, z: p.z }, radius: p.radius };
    // A 6 m container: the roof is the target, the box below is solid.
    world.add({ kind: 'box', name: p.name, target, min: { x: p.x - half, y: p.height - 0.08, z: p.z - 3 }, max: { x: p.x + half, y: p.height, z: p.z + 3 } });
    world.add({ kind: 'box', name: 'the container', min: { x: p.x - half, y: 0, z: p.z - 3 }, max: { x: p.x + half, y: p.height - 0.08, z: p.z + 3 } });
  }
  world.pad = { id: 'pad', name: 'helipad', centre: { x: 0, y: 0, z: -6 }, radius: 0.5 };
  for (const pole of lot.poles) world.add({ kind: 'cylinder', name: 'a light pole', x: pole.x, z: pole.z, r: 0.18, y0: 0, y1: 9 });
  for (const c of lot.cars) {
    const cs = Math.abs(Math.cos(c.rot));
    const sn = Math.abs(Math.sin(c.rot));
    const hx = 2.2 * cs + 0.9 * sn;
    const hz = 2.2 * sn + 0.9 * cs;
    world.add({ kind: 'box', name: 'a parked car', min: { x: c.x - hx, y: 0, z: c.z - hz }, max: { x: c.x + hx, y: 1.5, z: c.z + hz } });
  }
  for (const w of lot.warehouses) world.add({ kind: 'box', name: 'a warehouse', min: { x: w.x - w.w / 2, y: 0, z: w.z - w.d / 2 }, max: { x: w.x + w.w / 2, y: w.h, z: w.z + w.d / 2 } });
  // Fence around the lot.
  const f = 0.15;
  world.add({ kind: 'box', name: 'the fence', min: { x: -lot.halfW - f, y: 0, z: -lot.halfD }, max: { x: -lot.halfW, y: 2, z: lot.halfD } });
  world.add({ kind: 'box', name: 'the fence', min: { x: lot.halfW, y: 0, z: -lot.halfD }, max: { x: lot.halfW + f, y: 2, z: lot.halfD } });
  world.add({ kind: 'box', name: 'the fence', min: { x: -lot.halfW, y: 0, z: lot.halfD }, max: { x: lot.halfW, y: 2, z: lot.halfD + f } });
  return { layout, world };
}

/* ------------------------------------------------------------------------------------------------ */
/* The hillside                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

/** C1-smooth ramp: 0 for u <= 0, a parabola for the first 4 m, then slope 1 (u - 2). */
const ramp = (u: number): number => (u <= 0 ? 0 : u < 4 ? (u * u) / 8 : u - 2);

/**
 * The hillside height field. A flat meadow around the pad; in front of the pilot (-z) the ground climbs at
 * 10° for 60 m and rounds off into a knoll; to the right (+x) a steeper 20° bank. Gentle undulation away
 * from the pad so the ground is never a plane. Deterministic and cheap: called per contact point per step.
 */
export const HILL_TERRAIN: Terrain = {
  heightAt(x: number, z: number): number {
    // 10° slope rising toward -z from z = -14 (tan 10° = 0.176), rolling off toward 20 m.
    const h1 = 20 * Math.tanh((0.1763 * ramp(-14 - z)) / 20);
    // 20° bank rising toward +x from x = 26 (tan 20° = 0.364), rolling off toward 24 m.
    const h2 = 24 * Math.tanh((0.364 * ramp(x - 26)) / 24);
    // Undulation, faded out near the pad (flat start and hover drills) and near the two marks (true slopes there).
    const fade = (cx: number, cz: number, r0: number, r1: number): number => {
      const d = Math.hypot(x - cx, z - cz);
      return d < r0 ? 0 : d < r1 ? (d - r0) / (r1 - r0) : 1;
    };
    const bumps = 0.18 * fade(0, -6, 14, 30) * fade(0, -34, 6, 14) * fade(40, -8, 6, 14) * Math.sin(x * 0.31 + 1) * Math.sin(z * 0.27);
    return h1 + h2 + bumps;
  },
};

/**
 * The hillside: a sloping meadow with two marked slope landing spots (10° in front, 20° on the right bank),
 * boulders, a few pines and a fence line. Open sky, wind, and terrain the wind has to climb: the upwash on
 * the windward face is real.
 */
export function buildHill(): { layout: FieldLayout; world: World } {
  const world = new World();
  world.terrain = HILL_TERRAIN;
  const hill: HillSpec = {
    rocks: [
      { x: -18, z: -36, r: 1.4 }, { x: -22, z: -40, r: 0.9 }, { x: 20, z: -48, r: 1.8 }, { x: 44, z: -30, r: 1.2 },
      { x: -34, z: -18, r: 1.1 }, { x: 8, z: -70, r: 2.2 }, { x: -6, z: -78, r: 1.0 }, { x: 52, z: 8, r: 1.3 },
    ],
    marks: [
      { id: 'slope', name: 'Slope mark (10°)', x: 0, z: -34, r: 2.0, deg: 10 },
      { id: 'bank', name: 'Bank mark (20°)', x: 40, z: -8, r: 2.0, deg: 20 },
    ],
  };
  let seed = 23;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const trees: TreeSpec[] = [];
  // Pines along the left edge and scattered up the slope, never on the marks or the pad.
  for (let i = 0; i < 26; i++) {
    const x = -24 - rnd() * 30;
    const z = 20 - rnd() * 100;
    trees.push({ x, z, scale: 0.8 + rnd() * 0.6 });
  }
  for (let i = 0; i < 10; i++) {
    const x = -10 + rnd() * 50;
    const z = -56 - rnd() * 34;
    trees.push({ x, z, scale: 0.7 + rnd() * 0.5 });
  }
  const layout: FieldLayout = {
    site: 'hill',
    hill,
    trees,
    houses: [],
    animals: [
      { x: -14, z: -24, kind: 'sheep', rot: 0.4 }, { x: -11, z: -27, kind: 'sheep', rot: 2.1 }, { x: -16, z: -29, kind: 'sheep', rot: 1.2 },
      { x: 30, z: -40, kind: 'sheep', rot: 3.0 }, { x: 33, z: -44, kind: 'sheep', rot: 0.2 },
    ],
    bales: [],
    pond: { x: 0, z: 0, r: 0 },
    road: { x: 0, z: 0, length: 0, width: 0, rot: 0 },
    windsock: { x: -6, z: -3, height: 3.5 },
    platforms: [],
  };
  world.pad = { id: 'pad', name: 'helipad', centre: { x: 0, y: 0, z: -6 }, radius: 0.5 };
  for (const m of hill.marks) world.addGroundTarget({ id: m.id, name: m.name, centre: { x: m.x, y: HILL_TERRAIN.heightAt(m.x, m.z), z: m.z }, radius: 0.6, reach: m.r });
  for (const r of hill.rocks) world.add({ kind: 'cylinder', name: 'a boulder', x: r.x, z: r.z, r: r.r, y0: HILL_TERRAIN.heightAt(r.x, r.z) - 1, y1: HILL_TERRAIN.heightAt(r.x, r.z) + r.r * 0.9 });
  for (const t of trees) world.add({ kind: 'cylinder', name: 'a tree', x: t.x, z: t.z, r: 1.6 * t.scale, y0: HILL_TERRAIN.heightAt(t.x, t.z), y1: HILL_TERRAIN.heightAt(t.x, t.z) + 9 * t.scale });
  // Fence posts along the bottom edge (behind the pilot) so the meadow has a boundary to read distance from.
  for (let x = -40; x <= 40; x += 4) world.add({ kind: 'cylinder', name: 'a fence post', x, z: 22, r: 0.08, y0: HILL_TERRAIN.heightAt(x, 22), y1: HILL_TERRAIN.heightAt(x, 22) + 1.2 });
  return { layout, world };
}

export function buildSite(site: 'field' | 'gym' | 'lot' | 'hill'): { layout: FieldLayout; world: World } {
  return site === 'gym' ? buildGym() : site === 'lot' ? buildLot() : site === 'hill' ? buildHill() : buildField();
}
