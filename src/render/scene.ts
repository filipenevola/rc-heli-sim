import * as THREE from 'three';
import { FENCE, type FieldLayout, type HouseSpec } from '../sim/world';
import { createEnvironment, type EnvironmentHandles } from './environment';
import { createGround } from './ground';
import { createGrass } from './grass';
import { createLake } from './water';
import { createTrees } from './trees';

export type Quality = 'high' | 'low';

export interface SceneHandles {
  scene: THREE.Scene;
  env: EnvironmentHandles;
  /** Windsock cone; rotated every frame to show the live wind. */
  windsock: THREE.Object3D;
  /** The person flying (hidden when the camera is their eyes). */
  pilot: THREE.Object3D;
  /** Animated bits (animal heads) updated per frame. */
  animate(dt: number, time: number): void;
}

/** Flying field built from the shared layout so visuals and collisions agree. */
export function createScene(layout: FieldLayout, renderer: THREE.WebGLRenderer, quality: Quality): SceneHandles {
  const scene = new THREE.Scene();
  const env = createEnvironment(scene, renderer);
  const aniso = renderer.capabilities.getMaxAnisotropy();

  const mats = {
    metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.45, metalness: 0.8 }),
    galv: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.55, metalness: 0.7 }),
    wood: new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.85 }),
    darkWood: new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.9 }),
    hay: new THREE.MeshStandardMaterial({ map: hayTexture(false), roughness: 1 }),
    hayEnd: new THREE.MeshStandardMaterial({ map: hayTexture(true), roughness: 1 }),
    asphalt: new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.95 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
    black: new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.7 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.05, metalness: 0.9 }),
    cow: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9 }),
    cowSpot: new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.9 }),
    sheep: new THREE.MeshStandardMaterial({ color: 0xeeeae0, roughness: 1 }),
    truck: new THREE.MeshPhysicalMaterial({ color: 0x1f56b8, roughness: 0.35, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.08 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 1 }),
    tower: new THREE.MeshStandardMaterial({ color: 0xb2452f, roughness: 0.6, metalness: 0.3 }),
    pad: new THREE.MeshStandardMaterial({ map: targetTexture(), roughness: 0.7 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.8, side: THREE.DoubleSide }),
    stripe: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 2 }),
  };
  /** Flat things lying on the grass (pad, road) share its depth; polygon offset pulls them in front so they never flicker. */
  const decal = (mat: THREE.Material): THREE.Material => {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    return mat;
  };
  const shadowed = <T extends THREE.Object3D>(o: T): T => {
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
      }
    });
    return o;
  };

  scene.add(createGround(layout.lake, aniso));
  scene.add(createLake(layout.lake, env, quality));
  scene.add(createTrees(layout.trees));
  scene.add(createGrass(layout, quality === 'high' ? 1 : 0.3));

  // Helipad where the heli starts: a concrete disc with the painted H, edge-lit with small marker lights.
  const pad = new THREE.Mesh(new THREE.CircleGeometry(2.2, 64), decal(new THREE.MeshStandardMaterial({ map: makePadTexture(aniso), roughness: 0.85 })));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.005, -6);
  pad.receiveShadow = true;
  scene.add(pad);
  const padLight = new THREE.CylinderGeometry(0.035, 0.045, 0.02, 10);
  const padLamp = new THREE.MeshStandardMaterial({ color: 0x9fff7a, emissive: 0x6dff4a, emissiveIntensity: 1.6 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const l = new THREE.Mesh(padLight, padLamp);
    l.position.set(Math.cos(a) * 2.32, 0.01, -6 + Math.sin(a) * 2.32);
    scene.add(l);
  }

  // The pilot: standing at the origin facing the field with a transmitter, neck strap and cap.
  const pilot = shadowed(makePilot());
  scene.add(pilot);

  // Fence along the back: weathered posts, two rails.
  const postCount = Math.round((FENCE.x1 - FENCE.x0) / 1.5) + 1;
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 1.25, 0.11), mats.darkWood, postCount);
  const m = new THREE.Matrix4();
  for (let i = 0; i < postCount; i++) {
    m.makeRotationY(Math.sin(i * 12.9898) * 0.08).setPosition(FENCE.x0 + i * 1.5, 0.62, FENCE.z);
    posts.setMatrixAt(i, m);
  }
  posts.castShadow = posts.receiveShadow = true;
  scene.add(posts);
  for (const y of [0.5, 1.08]) {
    const rail = shadowed(new THREE.Mesh(new THREE.BoxGeometry(FENCE.x1 - FENCE.x0, 0.07, 0.035), mats.wood));
    rail.position.set((FENCE.x0 + FENCE.x1) / 2, y, FENCE.z + 0.06);
    scene.add(rail);
  }

  // Distance markers for depth perception: small white cones every 10 m straight ahead.
  for (let d = 10; d <= 40; d += 10) {
    const mk = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 12), mats.white));
    mk.position.set(0, 0.25, -d);
    scene.add(mk);
  }

  for (const h of layout.houses) scene.add(shadowed(makeHouse(h, mats)));

  // Road with markings.
  const road = new THREE.Mesh(new THREE.PlaneGeometry(layout.road.length, layout.road.width), decal(mats.asphalt));
  (mats.asphalt.map as THREE.Texture).repeat.set(layout.road.length / 8, 1);
  road.rotation.x = -Math.PI / 2;
  road.rotation.z = layout.road.rot;
  road.position.set(layout.road.x, 0.012, layout.road.z);
  road.receiveShadow = true;
  scene.add(road);
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(3, 0.15), dashMat, Math.ceil(layout.road.length / 6));
  let di = 0;
  for (let i = -layout.road.length / 2; i < layout.road.length / 2; i += 6) {
    m.makeRotationX(-Math.PI / 2).setPosition(layout.road.x + i, 0.015, layout.road.z);
    dashes.setMatrixAt(di++, m);
  }
  dashes.receiveShadow = true;
  scene.add(dashes);

  // Round hay bales (net wrap texture on the side, spiral on the ends).
  for (const b of layout.bales) {
    const bale = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.4, 28, 1), [mats.hay, mats.hayEnd, mats.hayEnd]));
    bale.rotation.z = Math.PI / 2;
    bale.rotation.y = b.rot;
    bale.position.set(b.x, 0.75, b.z);
    scene.add(bale);
  }

  // Animals.
  const heads: { obj: THREE.Object3D; phase: number }[] = [];
  const tails: { obj: THREE.Object3D; phase: number }[] = [];
  for (const a of layout.animals) {
    const g = new THREE.Group();
    const cow = a.kind === 'cow';
    const bodyLen = cow ? 1.6 : 0.9;
    const bodyH = cow ? 0.8 : 0.5;
    const legH = cow ? 0.7 : 0.4;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(cow ? 0.36 : 0.26, bodyLen - (cow ? 0.6 : 0.4), 4, 10), cow ? mats.cow : mats.sheep);
    body.rotation.x = Math.PI / 2;
    body.scale.set(1, 1, bodyH / (cow ? 0.72 : 0.52));
    body.position.y = legH + bodyH / 2;
    g.add(body);
    if (cow) {
      for (const [sx, sz, sr] of [[0.33, 0.25, 0.22], [-0.3, -0.3, 0.26], [0.28, -0.45, 0.16]]) {
        const spot = new THREE.Mesh(new THREE.SphereGeometry(sr, 10, 8), mats.cowSpot);
        spot.scale.set(0.35, 1, 1.2);
        spot.position.set(sx, legH + bodyH / 2 + 0.1, sz);
        g.add(spot);
      }
    }
    for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(cow ? 0.06 : 0.04, cow ? 0.05 : 0.035, legH, 6), cow ? mats.cow : mats.black);
      leg.position.set(lx * (cow ? 0.22 : 0.13), legH / 2, lz * (bodyLen / 2 - 0.2));
      g.add(leg);
      const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.08, 6), mats.black);
      hoof.position.set(leg.position.x, 0.04, leg.position.z);
      if (cow) g.add(hoof);
    }
    const head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.BoxGeometry(cow ? 0.32 : 0.22, cow ? 0.36 : 0.24, cow ? 0.5 : 0.3), cow ? mats.cowSpot : mats.black);
    skull.position.z = cow ? 0.2 : 0.12;
    head.add(skull);
    if (cow) {
      const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.14), new THREE.MeshStandardMaterial({ color: 0xd9a39a, roughness: 0.8 }));
      muzzle.position.set(0, -0.08, 0.46);
      head.add(muzzle);
      for (const hx of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 6), mats.white);
        horn.position.set(hx * 0.14, 0.2, 0.05);
        horn.rotation.z = -hx * 0.6;
        head.add(horn);
      }
    }
    head.position.set(0, legH + bodyH * 0.85, bodyLen / 2);
    g.add(head);
    heads.push({ obj: head, phase: Math.random() * 6 });
    if (cow) {
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.7, 5), mats.cow);
      tail.geometry.translate(0, -0.35, 0);
      tail.position.set(0, legH + bodyH * 0.9, -bodyLen / 2);
      g.add(tail);
      tails.push({ obj: tail, phase: Math.random() * 6 });
    }
    g.position.set(a.x, 0, a.z);
    g.rotation.y = a.rot;
    scene.add(shadowed(g));
  }

  // Landing platforms (challenges).
  for (const p of layout.platforms) {
    const g = new THREE.Group();
    const top = new THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>(new THREE.BoxGeometry(p.size, 0.08, p.size), [mats.tower, mats.tower, mats.pad, mats.tower, mats.tower, mats.tower]);
    top.position.y = p.height - 0.04;
    g.add(top);
    switch (p.style) {
      case 'table': {
        // Picnic table: plank top, A-frame legs, benches. The collider is the top plus a solid block under it.
        top.material = mats.wood;
        const target = new THREE.Mesh(new THREE.CircleGeometry(p.size * 0.42, 40), decal(mats.pad.clone()));
        target.rotation.x = -Math.PI / 2;
        target.position.y = p.height + 0.002;
        g.add(target);
        // Solid plank cabinet under the top, the same block the physics collides with.
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, p.height - 0.08, 1.0), mats.wood);
        base.position.y = (p.height - 0.08) / 2;
        g.add(base);
        const kick = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.08, 1.04), mats.darkWood);
        kick.position.y = 0.04;
        g.add(kick);
        break;
      }
      case 'tower': {
        // Lattice tower: four legs, cross bracing, a ladder.
        const h = p.height - 0.08;
        for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, h, 6), mats.tower);
          leg.position.set(lx * 0.25, h / 2, lz * 0.25);
          g.add(leg);
        }
        for (let y = 0.6; y < h; y += 1.1) {
          for (const r of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
            const brace = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.03), mats.galv);
            brace.position.set(Math.sin(r) * 0.25, y, Math.cos(r) * 0.25);
            brace.rotation.y = r + Math.PI / 2;
            brace.rotation.z = 0.6;
            g.add(brace);
          }
        }
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mats.lamp);
        lamp.position.set(p.size / 2 - 0.08, p.height + 0.05, p.size / 2 - 0.08);
        g.add(lamp);
        break;
      }
      case 'truck': {
        top.visible = false; // the bed floor is the landing surface
        g.add(makePickup(mats, p.height));
        break;
      }
      case 'pontoon': {
        top.material = [mats.wood, mats.wood, mats.pad, mats.wood, mats.wood, mats.wood];
        for (const [fx, fz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          // Floats sit half under water, below the deck.
          const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 14), new THREE.MeshStandardMaterial({ color: 0x2b6cb0, roughness: 0.5 }));
          drum.rotation.x = Math.PI / 2;
          drum.position.set(fx * 0.45, -0.02, fz * 0.4);
          g.add(drum);
        }
        const frame = new THREE.Mesh(new THREE.BoxGeometry(p.size + 0.1, 0.1, p.size + 0.1), mats.darkWood);
        frame.position.y = 0.15;
        g.add(frame);
        break;
      }
    }
    g.position.set(p.x, 0, p.z);
    scene.add(shadowed(g));
  }

  // Windsock: striped orange/white cone on a galvanised pole.
  const pole = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, layout.windsock.height, 10), mats.galv));
  pole.position.set(layout.windsock.x, layout.windsock.height / 2, layout.windsock.z);
  scene.add(pole);
  const windsock = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const r0 = 0.3 - i * 0.036;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r0 - 0.036, r0, 0.26, 16, 1, true), i % 2 ? mats.stripe : mats.orange);
    seg.rotation.x = Math.PI / 2;
    seg.position.z = 0.13 + i * 0.26;
    seg.castShadow = true;
    windsock.add(seg);
  }
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.012, 6, 24), mats.galv);
  windsock.add(hoop);
  windsock.position.set(layout.windsock.x, layout.windsock.height - 0.2, layout.windsock.z);
  scene.add(windsock);

  return {
    scene,
    env,
    windsock,
    pilot,
    animate(_dt, time) {
      for (const h of heads) h.obj.rotation.x = 0.35 + 0.3 * Math.sin(time * 0.6 + h.phase);
      for (const t of tails) t.obj.rotation.z = 0.25 * Math.sin(time * 1.7 + t.phase);
    },
  };
}

