import * as THREE from 'three';
import type { HeliModel } from '../sim/heli-model';
import type { HeliState } from '../sim/physics';

/**
 * Procedural helicopter built from primitives, scaled from the physics model so a 700 looks like a 700.
 * The rotor head tilts with the simulated tip-path plane, blades spin at the real head speed and
 * turn into a translucent disc once they would be a blur.
 */
export class HeliMesh {
  readonly root = new THREE.Group();
  private head = new THREE.Group();
  private blades = new THREE.Group();
  private disc: THREE.Mesh;
  private tailBlades = new THREE.Group();
  private tailDisc: THREE.Mesh;
  private bladeAngle = 0;
  private tailAngle = 0;

  constructor(private model: HeliModel, ghost = false) {
    const m = model;
    const R = m.rotor.radius;
    const L = m.tailOffset.z;
    const bodyColor = m.color && /^#[0-9a-f]{6}$/i.test(m.color) ? parseInt(m.color.slice(1), 16) : m.rotor.radius > 0.6 ? 0x1f5fd6 : m.rotor.radius < 0.3 ? 0xf2b705 : 0xd8262a;
    const body = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.5, metalness: 0.2 });
    // Paint scheme: a procedural texture wrapped around the canopy (u around, v nose to tail).
    if (m.scheme && m.scheme !== 'solid' && !ghost) {
      const tex = canopyTexture(m.scheme, `#${bodyColor.toString(16).padStart(6, '0')}`);
      if (tex) { body.map = tex; body.color.set(0xffffff); }
    }
    const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.4, metalness: 0.8 });
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
    const sizes = { bodyLen: R * 0.95, bodyH: R * 0.36, bodyW: R * 0.25 };
    if (ghost) {
      // Translucent, unlit-looking, no shadows: a hint of a helicopter, not a second one.
      for (const mat of [body, dark, metal, bladeMat]) {
        mat.transparent = true;
        mat.opacity = 0.32;
        mat.depthWrite = false;
        mat.color.set(0x7fd4ff);
        mat.emissive.set(0x2a6a8a);
      }
    }

    // Canopy: a teardrop (lathe) with a two-tone scheme, bright on top and dark underneath, which is how real
    // pilots paint them so the orientation reads at a distance. The frame is a dark box behind it.
    const profile: THREE.Vector2[] = [];
    const nP = 14;
    for (let i = 0; i <= nP; i++) {
      const u = i / nP; // 0 = nose, 1 = back of the canopy
      // Nose rounded, widest at ~40%, tapering to the frame.
      const r = Math.sin(Math.PI * Math.pow(u, 0.75)) * 0.5 + (u > 0.6 ? 0.12 * (u - 0.6) : 0);
      // Profile along +y with increasing y (LatheGeometry's winding assumes that; reversing it turns the mesh
      // inside out). The nose is at y = 0, the open back at y = 0.75 L.
      profile.push(new THREE.Vector2(Math.max(0.001, r * sizes.bodyW), u * sizes.bodyLen * 0.75));
    }
    const canopyGeo = new THREE.LatheGeometry(profile, 24);
    canopyGeo.rotateX(Math.PI / 2); // +y -> +z: nose at z = 0, back at z = +0.75 L; the mesh is then shifted forward
    canopyGeo.scale(1, (sizes.bodyH / sizes.bodyW) * 0.9, 1);
    const underside = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.6, metalness: 0.1 });
    if (ghost) { underside.transparent = true; underside.opacity = 0.32; underside.depthWrite = false; underside.color.set(0x7fd4ff); }
    // Two materials by face: vertices below the centreline get the dark underside.
    const pos = canopyGeo.getAttribute('position');
    const idx: number[] = [];
    const idxDark: number[] = [];
    const index = canopyGeo.getIndex();
    const faces = index ? index.count / 3 : pos.count / 3;
    for (let f = 0; f < faces; f++) {
      const a = index ? index.getX(f * 3) : f * 3;
      const b = index ? index.getX(f * 3 + 1) : f * 3 + 1;
      const c2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;
      const yAvg = (pos.getY(a) + pos.getY(b) + pos.getY(c2)) / 3;
      (yAvg < -0.08 * sizes.bodyH ? idxDark : idx).push(a, b, c2);
    }
    canopyGeo.setIndex([...idx, ...idxDark]);
    canopyGeo.clearGroups();
    canopyGeo.addGroup(0, idx.length, 0);
    canopyGeo.addGroup(idx.length, idxDark.length, 1);
    const canopy = new THREE.Mesh(canopyGeo, [body, underside]);
    canopy.position.set(0, sizes.bodyH * 0.05, -sizes.bodyLen * 0.9);
    canopy.castShadow = !ghost;
    this.root.add(canopy);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(sizes.bodyW * 0.85, sizes.bodyH * 0.8, sizes.bodyLen * 0.55), dark);
    frame.position.set(0, 0.0, sizes.bodyLen * 0.1);
    frame.castShadow = !ghost;
    this.root.add(frame);
    // A white stripe along the top of the frame carries the orientation cue back to the tail.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(sizes.bodyW * 0.3, sizes.bodyH * 0.06, sizes.bodyLen * 0.5), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5, transparent: ghost, opacity: ghost ? 0.3 : 1 }));
    stripe.position.set(0, sizes.bodyH * 0.42, sizes.bodyLen * 0.1);
    this.root.add(stripe);

    // Main shaft and rotor head.
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.012, R * 0.012, m.hubOffset.y * 1.1, 8), metal);
    shaft.position.set(0, m.hubOffset.y * 0.5, 0);
    this.root.add(shaft);
    this.head.position.set(m.hubOffset.x, m.hubOffset.y, m.hubOffset.z);
    this.root.add(this.head);
    const hub = new THREE.Mesh(new THREE.BoxGeometry(R * 0.12, R * 0.05, R * 0.06), metal);
    this.blades.add(hub);
    // Blades spaced evenly round the hub: two opposite, or three at 120 degrees.
    const nB = Math.max(2, Math.round(m.rotor.blades));
    for (let i = 0; i < nB; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(R * 0.95, R * 0.008, m.rotor.chord), bladeMat);
      const pivot = new THREE.Group();
      blade.position.x = R * 0.52;
      blade.castShadow = !ghost;
      pivot.add(blade);
      pivot.rotation.y = (i / nB) * Math.PI * 2;
      this.blades.add(pivot);
    }
    this.head.add(this.blades);
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(R, 48),
      new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.visible = false;
    this.head.add(this.disc);

    // Tail boom, fin, stabiliser.
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.035, R * 0.028, L * 0.95, 10), metal);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, m.tailOffset.y * 0.6, L * 0.5);
    boom.castShadow = !ghost;
    this.root.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(R * 0.012, R * 0.3, R * 0.16), body);
    fin.position.set(0, m.tailOffset.y + R * 0.02, L * 1.02);
    fin.castShadow = !ghost;
    this.root.add(fin);
    const stab = new THREE.Mesh(new THREE.BoxGeometry(R * 0.32, R * 0.012, R * 0.12), body);
    stab.position.set(0, m.tailOffset.y * 0.6, L * 0.78);
    this.root.add(stab);

    // Tail rotor (on the right side).
    this.tailBlades.position.set(R * 0.05, m.tailOffset.y, L);
    for (const side of [-1, 1]) {
      const tb = new THREE.Mesh(new THREE.BoxGeometry(R * 0.012, m.tail.radius * 0.95, m.tail.chord), bladeMat);
      tb.position.y = side * m.tail.radius * 0.52;
      this.tailBlades.add(tb);
    }
    this.root.add(this.tailBlades);
    this.tailDisc = new THREE.Mesh(
      new THREE.CircleGeometry(m.tail.radius, 24),
      new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.tailDisc.rotation.y = Math.PI / 2;
    this.tailDisc.position.copy(this.tailBlades.position);
    this.tailDisc.visible = false;
    this.root.add(this.tailDisc);

    if (m.trainingGear) this.addTrainingGear(m, metal, ghost);

    // Skids (the real ones; training-gear balls are far out on the x/z axes).
    const skidPts = m.contacts.filter((c) => c.kind === 'skid' && !c.gear);
    const xs = [...new Set(skidPts.map((c) => c.p.x))];
    const zMin = Math.min(...skidPts.map((c) => c.p.z));
    const zMax = Math.max(...skidPts.map((c) => c.p.z));
    const y = skidPts[0].p.y;
    for (const x of xs) {
      const skid = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.012, R * 0.012, zMax - zMin + R * 0.1, 8), metal);
      skid.rotation.x = Math.PI / 2;
      skid.position.set(x, y + R * 0.012, (zMin + zMax) / 2);
      skid.castShadow = !ghost;
      this.root.add(skid);
      for (const z of [zMin + R * 0.08, zMax - R * 0.08]) {
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.01, R * 0.01, -y - sizes.bodyH * 0.3, 6), metal);
        strut.position.set(x, (y - sizes.bodyH * 0.3) / 2, z);
        this.root.add(strut);
      }
    }
  }

  private addTrainingGear(m: HeliModel, metal: THREE.Material, ghost: boolean): void {
    const R = m.rotor.radius;
    const arm = 0.95 * R;
    const skidY = Math.min(...m.contacts.filter((c) => c.kind === 'skid' && !c.gear).map((c) => c.p.y));
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xff8a00, roughness: 0.9 });
    if (ghost) { ballMat.transparent = true; ballMat.opacity = 0.3; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.012, R * 0.012, arm, 6), metal);
      rod.rotation.z = dx !== 0 ? Math.PI / 2 : 0;
      rod.rotation.x = dz !== 0 ? Math.PI / 2 : 0;
      rod.position.set((dx * arm) / 2, skidY + R * 0.03, (dz * arm) / 2);
      rod.castShadow = !ghost;
      this.root.add(rod);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(R * 0.1, 10, 8), ballMat);
      ball.position.set(dx * arm, skidY + R * 0.03, dz * arm);
      ball.castShadow = !ghost;
      this.root.add(ball);
    }
  }

  update(s: HeliState, dt: number): void {
    this.root.position.set(s.pos.x, s.pos.y, s.pos.z);
    this.root.quaternion.set(s.ori.x, s.ori.y, s.ori.z, s.ori.w);
    // Head follows the tip-path plane: normal = (b1, 1, a1) in body frame.
    this.head.rotation.set(s.a1, 0, -s.b1, 'XZY');
    const spin = this.model.clockwise ? -1 : 1;
    this.bladeAngle += spin * s.rotorOmega * dt;
    this.blades.rotation.y = this.bladeAngle;
    const fast = s.rotorOmega > 60;
    this.disc.visible = fast;
    this.blades.visible = !fast || s.rotorOmega < 120;
    this.tailAngle += s.rotorOmega * this.model.tailGearRatio * dt;
    this.tailBlades.rotation.x = this.tailAngle;
    this.tailDisc.visible = fast;
    this.tailBlades.visible = !fast;
  }
}

