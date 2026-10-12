import * as THREE from 'three';
import type { FieldLayout } from '../sim/world';
import { makePadTexture, type SceneHandles } from './scene';

/**
 * An indoor sports hall for micro practice: wooden floor with court lines, painted walls, a lamp-panel ceiling,
 * bleachers along one side, a hoop at each end, a stack of mats and a vault box as landing targets. Built from the
 * same layout the colliders use, so what you hit is what you see.
 */
export function createGymScene(layout: FieldLayout): SceneHandles {
  const hall = layout.hall!;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3a3f47);

  // Hall lighting: a bright hemisphere (lamps above, warm floor below) plus one steep key light from above for
  // crisp shadows of the model on the floor, the depth cue a hover needs. The shadow frustum is fitted to the hall.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.3);
  const cz0 = (hall.zFront + hall.zBack) / 2;
  sun.position.set(4, 40, cz0 + 4);
  sun.target.position.set(0, 0, cz0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 60;
  sun.shadow.camera.left = -hall.halfW - 2;
  sun.shadow.camera.right = hall.halfW + 2;
  sun.shadow.camera.top = (hall.zFront - hall.zBack) / 2 + 2;
  sun.shadow.camera.bottom = -((hall.zFront - hall.zBack) / 2 + 2);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);

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

  const W = hall.halfW * 2;
  const D = hall.zFront - hall.zBack;
  const cz = (hall.zFront + hall.zBack) / 2;

  // Floor: varnished planks.
  const wood = makeWoodTexture();
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  wood.repeat.set(W / 4, D / 4);
  wood.anisotropy = 8;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0.05 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, cz);
  floor.receiveShadow = true;
  scene.add(floor);

  // Court lines: sidelines, centre line and circle, as flat decals.
  const lineMat = decal(new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }));
  const line = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.006, z);
    scene.add(m);
  };
  line(W - 6, 0.1, 0, hall.zFront - 3);
  line(W - 6, 0.1, 0, hall.zBack + 3);
  line(0.1, D - 6, -(W / 2 - 3), cz);
  line(0.1, D - 6, W / 2 - 3, cz);
  line(W - 6, 0.1, 0, cz);
  const circle = new THREE.Mesh(new THREE.RingGeometry(1.75, 1.85, 48), lineMat);
  circle.rotation.x = -Math.PI / 2;
  circle.position.set(0, 0.006, cz);
  scene.add(circle);

  // Helipad decal where the heli starts (same place as the field).
  const pad = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), decal(new THREE.MeshStandardMaterial({ map: makePadTexture(), roughness: 0.9 })));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.008, -6);
  pad.receiveShadow = true;
  scene.add(pad);

  // Walls and ceiling: one inverted box so the inside faces are what you see.
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(W, hall.height, D),
    [
      new THREE.MeshStandardMaterial({ color: 0xe3e8ec, roughness: 0.9, side: THREE.BackSide }), // +x
      new THREE.MeshStandardMaterial({ color: 0xe3e8ec, roughness: 0.9, side: THREE.BackSide }), // -x
      new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.95, side: THREE.BackSide }), // ceiling
      new THREE.MeshBasicMaterial({ visible: false }), // the floor plane covers this face; drawing it too would z-fight
      new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.9, side: THREE.BackSide }), // +z
      new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.9, side: THREE.BackSide }), // -z
    ],
  );
  room.position.set(0, hall.height / 2, cz);
  scene.add(room);
  // A dark wainscot band along each wall: thin panels just inside the walls, standing on the floor.
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x2f4a6b, roughness: 0.8 });
  const bandH = 2.2;
  for (const [w, d, x, z] of [[0.06, D, -hall.halfW + 0.03, cz], [0.06, D, hall.halfW - 0.03, cz], [W, 0.06, 0, hall.zFront - 0.03], [W, 0.06, 0, hall.zBack + 0.03]] as const) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(w, bandH, d), bandMat);
    band.position.set(x, bandH / 2 + 0.01, z);
    scene.add(band);
  }
  // Lamp panels on the ceiling.
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d6, emissiveIntensity: 1.2 });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 1.2), lampMat);
    lamp.position.set(-W / 2 + (i + 0.5) * (W / 4), hall.height - 0.08, hall.zBack + (j + 0.5) * (D / 6));
    scene.add(lamp);
  }

  // Bleachers along the +x wall: five steps.
  const bleacherMat = new THREE.MeshStandardMaterial({ color: 0x8c2f2f, roughness: 0.8 });
  const bleacherLen = D - 16;
  for (let i = 0; i < 5; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(1, 0.45 * (i + 1), bleacherLen), bleacherMat);
    step.position.set(hall.halfW - 5 + i + 0.5, (0.45 * (i + 1)) / 2, cz);
    shadowed(step);
    scene.add(step);
  }

  // Hoops: pole, backboard, ring.
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.7 });
  const board = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, transparent: true, opacity: 0.85 });
  const ring = new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.6, metalness: 0.4 });
  for (const z of [hall.zFront - 1.2, hall.zBack + 1.2]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.9, 10), metal);
    pole.position.set(0, 1.95, z);
    const bb = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.05, 0.05), board);
    bb.position.set(0, 3.45, z);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.02, 8, 24), ring);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.set(0, 3.05, z + (z > cz ? -0.35 : 0.35));
    const g = new THREE.Group();
    g.add(pole, bb, hoop);
    shadowed(g);
    scene.add(g);
  }

  // Landing targets: mats (blue stack) and the vault box (leather top), each with the yellow top and white ring.
  const topMat = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.8 });
  const ringMat = decal(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  for (const p of layout.platforms) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: p.id === 'mat' ? 0x2a5fb0 : 0x6b4a2b, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(p.size, p.height - 0.08, p.size), bodyMat);
    body.position.set(p.x, (p.height - 0.08) / 2, p.z);
    const top = new THREE.Mesh(new THREE.BoxGeometry(p.size, 0.08, p.size), topMat);
    top.position.set(p.x, p.height - 0.04, p.z);
    const r = new THREE.Mesh(new THREE.RingGeometry(p.radius - 0.03, p.radius, 32), ringMat);
    r.rotation.x = -Math.PI / 2;
    r.position.set(p.x, p.height + 0.004, p.z);
    const g = new THREE.Group();
    g.add(body, top, r);
    shadowed(g);
    scene.add(g);
  }

  // Pilot figure, as on the field.
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

  // Orientation arrow (beginner aid), same as the field.
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

  // No windsock indoors: a hidden placeholder keeps the caller's per-frame update simple.
  const windsock = new THREE.Object3D();
  windsock.visible = false;
  scene.add(windsock);

  return { scene, sun, windsock, animate: () => {}, pilotMarker: pilot, arrow };
}

function makeWoodTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c8a060';
  g.fillRect(0, 0, 256, 256);
  // Planks: 8 across, staggered, with grain and darker seams.
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 8; i++) {
    const y = i * 32;
    const tone = 0.9 + rnd() * 0.2;
    g.fillStyle = `rgb(${Math.round(200 * tone)}, ${Math.round(160 * tone)}, ${Math.round(96 * tone)})`;
    g.fillRect(0, y, 256, 32);
    g.strokeStyle = 'rgba(90,60,30,0.35)';
    g.lineWidth = 1;
    for (let k = 0; k < 6; k++) {
      g.beginPath();
      const yy = y + 4 + rnd() * 24;
      g.moveTo(0, yy);
      g.bezierCurveTo(80, yy + rnd() * 3 - 1.5, 170, yy - rnd() * 3 + 1.5, 256, yy);
      g.stroke();
    }
    g.fillStyle = 'rgba(70,45,20,0.6)';
    g.fillRect(0, y + 31, 256, 1);
    g.fillRect(Math.floor(rnd() * 256), y, 1, 32);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