type Mats = Record<string, THREE.Material>;

function makeHouse(h: HouseSpec, mats: Mats): THREE.Group {
  const g = new THREE.Group();
  const barn = h.w > 12;
  const wallMat = new THREE.MeshStandardMaterial({ color: h.color, map: sidingTexture(barn), roughness: 0.9 });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(h.w, h.h, h.d), wallMat);
  (wallMat.map as THREE.Texture).repeat.set(h.w / 4, h.h / 3);
  walls.position.y = h.h / 2;
  g.add(walls);
  // Gable roof: a triangular prism along the long side, ridge at exactly the collider height.
  const rh = h.d * 0.3;
  const tri = new THREE.Shape([new THREE.Vector2(-h.d / 2, 0), new THREE.Vector2(h.d / 2, 0), new THREE.Vector2(0, rh)]);
  const roofGeo = new THREE.ExtrudeGeometry(tri, { depth: h.w, bevelEnabled: false });
  roofGeo.translate(0, 0, -h.w / 2);
  roofGeo.rotateY(Math.PI / 2);
  const roofMat = new THREE.MeshStandardMaterial({ color: h.roof, map: roofTexture(), roughness: 0.75 });
  (roofMat.map as THREE.Texture).repeat.set(h.w / 2, 3);
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.y = h.h;
  g.add(roof);
  const trim = new THREE.MeshStandardMaterial({ color: barn ? 0xf3efe6 : 0xffffff, roughness: 0.7 });
  if (barn) {
    // Barn doors with the white X bracing.
    const door = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.2, 0.06), new THREE.MeshStandardMaterial({ color: 0x8e2f24, roughness: 0.9 }));
    door.position.set(0, 1.6, h.d / 2 + 0.03);
    g.add(door);
    for (const s of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.14, 0.03), trim);
      bar.rotation.z = s * Math.atan2(3.2, 3.6);
      bar.position.set(0, 1.6, h.d / 2 + 0.07);
      g.add(bar);
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.14, 0.04), trim);
    frame.position.set(0, 3.25, h.d / 2 + 0.05);
    g.add(frame);
    const loft = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.05), mats.black);
    loft.position.set(0, h.h - 0.2, h.d / 2 + 0.03);
    g.add(loft);
  } else {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.05, 0.06), new THREE.MeshStandardMaterial({ color: 0x5b3a26, roughness: 0.8 }));
    door.position.set(0, 1.03, h.d / 2 + 0.03);
    g.add(door);
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.15, 0.5), new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 0.95 }));
    step.position.set(0, 0.075, h.d / 2 + 0.25);
    g.add(step);
    const winGeo = new THREE.BoxGeometry(1.0, 0.95, 0.04);
    const frameGeo = new THREE.BoxGeometry(1.14, 1.09, 0.03);
    const mullion = new THREE.BoxGeometry(0.05, 0.95, 0.05);
    const place = (x: number, z: number, ry: number) => {
      const w = new THREE.Group();
      const f = new THREE.Mesh(frameGeo, trim);
      const gl = new THREE.Mesh(winGeo, mats.glass);
      gl.position.z = 0.012;
      const mu = new THREE.Mesh(mullion, trim);
      mu.position.z = 0.03;
      const sill = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.06, 0.12), trim);
      sill.position.set(0, -0.56, 0.05);
      w.add(f, gl, mu, sill);
      w.position.set(x, h.h * 0.55, z);
      w.rotation.y = ry;
      g.add(w);
    };
    for (const wx of [-h.w / 3, h.w / 3]) place(wx, h.d / 2 + 0.02, 0);
    for (const wx of [-h.w / 3, h.w / 3]) place(wx, -h.d / 2 - 0.02, Math.PI);
    place(h.w / 2 + 0.02, 0, Math.PI / 2);
    place(-h.w / 2 - 0.02, 0, -Math.PI / 2);
    // Chimney on the back slope, its top level with the ridge (inside the collider).
    const ch = new THREE.Mesh(new THREE.BoxGeometry(0.55, rh + 0.6, 0.55), new THREE.MeshStandardMaterial({ color: 0x7d4b3a, roughness: 0.9 }));
    ch.position.set(h.w * 0.28, h.h + (rh + 0.6) / 2 - 0.6, -h.d * 0.18);
    g.add(ch);
  }
  g.position.set(h.x, 0, h.z);
  g.rotation.y = h.rot;
  return g;
}

