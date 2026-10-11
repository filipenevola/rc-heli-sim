import * as THREE from 'three';

/** Flying field: grass, a helipad, tree line, fence, sky and sun with shadows. */
export function createScene(): { scene: THREE.Scene; sun: THREE.DirectionalLight } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc5e8);
  scene.fog = new THREE.Fog(0xbfd8ec, 120, 700);

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4e6b2c, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.2);
  sun.position.set(-40, 70, -30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 250;
  const s = 40;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0005;
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

  // Ground.
  const grass = makeGrassTexture();
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
  grass.repeat.set(400, 400);
  grass.anisotropy = 8;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({ map: grass, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Helipad: a dark square with a white H and circle, placed where the heli starts (0, 0, -6).
  const pad = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), new THREE.MeshStandardMaterial({ map: makePadTexture(), roughness: 0.9 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.005, -6);
  pad.receiveShadow = true;
  scene.add(pad);

  // Pilot marker (where you stand).
  const pilot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.7, 12), new THREE.MeshStandardMaterial({ color: 0x334466 }));
  pilot.position.set(0, 0.85, 0);
  pilot.castShadow = true;
  scene.add(pilot);

  // Trees, instanced.
  const treeCount = 140;
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 2.5, 7);
  const crownGeo = new THREE.ConeGeometry(2.2, 6, 9);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2b }), treeCount);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x2f6b2a }), treeCount);
  trunk.castShadow = crown.castShadow = true;
  const m = new THREE.Matrix4();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < treeCount; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = 45 + rnd() * 60;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    const sc = 0.8 + rnd() * 0.8;
    m.makeScale(sc, sc, sc).setPosition(x, 1.25 * sc, z);
    trunk.setMatrixAt(i, m);
    m.makeScale(sc, sc, sc).setPosition(x, (2.5 + 3) * sc, z);
    crown.setMatrixAt(i, m);
  }
  scene.add(trunk, crown);

  // Fence line along the back of the field for scale cues.
  const postGeo = new THREE.BoxGeometry(0.1, 1.2, 0.1);
  const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0xbbbbbb }), 60);
  for (let i = 0; i < 60; i++) {
    m.identity().setPosition(-45 + i * 1.5, 0.6, -30);
    posts.setMatrixAt(i, m);
  }
  posts.castShadow = true;
  scene.add(posts);

  // Distance markers every 10 m for depth perception.
  const markerMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  for (let d = 10; d <= 40; d += 10) {
    const mk = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 6), markerMat);
    mk.position.set(0, 0.25, -d);
    scene.add(mk);
  }

  return { scene, sun };
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
    g.fillStyle = `rgb(${v * 0.6 | 0},${v + 40 | 0},${v * 0.45 | 0})`;
    g.fillRect(rnd() * 256, rnd() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makePadTexture(): THREE.Texture {
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
