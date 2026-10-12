import * as THREE from 'three';
import type { FieldLayout, World } from '../sim/world';
import { makeGrassTexture, makePadTexture, outdoorLighting, type SceneHandles } from './scene';
import { makeSway, type SwayLayer } from './sway';

/**
 * The hillside: the terrain mesh is sampled from the same height field the physics uses, so what you see is
 * exactly what the skids touch. Grass shades toward straw on the steep faces, rings mark the two slope spots,
 * pines on the left, boulders, a fence line behind the pilot.
 */
export function createHillScene(layout: FieldLayout, world: World): SceneHandles {
  const hill = layout.hill!;
  const scene = new THREE.Scene();
  const { sun, setTimeOfDay } = outdoorLighting(scene, 130);
  const shadowed = <T extends THREE.Object3D>(o: T): T => {
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
      }
    });
    return o;
  };
  const decal = (mat: THREE.Material): THREE.Material => {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    return mat;
  };
  const g = (x: number, z: number) => world.groundAt(x, z);

  // Terrain: 360 × 360 m at 2 m resolution, displaced by the height field, vertex-coloured by slope and height.
  const size = 360;
  const segs = 180;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const n = { x: 0, y: 1, z: 0 };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = g(x, z);
    pos.setY(i, y);
    world.groundNormal(x, z, n);
    const steep = Math.min(1, (Math.acos(Math.min(1, n.y)) * 180) / Math.PI / 24); // 0 flat .. 1 at 24°
    // Fresh green on the flat, straw on the steep faces, a touch darker up high.
    c.setHSL(0.27 - steep * 0.12, 0.5 - steep * 0.12, 0.36 - y * 0.004 + steep * 0.1);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const grass = makeGrassTexture();
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
  grass.repeat.set(size / 4, size / 4);
  grass.anisotropy = 8;
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 1 }));
  terrain.receiveShadow = true;
  scene.add(terrain);
  // Flat far ground beyond the terrain so the horizon is not a cliff.
  const far = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ color: 0x5c8a3a, roughness: 1 }));
  far.rotation.x = -Math.PI / 2;
  far.position.y = -0.5;
  scene.add(far);

  // Helipad where the heli starts (the meadow is flat there).
  const pad = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), decal(new THREE.MeshStandardMaterial({ map: makePadTexture(), roughness: 0.9 })));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.01, -6);
  pad.receiveShadow = true;
  scene.add(pad);

  // Slope marks: a ring draped on the terrain (every vertex lifted to the local ground), orange with a white inner line.
  for (const m of hill.marks) {
    for (const [r0, r1, color] of [[m.r - 0.18, m.r, 0xff6a00], [0.3, 0.42, 0xf2f2f2]] as [number, number, number][]) {
      const ring = new THREE.RingGeometry(r0, r1, 64);
      ring.rotateX(-Math.PI / 2);
      const rp = ring.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < rp.count; i++) {
        const x = rp.getX(i) + m.x;
        const z = rp.getZ(i) + m.z;
        rp.setXYZ(i, x, g(x, z) + 0.03, z);
      }
      ring.computeVertexNormals();
      scene.add(new THREE.Mesh(ring, decal(new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }))));
    }
    // A small flag at the ring's uphill edge so the spot reads from the pilot's position.
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    pole.position.y = 0.8;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), new THREE.MeshStandardMaterial({ color: 0xff6a00, side: THREE.DoubleSide }));
    cloth.position.set(0.25, 1.4, 0);
    flag.add(pole, cloth);
    const fx = m.x + (m.id === 'bank' ? m.r + 0.3 : 0);
    const fz = m.z - (m.id === 'bank' ? 0 : m.r + 0.3);
    flag.position.set(fx, g(fx, fz), fz);
    shadowed(flag);
    scene.add(flag);
  }

  // Pines (three stacked cones) at the terrain height.
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b });
  const mtx = new THREE.Matrix4();
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.4, 2.6, 7), trunkMat, layout.trees.length);
  layout.trees.forEach((t, i) => {
    mtx.makeScale(t.scale, t.scale, t.scale).setPosition(t.x, g(t.x, t.z) + 1.3 * t.scale, t.z);
    trunk.setMatrixAt(i, mtx);
  });
  trunk.castShadow = trunk.receiveShadow = true;
  scene.add(trunk);
  const tint = new THREE.Color();
  const swayLayers: SwayLayer[] = [];
  const allIndex = layout.trees.map((_, i) => i);
  const tiers: [number, number, number][] = [[2.4, 3.2, 3.6], [1.9, 2.8, 5.6], [1.3, 2.4, 7.4]];
  for (const [r, h, cy] of tiers) {
    const tier = new THREE.InstancedMesh(new THREE.ConeGeometry(r, h, 8), new THREE.MeshStandardMaterial({ color: 0x2f6b2a }), layout.trees.length);
    swayLayers.push({ mesh: tier, cy, index: allIndex });
    layout.trees.forEach((t, i) => {
      mtx.makeScale(t.scale, t.scale, t.scale).setPosition(t.x, g(t.x, t.z) + cy * t.scale, t.z);
      tier.setMatrixAt(i, mtx);
      tint.setHSL(0.3 + 0.03 * Math.sin(i * 1.7), 0.45, 0.22 + 0.06 * Math.sin(i * 2.3));
      tier.setColorAt(i, tint);
    });
    tier.castShadow = tier.receiveShadow = true;
    scene.add(tier);
  }

  // Boulders: squashed, slightly rotated dodecahedra sunk into the slope.
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.95, flatShading: true });
  hill.rocks.forEach((r, i) => {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r.r, 0), rockMat);
    rock.scale.set(1, 0.75, 0.9);
    rock.rotation.set(i * 0.7, i * 1.3, 0.2);
    rock.position.set(r.x, g(r.x, r.z) + r.r * 0.25, r.z);
    shadowed(rock);
    scene.add(rock);
  });

  // Sheep grazing on the slope: body, head, legs.
  const wool = new THREE.MeshStandardMaterial({ color: 0xeeeae0, roughness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.9 });
  for (const a of layout.animals) {
    const sheep = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), wool);
    body.scale.set(1.3, 0.9, 0.9);
    body.position.y = 0.55;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.3), dark);
    head.position.set(0.6, 0.7, 0);
    sheep.add(body, head);
    for (const [dx, dz] of [[-0.3, 0.18], [0.3, 0.18], [-0.3, -0.18], [0.3, -0.18]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 6), dark);
      leg.position.set(dx, 0.2, dz);
      sheep.add(leg);
    }
    sheep.rotation.y = a.rot;
    sheep.position.set(a.x, g(a.x, a.z), a.z);
    shadowed(sheep);
    scene.add(sheep);
  }

  // Fence line behind the pilot: posts (colliders) and two rails.
  const wood = new THREE.MeshStandardMaterial({ color: 0x8b6b43, roughness: 0.9 });
  for (let x = -40; x <= 40; x += 4) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.2, 0.16), wood);
    post.position.set(x, g(x, 22) + 0.6, 22);
    shadowed(post);
    scene.add(post);
    if (x < 40) {
      for (const h of [0.5, 1.0]) {
        const y0 = g(x, 22) + h;
        const y1 = g(x + 4, 22) + h;
        const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(4, y1 - y0), 0.08, 0.05), wood);
        rail.position.set(x + 2, (y0 + y1) / 2, 22);
        rail.rotation.z = Math.atan2(y1 - y0, 4);
        shadowed(rail);
        scene.add(rail);
      }
    }
  }

  // Windsock.
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.6 });
  const windsock = new THREE.Group();
  const wpole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, layout.windsock.height, 8), metal);
  wpole.position.set(layout.windsock.x, layout.windsock.height / 2, layout.windsock.z);
  shadowed(wpole);
  scene.add(wpole);
  const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 1.3, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xff6a00, side: THREE.DoubleSide, roughness: 0.9 }));
  sock.rotation.x = Math.PI / 2;
  sock.position.set(0, 0, 0.65);
  windsock.add(sock);
  windsock.position.set(layout.windsock.x, layout.windsock.height, layout.windsock.z);
  scene.add(windsock);

  // Pilot figure and the orientation arrow, as on the field.
  const pilot = new THREE.Group();
  const pbody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.4, 12), new THREE.MeshStandardMaterial({ color: 0x334466 }));
  pbody.position.y = 0.7;
  const phead = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd9b48f }));
  phead.position.y = 1.55;
  const tx = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.06), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  tx.position.set(0, 1.1, -0.26);
  pilot.add(pbody, phead, tx);
  shadowed(pilot);
  scene.add(pilot);
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, 0.55);
  arrowShape.lineTo(0.35, -0.35);
  arrowShape.lineTo(0, -0.15);
  arrowShape.lineTo(-0.35, -0.35);
  arrowShape.closePath();
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), decal(new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.85, side: THREE.DoubleSide })));
  arrow.rotation.x = -Math.PI / 2;
  arrow.position.y = 0.03;
  scene.add(arrow);

  return { scene, sun, setTimeOfDay, windsock, animate: () => {}, pilotMarker: pilot, arrow, setWind: makeSway(layout.trees.map((t) => ({ x: t.x, z: t.z, scale: t.scale, base: g(t.x, t.z) })), swayLayers) };
}