function makePickup(mats: Mats, bedHeight: number): THREE.Group {
  // Matches the colliders: bed floor 1.6 m square at bedHeight, cab box x ±1.0, z -3.3..-1.1, up to 1.9 m.
  const g = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 1.6), new THREE.MeshStandardMaterial({ map: targetTexture(), roughness: 0.6 }));
  floor.position.y = bedHeight - 0.03;
  g.add(floor);
  // Bed walls stay low (12 cm over the floor) so nothing visible stands where the physics has no collider.
  const sideGeo = new THREE.BoxGeometry(0.1, 0.22, 2.3);
  for (const sx of [-0.95, 0.95]) {
    const side = new THREE.Mesh(sideGeo, mats.truck);
    side.position.set(sx, bedHeight + 0.01, 0.1);
    g.add(side);
  }
  const tailgate = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.22, 0.08), mats.truck);
  tailgate.position.set(0, bedHeight + 0.01, 1.22);
  g.add(tailgate);
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, bedHeight - 0.45, 4.6), mats.truck);
  chassis.position.set(0, 0.45 + (bedHeight - 0.45) / 2, -0.98);
  g.add(chassis);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.85, 1.7), mats.truck);
  cab.position.set(0, 1.42, -2.05);
  g.add(cab);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.2, 1.1), mats.truck);
  hood.position.set(0, bedHeight + 0.05, -3.0);
  hood.scale.set(1, 1, 0.55);
  g.add(hood);
  const ws = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.62, 0.05), mats.glass);
  ws.position.set(0, 1.45, -2.91);
  ws.rotation.x = -0.35;
  g.add(ws);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 0.04), mats.glass);
  rear.position.set(0, 1.5, -1.19);
  g.add(rear);
  for (const sx of [-0.96, 0.96]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 1.2), mats.glass);
    side.position.set(sx, 1.5, -2.1);
    g.add(side);
  }
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.18, 0.12), mats.chrome);
  bumper.position.set(0, 0.55, -3.28);
  g.add(bumper);
  for (const sx of [-0.75, 0.75]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.04), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 0.6 }));
    hl.position.set(sx, 0.85, -3.29);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 0.04), mats.lamp);
    tl.position.set(sx * 1.25, bedHeight + 0.12, 1.27);
    g.add(tl);
  }
  const tyre = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 20);
  const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 12);
  for (const sx of [-1, 1]) for (const sz of [-2.55, 0.45]) {
    const t = new THREE.Mesh(tyre, mats.rubber);
    t.rotation.z = Math.PI / 2;
    t.position.set(sx * 0.95, 0.36, sz);
    g.add(t);
    const hb = new THREE.Mesh(hub, mats.chrome);
    hb.rotation.z = Math.PI / 2;
    hb.position.copy(t.position);
    g.add(hb);
  }
  return g;
}

