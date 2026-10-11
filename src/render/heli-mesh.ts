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

  constructor(private model: HeliModel) {
    const m = model;
    const R = m.rotor.radius;
    const L = m.tailOffset.z;
    const body = new THREE.MeshStandardMaterial({ color: 0xd8262a, roughness: 0.5, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.4, metalness: 0.8 });
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
    const sizes = { bodyLen: R * 0.95, bodyH: R * 0.36, bodyW: R * 0.25 };

    // Canopy / frame.
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), body);
    canopy.scale.set(sizes.bodyW * 0.6, sizes.bodyH * 0.5, sizes.bodyLen * 0.55);
    canopy.position.set(0, -0.01, -sizes.bodyLen * 0.15);
    canopy.castShadow = true;
    this.root.add(canopy);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(sizes.bodyW * 0.9, sizes.bodyH * 0.8, sizes.bodyLen * 0.6), dark);
    frame.position.set(0, 0.0, sizes.bodyLen * 0.1);
    frame.castShadow = true;
    this.root.add(frame);

    // Main shaft and rotor head.
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.012, R * 0.012, m.hubOffset.y * 1.1, 8), metal);
    shaft.position.set(0, m.hubOffset.y * 0.5, 0);
    this.root.add(shaft);
    this.head.position.set(m.hubOffset.x, m.hubOffset.y, m.hubOffset.z);
    this.root.add(this.head);
    const hub = new THREE.Mesh(new THREE.BoxGeometry(R * 0.12, R * 0.05, R * 0.06), metal);
    this.blades.add(hub);
    for (const side of [-1, 1]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(R * 0.95, R * 0.008, m.rotor.chord), bladeMat);
      blade.position.x = side * R * 0.52;
      blade.castShadow = true;
      this.blades.add(blade);
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
    boom.castShadow = true;
    this.root.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(R * 0.012, R * 0.3, R * 0.16), body);
    fin.position.set(0, m.tailOffset.y + R * 0.02, L * 1.02);
    fin.castShadow = true;
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

    // Skids.
    const skidPts = m.contacts.filter((c) => c.kind === 'skid');
    const xs = [...new Set(skidPts.map((c) => c.p.x))];
    const zMin = Math.min(...skidPts.map((c) => c.p.z));
    const zMax = Math.max(...skidPts.map((c) => c.p.z));
    const y = skidPts[0].p.y;
    for (const x of xs) {
      const skid = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.012, R * 0.012, zMax - zMin + R * 0.1, 8), metal);
      skid.rotation.x = Math.PI / 2;
      skid.position.set(x, y + R * 0.012, (zMin + zMax) / 2);
      skid.castShadow = true;
      this.root.add(skid);
      for (const z of [zMin + R * 0.08, zMax - R * 0.08]) {
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.01, R * 0.01, -y - sizes.bodyH * 0.3, 6), metal);
        strut.position.set(x, (y - sizes.bodyH * 0.3) / 2, z);
        this.root.add(strut);
      }
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
