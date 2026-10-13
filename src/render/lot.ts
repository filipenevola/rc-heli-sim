import * as THREE from 'three';
import type { FieldLayout } from '../sim/world';
import { makePadTexture, outdoorLighting, type SceneHandles } from './scene';

/** The club's parking lot: asphalt with bays, light poles, parked cars, a container and warehouses. Open sky, wind. */
export function createLotScene(layout: FieldLayout): SceneHandles {
  const lot = layout.lot!;
  const scene = new THREE.Scene();
  const { sun, setTimeOfDay, env } = outdoorLighting(scene, 110);

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

  // Grass to the horizon, asphalt on top.
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x5c8a3a, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), grassMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const asphalt = makeAsphaltTexture();
  asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
  asphalt.repeat.set(lot.halfW / 3, lot.halfD / 3);
  const slab = new THREE.Mesh(new THREE.PlaneGeometry(lot.halfW * 2, lot.halfD * 2), decal(new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.95 })));
  slab.rotation.x = -Math.PI / 2;
  slab.position.y = 0.004;
  slab.receiveShadow = true;
  scene.add(slab);
  // Painted bays along two rows.
  const paint = decal(new THREE.MeshBasicMaterial({ color: 0xe8e8e8 }));
  const stripe = (w: number, d: number, x: number, z: number, rot = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paint);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rot;
    m.position.set(x, 0.008, z);
    scene.add(m);
  };
  for (let i = -8; i <= 8; i++) stripe(0.12, 5, i * 2.8 - 1.4, -16);
  for (let i = -6; i <= 6; i++) stripe(5, 0.12, 24, i * 2.8 + 2);

  // Helipad decal where the heli starts.
  const pad = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), decal(new THREE.MeshStandardMaterial({ map: makePadTexture(), roughness: 0.9 })));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.01, -6);
  pad.receiveShadow = true;
  scene.add(pad);

  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.6 });
  // Light poles with a lamp head.
  for (const p of lot.poles) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 9, 10), metal);
    pole.position.set(p.x, 4.5, p.z);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.5), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    head.position.set(p.x + 0.5, 9, p.z);
    const g = new THREE.Group();
    g.add(pole, head);
    shadowed(g);
    scene.add(g);
  }
  // Parked cars: body, cabin, wheels.
  for (const c of lot.cars) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.7, 1.8), new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.4, metalness: 0.3 }));
    body.position.y = 0.6;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 1.6), new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.2, metalness: 0.4 }));
    cabin.position.set(-0.2, 1.2, 0);
    g.add(body, cabin);
    for (const [dx, dz] of [[-1.4, 0.9], [1.4, 0.9], [-1.4, -0.9], [1.4, -0.9]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.25, 12), new THREE.MeshStandardMaterial({ color: 0x111111 }));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(dx, 0.32, dz);
      g.add(wheel);
    }
    g.rotation.y = c.rot;
    g.position.set(c.x, 0, c.z);
    shadowed(g);
    scene.add(g);
  }
  // Container: corrugated blue box with the yellow landing top and white ring.
  for (const p of layout.platforms) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(p.size, p.height - 0.08, 6), new THREE.MeshStandardMaterial({ color: 0x2a5fb0, roughness: 0.7, metalness: 0.3 }));
    box.position.set(p.x, (p.height - 0.08) / 2, p.z);
    const top = new THREE.Mesh(new THREE.BoxGeometry(p.size, 0.08, 6), new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.8 }));
    top.position.set(p.x, p.height - 0.04, p.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(p.radius - 0.03, p.radius, 32), decal(new THREE.MeshBasicMaterial({ color: 0xffffff })));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, p.height + 0.004, p.z);
    const g = new THREE.Group();
    g.add(box, top, ring);
    shadowed(g);
    scene.add(g);
  }
  // Warehouses along the back, with a darker roof band.
  for (const w of lot.warehouses) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w.w, w.h, w.d), new THREE.MeshStandardMaterial({ color: w.color, roughness: 0.9 }));
    b.position.set(w.x, w.h / 2, w.z);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.4, 0.3, w.d + 0.4), new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.9 }));
    roof.position.set(w.x, w.h + 0.15, w.z);
    const g = new THREE.Group();
    g.add(b, roof);
    shadowed(g);
    scene.add(g);
  }
  // Chain-link fence: posts and a translucent mesh panel on three sides.
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0xb0b8c0, roughness: 0.8, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  const sides: [number, number, number, number, number][] = [[-lot.halfW, 0, 0.04, lot.halfD * 2, 0], [lot.halfW, 0, 0.04, lot.halfD * 2, 0], [0, lot.halfD, lot.halfW * 2, 0.04, 0]];
  for (const [x, z, w, d] of sides) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, 2, d), fenceMat);
    panel.position.set(x, 1, z);
    scene.add(panel);
  }
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, 2.1, 6), metal, 80);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let i = 0; i <= 30 && n < 80; i++) { m.identity().setPosition(-lot.halfW, 1.05, -lot.halfD + (i * lot.halfD * 2) / 30); posts.setMatrixAt(n++, m); }
  for (let i = 0; i <= 30 && n < 80; i++) { m.identity().setPosition(lot.halfW, 1.05, -lot.halfD + (i * lot.halfD * 2) / 30); posts.setMatrixAt(n++, m); }
  for (let i = 0; i <= 17 && n < 80; i++) { m.identity().setPosition(-lot.halfW + (i * lot.halfW * 2) / 17, 1.05, lot.halfD); posts.setMatrixAt(n++, m); }
  posts.count = n;
  posts.castShadow = true;
  scene.add(posts);

  // Windsock beside the pad (the caller rotates it with the wind).
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
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd9b48f }));
  head.position.y = 1.55;
  const tx = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.06), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  tx.position.set(0, 1.1, -0.26);
  pilot.add(pbody, head, tx);
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

  return { scene, sun, env, setTimeOfDay, windsock, animate: () => {}, pilotMarker: pilot, arrow };
}

function makeAsphaltTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a4d52';
  g.fillRect(0, 0, 256, 256);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const v = 60 + Math.floor(rnd() * 50);
    g.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    g.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), 2, 2);
  }
  // A faint tar crack now and then (the texture repeats every 3 m, so keep it subtle).
  g.strokeStyle = 'rgba(20,20,24,0.22)';
  g.lineWidth = 1;
  for (let k = 0; k < 1; k++) {
    g.beginPath();
    g.moveTo(rnd() * 256, rnd() * 256);
    for (let j = 0; j < 5; j++) g.lineTo(rnd() * 256, rnd() * 256);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