function makePilot(): THREE.Group {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc89878, roughness: 0.7 });
  const jeans = new THREE.MeshStandardMaterial({ color: 0x2f4466, roughness: 0.9 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0xe0542c, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.5, metalness: 0.3 });
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.72, 4, 8), jeans);
    leg.position.set(s * 0.1, 0.45, 0);
    g.add(leg);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.26), dark);
    shoe.position.set(s * 0.1, 0.04, -0.04);
    g.add(shoe);
  }
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), shirt);
  torso.scale.set(1, 1, 0.7);
  torso.position.y = 1.17;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin);
  head.position.set(0, 1.62, -0.01);
  g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  cap.position.set(0, 1.64, -0.01);
  g.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.12), dark);
  brim.position.set(0, 1.645, -0.12);
  g.add(brim);
  // Arms reach forward to the transmitter held at chest height.
  for (const s of [-1, 1]) {
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.26, 4, 8), shirt);
    upper.position.set(s * 0.22, 1.24, -0.06);
    upper.rotation.x = 0.5;
    upper.rotation.z = s * 0.15;
    g.add(upper);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.24, 4, 8), skin);
    fore.position.set(s * 0.15, 1.08, -0.24);
    fore.rotation.x = 1.4;
    fore.rotation.z = -s * 0.4;
    g.add(fore);
  }
  const tx = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.17, 0.06), dark);
  tx.position.set(0, 1.1, -0.38);
  tx.rotation.x = -0.6;
  g.add(tx);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.16, 6), dark);
  antenna.position.set(0.06, 1.22, -0.34);
  antenna.rotation.x = -0.2;
  g.add(antenna);
  for (const s of [-1, 1]) {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.04, 6), new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.3 }));
    stick.position.set(s * 0.055, 1.14, -0.43);
    stick.rotation.x = -0.6 - Math.PI / 2 + Math.PI / 2;
    g.add(stick);
  }
  return g;
}