/** Canopy paint as a canvas texture: stripes along the body, flames licking back from the nose, or a checker. */
export function canopyTexture(scheme: 'stripes' | 'flames' | 'checker', base: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 128);
  // v runs nose (0) to tail (1) along y of the canvas; u around the body along x.
  if (scheme === 'stripes') {
    g.fillStyle = '#ffffff';
    for (const y of [40, 60]) g.fillRect(0, y, 256, 6);
    g.fillStyle = '#111111';
    g.fillRect(0, 50, 256, 4);
  } else if (scheme === 'checker') {
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 16; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2 === 0 && j < 5) g.fillRect(i * 16, j * 16, 16, 16);
  } else {
    // Flames: tongues from the nose back, on the upper half only (the underside stays dark on the model anyway).
    g.fillStyle = '#ffd34d';
    for (let k = 0; k < 7; k++) {
      const x0 = 20 + k * 34;
      g.beginPath();
      g.moveTo(x0 - 14, 0);
      g.quadraticCurveTo(x0 - 4, 30 + (k % 3) * 10, x0, 70 + (k % 2) * 16);
      g.quadraticCurveTo(x0 + 4, 30 + ((k + 1) % 3) * 10, x0 + 14, 0);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#ff6a00';
    for (let k = 0; k < 7; k++) {
      const x0 = 20 + k * 34;
      g.beginPath();
      g.moveTo(x0 - 8, 0);
      g.quadraticCurveTo(x0 - 2, 20 + (k % 3) * 8, x0, 48 + (k % 2) * 12);
      g.quadraticCurveTo(x0 + 2, 20 + ((k + 1) % 3) * 8, x0 + 8, 0);
      g.closePath();
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}
