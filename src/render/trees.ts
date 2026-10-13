import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TreeSpec } from '../sim/world';
import type { SwayLayer } from './sway';

/**
 * Two kinds of tree, instanced: conifers (stacked ragged tiers) and broadleaf (clumped, lumpy crowns). Every crown
 * is built inside the physics collider (radius 1.7 x scale, top 8.5 x scale) so a blade strike happens exactly
 * where the leaves are.
 */
export const TREE_COLLIDER = { radius: 1.7, top: 8.5 };

export function createTrees(trees: TreeSpec[]): { group: THREE.Group; layers: SwayLayer[] } {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  // Every third tree a broadleaf, the rest pines (the field's mix since 0.32). The instance matrices are rewritten by
  // the wind sway every frame (sway.ts), which pivots each whole tree about its base.
  const kinds = [
    { geo: buildConifer(), index: [] as number[] },
    { geo: buildBroadleaf(), index: [] as number[] },
  ];
  trees.forEach((_, i) => kinds[i % 3 === 2 ? 1 : 0].index.push(i));
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  const layers: SwayLayer[] = [];
  for (const k of kinds) {
    if (!k.index.length) continue;
    const mesh = new THREE.InstancedMesh(k.geo, mat, k.index.length);
    k.index.forEach((ti, i) => {
      const t = trees[ti];
      m.makeScale(t.scale, t.scale, t.scale).setPosition(t.x, 0, t.z);
      mesh.setMatrixAt(i, m);
      const v = 0.85 + hash(t.x * 3.1, t.z * 1.7) * 0.3;
      col.setRGB(v * (0.95 + hash(t.x, 9) * 0.15), v, v * 0.9);
      mesh.setColorAt(i, col);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    layers.push({ mesh, cy: 0, index: k.index });
  }
  return { group, layers };
}

function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function paint(g: THREE.BufferGeometry, f: (p: THREE.Vector3, n: THREE.Vector3) => [number, number, number]): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.computeVertexNormals();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const c: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    c.push(...f(p, n));
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  geo.deleteAttribute('uv');
  return geo;
}

/** Scale a crown so it fits inside the collider (with a small margin), whatever the noise did. */
function fitCrown(g: THREE.BufferGeometry, maxR: number, maxTop: number): void {
  const pos = g.attributes.position;
  let r = 0;
  let top = 0;
  for (let i = 0; i < pos.count; i++) {
    r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)));
    top = Math.max(top, pos.getY(i));
  }
  const sr = Math.min(1, maxR / r);
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * sr, pos.getY(i), pos.getZ(i) * sr);
  if (top > maxTop) {
    // Squash towards the crown base rather than shrinking the trunk.
    let bottom = Infinity;
    for (let i = 0; i < pos.count; i++) bottom = Math.min(bottom, pos.getY(i));
    const sy = (maxTop - bottom) / (top - bottom);
    for (let i = 0; i < pos.count; i++) pos.setY(i, bottom + (pos.getY(i) - bottom) * sy);
  }
  pos.needsUpdate = true;
}

function trunk(r0: number, r1: number, h: number): THREE.BufferGeometry {
  const t = new THREE.CylinderGeometry(r1, r0, h, 8, 2);
  t.translate(0, h / 2, 0);
  return paint(t, (p) => {
    const v = 0.55 + 0.45 * (p.y / h);
    return [0.13 * v, 0.085 * v, 0.05 * v];
  });
}

function buildConifer(): THREE.BufferGeometry {
  const tiers: THREE.BufferGeometry[] = [];
  const specs = [
    { y: 2.3, h: 2.7, r: 1.6 },
    { y: 3.8, h: 2.4, r: 1.28 },
    { y: 5.25, h: 2.1, r: 0.96 },
    { y: 6.6, h: 1.85, r: 0.62 },
  ];
  specs.forEach((s, ti) => {
    const cone = new THREE.ConeGeometry(s.r, s.h, 14, 3, true);
    const pos = cone.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const atBase = y < -s.h / 2 + 0.01;
      // Ragged hem: branch tips droop and stick out at different lengths.
      const jag = atBase ? 1 + 0.12 * Math.sin(a * 7 + ti * 2.1) : 1 + 0.05 * Math.sin(a * 5 + y * 3);
      const droop = atBase ? -0.22 * (0.5 + 0.5 * Math.sin(a * 7 + ti)) : 0;
      pos.setXYZ(i, x * jag, y + droop, z * jag);
    }
    cone.translate(0, s.y + s.h / 2, 0);
    tiers.push(cone);
  });
  const crown = mergeGeometries(tiers.map((t) => (t.index ? t.toNonIndexed() : t)))!;
  fitCrown(crown, TREE_COLLIDER.radius - 0.08, TREE_COLLIDER.top - 0.1);
  const crownPainted = paint(crown, (p, n) => {
    const r = Math.hypot(p.x, p.z);
    const outer = THREE.MathUtils.clamp(r / 1.2, 0.3, 1);
    const lit = 0.55 + 0.45 * Math.max(0, n.y) ;
    const v = lit * (0.55 + 0.45 * outer) * (0.8 + 0.2 * (p.y / 8.4));
    return [0.035 * v, 0.11 * v, 0.05 * v];
  });
  return mergeGeometries([trunk(0.3, 0.16, 3.2), crownPainted])!;
}

function buildBroadleaf(): THREE.BufferGeometry {
  const blobs: THREE.BufferGeometry[] = [];
  const centres: [number, number, number, number][] = [
    [0, 5.6, 0, 1.05],
    [0.75, 4.9, 0.2, 0.8],
    [-0.7, 5.1, -0.35, 0.82],
    [0.15, 4.6, -0.8, 0.75],
    [-0.25, 4.7, 0.8, 0.78],
    [0.45, 6.5, -0.2, 0.85],
    [-0.4, 6.7, 0.35, 0.78],
    [0.05, 7.4, 0.0, 0.7],
  ];
  centres.forEach(([x, y, z, r], bi) => {
    const ico = new THREE.IcosahedronGeometry(r, 2);
    const pos = ico.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const n = 1 + 0.16 * Math.sin(vx * 7.1 + bi) * Math.sin(vy * 6.3 + 1.3) * Math.sin(vz * 5.7 + bi * 2);
      pos.setXYZ(i, vx * n, vy * n * 0.92, vz * n);
    }
    ico.translate(x, y, z);
    blobs.push(ico);
  });
  const crown = mergeGeometries(blobs)!;
  fitCrown(crown, TREE_COLLIDER.radius - 0.08, TREE_COLLIDER.top - 0.15);
  const crownPainted = paint(crown, (p, n) => {
    const dc = Math.hypot(p.x, p.y - 5.7, p.z);
    const outer = THREE.MathUtils.clamp(dc / 1.6, 0.35, 1.05);
    const lit = 0.55 + 0.45 * Math.max(0, n.y * 0.7 + 0.3);
    const v = lit * outer;
    return [0.075 * v, 0.17 * v, 0.04 * v];
  });
  // Trunk and two limbs reaching into the crown.
  const limbs: THREE.BufferGeometry[] = [trunk(0.36, 0.22, 4.2)];
  for (const [ax, az] of [[0.5, 0.2], [-0.45, -0.3]]) {
    const l = new THREE.CylinderGeometry(0.07, 0.13, 1.6, 6);
    l.translate(0, 0.8, 0);
    l.rotateZ(-ax);
    l.rotateX(az);
    l.translate(0, 3.6, 0);
    limbs.push(paint(l, () => [0.1, 0.07, 0.045]));
  }
  return mergeGeometries([...limbs, crownPainted])!;
}