/* ---------------------------------- Procedural textures ---------------------------------- */

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function rng(seed: number): () => number {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

function woodTexture(): THREE.Texture {
  const r = rng(5);
  return canvasTex(256, 64, (g) => {
    g.fillStyle = '#8a6a45';
    g.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = `rgba(${60 + r() * 40},${40 + r() * 25},${20 + r() * 15},${0.25 + r() * 0.35})`;
      g.lineWidth = 0.5 + r() * 1.5;
      const y = r() * 64;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(80, y + (r() - 0.5) * 6, 170, y + (r() - 0.5) * 6, 256, y);
      g.stroke();
    }
  });
}

function hayTexture(end: boolean): THREE.Texture {
  const r = rng(end ? 9 : 8);
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#c9a24c';
    g.fillRect(0, 0, 256, 256);
    if (end) {
      for (let rad = 4; rad < 128; rad += 3 + r() * 3) {
        g.strokeStyle = `rgba(${120 + r() * 60},${90 + r() * 40},${30},${0.4 + r() * 0.4})`;
        g.lineWidth = 1 + r() * 1.5;
        g.beginPath();
        g.arc(128, 128, rad, 0, Math.PI * 2);
        g.stroke();
      }
    } else {
      for (let i = 0; i < 2500; i++) {
        g.strokeStyle = `rgba(${150 + r() * 90},${115 + r() * 70},${40 + r() * 30},${0.5})`;
        g.lineWidth = 1;
        const x = r() * 256;
        const y = r() * 256;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 6, y + 6 + r() * 10);
        g.stroke();
      }
      // Net wrap.
      g.strokeStyle = 'rgba(240,240,235,0.35)';
      for (let x = 0; x < 256; x += 16) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, 256);
        g.stroke();
      }
    }
  });
}

