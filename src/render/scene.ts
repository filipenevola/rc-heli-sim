import * as THREE from 'three';
import type { FieldLayout } from '../sim/world';

export type TimeOfDay = 'morning' | 'noon' | 'evening';

export interface SceneHandles {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  /** Move the sun and recolour sky, fog and light (outdoor sites only; indoors it is a no-op). */
  setTimeOfDay(t: TimeOfDay): void;
  /** Windsock cone; rotated every frame to show the live wind. */
  windsock: THREE.Object3D;
  /** Animated bits (animal heads) updated per frame. */
  animate(dt: number, time: number): void;
  /** The pilot figure; moved when the pilot walks. */
  pilotMarker: THREE.Object3D;
  /** Flat arrow on the ground under the heli showing where the nose points (beginner aid). */
  arrow: THREE.Object3D;
}

const isMobile = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && window.innerWidth < 1100;

/**
 * Outdoor lighting shared by the open-air sites: hemisphere + sun with one big shadow frustum, a gradient sky
 * dome, a sun disc, fog, and the time-of-day presets that move and recolour all of it.
 */
export function outdoorLighting(scene: THREE.Scene, shadowExtent: number): { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; setTimeOfDay(t: TimeOfDay): void } {
  scene.background = new THREE.Color(0x9fc5e8);
  scene.fog = new THREE.Fog(0xbfd8ec, 140, 750);
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4e6b2c, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.2);
  sun.position.set(-40, 70, -30);
  sun.castShadow = true;
  // One big orthographic shadow frustum covering the whole site so every object casts a shadow, not only things
  // near the model. Resolution scaled for phones.
  sun.shadow.mapSize.set(isMobile ? 2048 : 4096, isMobile ? 2048 : 4096);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 400;
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  scene.add(sun.target);

  // Sky dome with a vertical gradient.
  const skyGeo = new THREE.SphereGeometry(900, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x3f7fd0) }, horizon: { value: new THREE.Color(0xd6e8f7) } },
    vertexShader: `varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vW; void main(){ float h = normalize(vW).y; float t = pow(clamp(h, 0.0, 1.0), 0.45); gl_FragColor = vec4(mix(horizon, top, t), 1.0); }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  // The sun: a bright disc where the light comes from.
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(22, 16, 8), new THREE.MeshBasicMaterial({ color: 0xfff6d5, fog: false }));
  sunDisc.position.copy(sun.position).normalize().multiplyScalar(860);
  scene.add(sunDisc);

  // Time of day: sun elevation and colour, sky gradient, fog and ambient. Evening is the one that teaches you to
  // judge distance with the model as a dark silhouette.
  const setTimeOfDay = (t: TimeOfDay): void => {
    const presets: Record<TimeOfDay, { sun: [number, number, number]; sunColor: number; sunI: number; hemiSky: number; hemiGround: number; hemiI: number; top: number; horizon: number; fog: number; disc: number }> = {
      morning: { sun: [60, 35, -40], sunColor: 0xffe7c4, sunI: 1.9, hemiSky: 0xd8e8ff, hemiGround: 0x4e6b2c, hemiI: 0.85, top: 0x4f8ad6, horizon: 0xe8ecf0, fog: 0xd2dde8, disc: 0xfff1d0 },
      noon: { sun: [-40, 70, -30], sunColor: 0xfff3dc, sunI: 2.2, hemiSky: 0xcfe6ff, hemiGround: 0x4e6b2c, hemiI: 0.9, top: 0x3f7fd0, horizon: 0xd6e8f7, fog: 0xbfd8ec, disc: 0xfff6d5 },
      evening: { sun: [-85, 14, 25], sunColor: 0xffb070, sunI: 1.3, hemiSky: 0xe0b8a0, hemiGround: 0x3a3426, hemiI: 0.55, top: 0x2d4f8a, horizon: 0xf2b57a, fog: 0xd9a884, disc: 0xffc080 },
    };
    const p = presets[t];
    sun.position.set(p.sun[0], p.sun[1], p.sun[2]);
    sun.color.set(p.sunColor);
    sun.intensity = p.sunI;
    hemi.color.set(p.hemiSky);
    hemi.groundColor.set(p.hemiGround);
    hemi.intensity = p.hemiI;
    (skyMat.uniforms.top.value as THREE.Color).set(p.top);
    (skyMat.uniforms.horizon.value as THREE.Color).set(p.horizon);
    (scene.fog as THREE.Fog).color.set(p.fog);
    (scene.background as THREE.Color).set(p.fog);
    (sunDisc.material as THREE.MeshBasicMaterial).color.set(p.disc);
    sunDisc.position.copy(sun.position).normalize().multiplyScalar(860);
  };
  return { sun, hemi, setTimeOfDay };
}

/** Flying field built from the shared layout so visuals and collisions agree. */
export function createScene(layout: FieldLayout): SceneHandles {
  const scene = new THREE.Scene();
  const { sun, setTimeOfDay } = outdoorLighting(scene, 130);

  const mats = {
    trunk: new THREE.MeshStandardMaterial({ color: 0x6b4a2b }),
    crown: new THREE.MeshStandardMaterial({ color: 0x2f6b2a }),
    metal: new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.6 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8b6b43, roughness: 0.9 }),
    hay: new THREE.MeshStandardMaterial({ color: 0xd9b55a, roughness: 1 }),
    water: new THREE.MeshStandardMaterial({ color: 0x3f7fb5, roughness: 0.15, metalness: 0.2 }),
    asphalt: new THREE.MeshStandardMaterial({ color: 0x474a4f, roughness: 1 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 }),
    black: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 }),
    cow: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9 }),
    cowSpot: new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.9 }),
    sheep: new THREE.MeshStandardMaterial({ color: 0xeeeae0, roughness: 1 }),
    truck: new THREE.MeshStandardMaterial({ color: 0x2b5db3, roughness: 0.4, metalness: 0.3 }),
    tower: new THREE.MeshStandardMaterial({ color: 0x9a3b2b, roughness: 0.7 }),
    pad: new THREE.MeshStandardMaterial({ color: 0xf0c000, roughness: 0.8 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.8, side: THREE.DoubleSide }),
  };
  /** Flat things lying on the grass (pad, pond, road) share its depth; polygon offset pulls them in front so they never flicker. */
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

  // Ground.
  const grass = makeGrassTexture();
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
  grass.repeat.set(400, 400);
  grass.anisotropy = 8;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Helipad where the heli starts.
  const pad = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), decal(new THREE.MeshStandardMaterial({ map: makePadTexture(), roughness: 0.9 })));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.005, -6);
  pad.receiveShadow = true;
  scene.add(pad);

  // Pilot figure: body, head, and a transmitter held in front.
  const pilot = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.4, 12), new THREE.MeshStandardMaterial({ color: 0x334466 }));
  body.position.y = 0.7;
  pilot.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd9b48f }));
  head.position.y = 1.55;
  pilot.add(head);
  const tx = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.06), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  tx.position.set(0, 1.1, -0.26);
  pilot.add(tx);
  shadowed(pilot);
  pilot.position.set(0, 0, 0);
  scene.add(pilot);

  // Orientation arrow: flat triangle on the grass under the model, pointing where the nose points.
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

  // Trees, instanced from the layout: every third one a broadleaf (lumpy crown), the rest pines (three stacked
  // cones). A little per-tree colour variation keeps a stand of them from reading as copies.
  const m = new THREE.Matrix4();
  const pines = layout.trees.filter((_, i) => i % 3 !== 2);
  const leafy = layout.trees.filter((_, i) => i % 3 === 2);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.4, 2.6, 7), mats.trunk, layout.trees.length);
  layout.trees.forEach((t, i) => {
    m.makeScale(t.scale, t.scale, t.scale).setPosition(t.x, 1.3 * t.scale, t.z);
    trunk.setMatrixAt(i, m);
  });
  trunk.castShadow = trunk.receiveShadow = true;
  scene.add(trunk);
  const tint = new THREE.Color();
  const tiers: [number, number, number][] = [[2.4, 3.2, 3.6], [1.9, 2.8, 5.6], [1.3, 2.4, 7.4]]; // radius, height, centre y
  for (const [r, h, cy] of tiers) {
    const tier = new THREE.InstancedMesh(new THREE.ConeGeometry(r, h, 8), mats.crown.clone(), pines.length);
    pines.forEach((t, i) => {
      m.makeScale(t.scale, t.scale, t.scale).setPosition(t.x, cy * t.scale, t.z);
      tier.setMatrixAt(i, m);
      tint.setHSL(0.3 + 0.03 * Math.sin(i * 1.7), 0.45, 0.22 + 0.06 * Math.sin(i * 2.3));
      tier.setColorAt(i, tint);
    });
    tier.castShadow = tier.receiveShadow = true;
    scene.add(tier);
  }
  if (leafy.length) {
    const crownGeo = new THREE.IcosahedronGeometry(2.6, 1);
    // Jitter the vertices so the crowns are lumpy rather than geometric.
    const cp = crownGeo.getAttribute('position');
    for (let i = 0; i < cp.count; i++) {
      const j = 0.85 + 0.3 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
      cp.setXYZ(i, cp.getX(i) * j, cp.getY(i) * 0.85 * j, cp.getZ(i) * j);
    }
    crownGeo.computeVertexNormals();
    const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x4f8a2e, roughness: 0.95 }), leafy.length);
    leafy.forEach((t, i) => {
      m.makeScale(t.scale, t.scale, t.scale).setPosition(t.x, 5.0 * t.scale, t.z);
      crown.setMatrixAt(i, m);
      tint.setHSL(0.26 + 0.04 * Math.sin(i * 3.1), 0.5, 0.3 + 0.07 * Math.sin(i * 1.3));
      crown.setColorAt(i, tint);
    });
    crown.castShadow = crown.receiveShadow = true;
    scene.add(crown);
  }

  // Distant hills: gentle flattened domes around the horizon, flat-shaded and mostly haze at that distance, so
  // they read as a skyline rather than as walls.
  const hillMat = new THREE.MeshBasicMaterial({ color: 0x6f9a6a });
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2 + 0.25 * Math.sin(i * 7.3);
    const dist = 640 + 150 * Math.abs(Math.sin(i * 2.9));
    const w = 110 + 120 * Math.abs(Math.sin(i * 1.7)); // half-width
    const h = 18 + 30 * Math.abs(Math.sin(i * 4.1)); // height above the ground
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), hillMat);
    hill.scale.set(w, h, w * 0.7);
    hill.position.set(Math.cos(ang) * dist, 0, Math.sin(ang) * dist);
    scene.add(hill);
  }


  // Fence along the back.
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), mats.metal, 61);
  for (let i = 0; i <= 60; i++) {
    m.identity().setPosition(-45 + i * 1.5, 0.6, -30);
    posts.setMatrixAt(i, m);
  }
  posts.castShadow = true;
  scene.add(posts);
  for (const y of [0.5, 1.1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(90, 0.05, 0.05), mats.wood);
    rail.position.set(0, y, -30);
    rail.castShadow = true;
    scene.add(rail);
  }

  // Distance markers for depth perception.
  for (let d = 10; d <= 40; d += 10) {
    const mk = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 6), mats.white));
    mk.position.set(0, 0.25, -d);
    scene.add(mk);
  }

  // Houses and the barn.
  for (const h of layout.houses) {
    const g = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(h.w, h.h, h.d), new THREE.MeshStandardMaterial({ color: h.color, roughness: 0.9 }));
    walls.position.y = h.h / 2;
    g.add(walls);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0, Math.SQRT1_2 * h.d, h.d * 0.3, 4, 1), new THREE.MeshStandardMaterial({ color: h.roof, roughness: 0.8 }));
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(h.w / h.d, 1, 1);
    roof.position.y = h.h + h.d * 0.15;
    g.add(roof);
    // Door and a couple of windows for scale.
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2, 0.05), mats.black);
    door.position.set(0, 1, h.d / 2 + 0.03);
    g.add(door);
    for (const wx of [-h.w / 3, h.w / 3]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(1, 0.9, 0.05), new THREE.MeshStandardMaterial({ color: 0x9ad0ff, roughness: 0.2 }));
      win.position.set(wx, h.h * 0.55, h.d / 2 + 0.03);
      g.add(win);
    }
    g.position.set(h.x, 0, h.z);
    g.rotation.y = h.rot;
    scene.add(shadowed(g));
  }

  // Pond with a pontoon.
  const pond = new THREE.Mesh(new THREE.CircleGeometry(layout.pond.r, 40), decal(mats.water));
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(layout.pond.x, 0.01, layout.pond.z);
  pond.receiveShadow = true;
  scene.add(pond);

  // Road with a centre line.
  const road = new THREE.Mesh(new THREE.PlaneGeometry(layout.road.length, layout.road.width), decal(mats.asphalt));
  road.rotation.x = -Math.PI / 2;
  road.rotation.z = layout.road.rot;
  road.position.set(layout.road.x, 0.012, layout.road.z);
  road.receiveShadow = true;
  scene.add(road);
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  for (let i = -layout.road.length / 2; i < layout.road.length / 2; i += 6) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.15), dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(layout.road.x + i, 0.015, layout.road.z);
    scene.add(dash);
  }

  // Hay bales.
  for (const b of layout.bales) {
    const bale = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.4, 14), mats.hay));
    bale.rotation.z = Math.PI / 2;
    bale.rotation.y = b.rot;
    bale.position.set(b.x, 0.75, b.z);
    scene.add(bale);
  }

  // Animals.
  const heads: { obj: THREE.Object3D; phase: number }[] = [];
  for (const a of layout.animals) {
    const g = new THREE.Group();
    const cow = a.kind === 'cow';
    const bodyLen = cow ? 1.6 : 0.9;
    const bodyH = cow ? 0.8 : 0.5;
    const legH = cow ? 0.7 : 0.4;
    const body = new THREE.Mesh(new THREE.BoxGeometry(cow ? 0.7 : 0.45, bodyH, bodyLen), cow ? mats.cow : mats.sheep);
    body.position.y = legH + bodyH / 2;
    g.add(body);
    if (cow) {
      const spot = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.4, 0.6), mats.cowSpot);
      spot.position.set(0, legH + bodyH / 2 + 0.1, 0.2);
      g.add(spot);
    }
    for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(cow ? 0.14 : 0.1, legH, cow ? 0.14 : 0.1), cow ? mats.cowSpot : mats.black);
      leg.position.set(lx * (cow ? 0.25 : 0.15), legH / 2, lz * (bodyLen / 2 - 0.15));
      g.add(leg);
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(cow ? 0.35 : 0.25, cow ? 0.4 : 0.25, cow ? 0.5 : 0.3), cow ? mats.cowSpot : mats.black);
    head.position.set(0, legH + bodyH * 0.9, bodyLen / 2 + 0.15);
    g.add(head);
    heads.push({ obj: head, phase: Math.random() * 6 });
    g.position.set(a.x, 0, a.z);
    g.rotation.y = a.rot;
    scene.add(shadowed(g));
  }

  // Landing platforms (challenges).
  for (const p of layout.platforms) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(p.size, 0.08, p.size), mats.pad);
    top.position.y = p.height - 0.04;
    g.add(top);
    // Target ring painted on the surface.
    const ring = new THREE.Mesh(new THREE.RingGeometry(p.radius - 0.05, p.radius, 32), mats.white);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = p.height + 0.002;
    g.add(ring);
    switch (p.style) {
      case 'table': {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, p.height - 0.08, 0.9), mats.wood);
        leg.position.y = (p.height - 0.08) / 2;
        g.add(leg);
        break;
      }
      case 'tower': {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, p.height - 0.08, 10), mats.tower);
        pole.position.y = (p.height - 0.08) / 2;
        g.add(pole);
        for (let i = 1; i < p.height; i += 1.5) {
          const rung = new THREE.Mesh(new THREE.BoxGeometry(p.size * 1.1, 0.06, 0.06), mats.metal);
          rung.position.y = i;
          g.add(rung);
        }
        break;
      }
      case 'truck': {
        const bed = new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 2.3), mats.truck);
        bed.position.set(0, 0.45 + 0.05, 0.1);
        g.add(bed);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.9, 2.2), mats.truck);
        cab.position.set(0, 0.95, -2.2);
        g.add(cab);
        const glass = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 0.05), new THREE.MeshStandardMaterial({ color: 0x9ad0ff, roughness: 0.2 }));
        glass.position.set(0, 1.4, -1.08);
        g.add(glass);
        for (const wx of [-1, 1]) for (const wz of [-2.4, 0.6]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12), mats.black);
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(wx * 1.0, 0.35, wz);
          g.add(wheel);
        }
        break;
      }
      case 'pontoon': {
        const floats = new THREE.Mesh(new THREE.BoxGeometry(p.size + 0.3, 0.3, p.size + 0.3), mats.wood);
        floats.position.y = 0.1;
        g.add(floats);
        break;
      }
    }
    g.position.set(p.x, 0, p.z);
    scene.add(shadowed(g));
  }

  // Windsock: pole + cone that aligns with the wind every frame.
  const pole = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, layout.windsock.height, 8), mats.metal));
  pole.position.set(layout.windsock.x, layout.windsock.height / 2, layout.windsock.z);
  scene.add(pole);
  const windsock = new THREE.Group();
  const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 1.3, 10, 1, true), mats.orange);
  sock.rotation.x = Math.PI / 2;
  sock.position.z = 0.65;
  sock.castShadow = true;
  windsock.add(sock);
  windsock.position.set(layout.windsock.x, layout.windsock.height - 0.2, layout.windsock.z);
  scene.add(windsock);

  return {
    scene,
    sun,
    setTimeOfDay,
    windsock,
    pilotMarker: pilot,
    arrow,
    animate(_dt, time) {
      for (const h of heads) h.obj.rotation.x = 0.35 + 0.3 * Math.sin(time * 0.6 + h.phase);
    },
  };
}

function makeGrassTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5c8a3a';
  g.fillRect(0, 0, 256, 256);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 4000; i++) {
    const v = 70 + rnd() * 60;
    g.fillStyle = `rgb(${(v * 0.6) | 0},${(v + 40) | 0},${(v * 0.45) | 0})`;
    g.fillRect(rnd() * 256, rnd() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makePadTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a3a3a';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 18;
  g.beginPath();
  g.arc(256, 256, 215, 0, Math.PI * 2);
  g.stroke();
  g.font = 'bold 300px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.fillText('H', 256, 270);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
