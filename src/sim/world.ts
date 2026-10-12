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

export class World {
  readonly colliders: Collider[] = [];
  readonly targets: LandingTarget[] = [];
  /** The helipad (flat on the ground, so not a collider). */
  pad: LandingTarget | null = null;

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

export interface FieldLayout {
  /** 'field' (outdoors, default) or 'gym' (an indoor sports hall for micro practice). */
  site: 'field' | 'gym';
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

export function buildSite(site: 'field' | 'gym'): { layout: FieldLayout; world: World } {
  return site === 'gym' ? buildGym() : buildField();
}