function asphaltTexture(): THREE.Texture {
  const r = rng(13);
  return canvasTex(256, 64, (g) => {
    g.fillStyle = '#45484d';
    g.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 2500; i++) {
      const v = 50 + r() * 60;
      g.fillStyle = `rgba(${v},${v},${v + 4},0.6)`;
      g.fillRect(r() * 256, r() * 64, 1.2, 1.2);
    }
    g.fillStyle = 'rgba(235,235,230,0.85)';
    g.fillRect(0, 3, 256, 2);
    g.fillRect(0, 59, 256, 2);
  });
}

function sidingTexture(barn: boolean): THREE.Texture {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(0,0,0,0.13)';
    if (barn) for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 2, 128);
    else for (let y = 0; y < 128; y += 12) g.fillRect(0, y, 128, 2);
  });
}

function roofTexture(): THREE.Texture {
  const r = rng(21);
  return canvasTex(128, 128, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 16) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(0, y, 128, 2);
      for (let x = (y / 16) % 2 ? 8 : 0; x < 128; x += 16) {
        g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.08})`;
        g.fillRect(x, y + 2, 15, 14);
      }
    }
  });
}

/** Yellow landing square with a painted ring and cross-hair: the challenge platforms' target. */
function targetTexture(): THREE.Texture {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#e8b500';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#1b1b1b';
    g.lineWidth = 14;
    g.strokeRect(7, 7, 242, 242);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(128, 128, 80, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(128, 90);
    g.lineTo(128, 166);
    g.moveTo(90, 128);
    g.lineTo(166, 128);
    g.stroke();
  });
}

function makePadTexture(aniso: number): THREE.Texture {
  const r = rng(17);
  const t = canvasTex(1024, 1024, (g) => {
    g.fillStyle = '#5f6064';
    g.fillRect(0, 0, 1024, 1024);
    // Concrete speckle and some tyre/skid scuffs.
    for (let i = 0; i < 26000; i++) {
      const v = 70 + r() * 70;
      g.fillStyle = `rgba(${v},${v},${v},0.35)`;
      g.fillRect(r() * 1024, r() * 1024, 2, 2);
    }
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = `rgba(20,20,20,${0.06 + r() * 0.08})`;
      g.lineWidth = 6 + r() * 10;
      g.beginPath();
      const x = 300 + r() * 420;
      const y = 300 + r() * 420;
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 160, y + (r() - 0.5) * 40);
      g.stroke();
    }
    g.strokeStyle = '#f4f4f0';
    g.lineWidth = 34;
    g.beginPath();
    g.arc(512, 512, 430, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = '#f2c200';
    g.lineWidth = 16;
    g.beginPath();
    g.arc(512, 512, 475, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#f4f4f0';
    // The H, drawn as three bars so it is crisp at any size.
    g.fillRect(330, 300, 90, 424);
    g.fillRect(604, 300, 90, 424);
    g.fillRect(420, 470, 184, 84);
  });
  t.anisotropy = aniso;
  return t;
}
