import * as THREE from 'three';
import type { CanopyScheme, HeliModel } from '../sim/heli-model';
import type { HeliState } from '../sim/physics';
import type { HeadType } from '../game/parts';
import { LAYER_HELI } from './environment';

/**
 * A procedural RC helicopter built part by part, the way it is assembled on the bench: frame, bearing blocks, main
 * shaft and gear, motor and pinion, 120° CCPM servos, swashplate, pitch links, head block, feathering shaft, grips,
 * blades (flybar, paddles, mixer and washout on the trainer), tail boom, supports, tail servo and rod, tail gearbox,
 * slider, hub and blades, electronics, canopy and landing gear.
 *
 * Every part is a named group (parts.ts holds the text) so the Hangar view can pick, highlight and explode it.
 * Nothing here is decoration on top of the physics: the swashplate height and tilt, blade-grip pitch per blade,
 * servo arms, pitch links, flybar teeter, tail slider and tail pitch come from the simulated servo positions; the
 * head follows the simulated tip-path plane; gears and rotors turn at the simulated speeds; the skids, boom end, fin
 * and head sit on the physics contact points.
 *
 * Built in 450-size units (metres for a 450) and stretched to the model's own contact points, rotor and tail sizes.
 */

export interface PartPiece {
  group: THREE.Group;
  base: THREE.Vector3;
  explode: THREE.Vector3;
}
export interface PartHandle {
  id: string;
  pieces: PartPiece[];
  meshes: THREE.Mesh[];
}

type MatKey =
  | 'carbon' | 'alu' | 'aluBlue' | 'aluDark' | 'steel' | 'plastic' | 'plasticWhite' | 'gear' | 'blade' | 'rubber'
  | 'canopy' | 'battery' | 'esc' | 'gyro' | 'rx' | 'motor' | 'motorBell' | 'brass' | 'wireRed' | 'wireBlack'
  | 'wireYellow' | 'wireOrange' | 'belt' | 'tapeRed' | 'tapeYellow' | 'decal' | 'led' | 'servo' | 'ball' | 'engine' | 'fuel';

const UP = new THREE.Vector3(0, 1, 0);

export class HeliMesh {
  readonly root = new THREE.Group();
  readonly parts = new Map<string, PartHandle>();
  readonly head: HeadType;
  readonly power: 'electric' | 'nitro';
  /** Hangar: rotor speed override for a slow demo spin (rad/s), or null to use the simulation's. */
  spinOverride: number | null = null;

  private model: HeliModel;
  private core = new THREE.Group();
  private S: THREE.Vector3;
  private sr: number;
  private st: number;
  private base: Record<MatKey, THREE.Material>;
  private partMats = new Map<string, Map<string, THREE.Material>>();
  private disposables: { dispose(): void }[] = [];

  // Moving bits.
  private tpp = new THREE.Group();
  private spin = new THREE.Group();
  private spinFlat = new THREE.Group();
  private bladePitch: THREE.Group[] = [];
  private flybarTeeter: THREE.Group | null = null;
  private swashTilt = new THREE.Group();
  private swashSpin = new THREE.Group();
  private washout: THREE.Group | null = null;
  private servoArms: { arm: THREE.Group; shaft: THREE.Vector3; length: number; ball: THREE.Object3D; swashBall: THREE.Object3D }[] = [];
  private links: { mesh: THREE.Mesh; a: THREE.Object3D; b: THREE.Object3D }[] = [];
  private mainGear = new THREE.Group();
  private pinion = new THREE.Group();
  private motorBell = new THREE.Group();
  private tailDriveFront = new THREE.Group();
  private tailSpin = new THREE.Group();
  private tailBladePitch: THREE.Group[] = [];
  private slider = new THREE.Group();
  private pitchLever = new THREE.Group();
  private tailServoArm = new THREE.Group();
  private tailRod = new THREE.Group();
  private disc: THREE.Mesh;
  private tailDisc: THREE.Mesh;
  private discUniforms: { angle: { value: number }; opacity: { value: number } };
  private bladeMeshes: THREE.Object3D[] = [];
  private tailBladeMeshes: THREE.Object3D[] = [];
  private bladeAngle = 0;
  private stipple: THREE.Texture;
  private tailAngle = 0;
  private explodeT = 0;
  private swashRestY = 0.05;

  /**
   * @param ghost a translucent, shadowless copy (replays and "fly against a ghost"): same shape, no decals.
   */
  constructor(model: HeliModel, ghost = false) {
    this.model = model;
    this.head = model.controller.type;
    this.power = model.power ?? 'electric';
    // Training-gear balls are skid contacts far out on the axes: they are not the skids.
    const skid = model.contacts.filter((c) => c.kind === 'skid' && !c.gear);
    const skidX = Math.max(...skid.map((c) => Math.abs(c.p.x)));
    const skidY = Math.min(...skid.map((c) => c.p.y));
    const nose = model.contacts.filter((c) => c.kind === 'hard').reduce((a, c) => Math.min(a, c.p.z), 0);
    // Stretch from the 450 reference to this model's skid width, skid-to-hub height and nose position.
    this.S = new THREE.Vector3(skidX / 0.085, (model.hubOffset.y - skidY) / 0.215, nose / -0.22);
    this.sr = model.rotor.radius / 0.36;
    this.st = model.tail.radius / 0.065;
    this.base = { ...makeMaterials(), canopy: canopyMaterial(model) };
    this.core.scale.copy(this.S);
    this.root.add(this.core);

    this.buildFrame();
    if (this.power === 'nitro') this.buildEngine();
    else this.buildDrive();
    this.buildControls();
    this.buildHead();
    this.buildTail();
    this.buildElectronics();
    this.buildAirframe();
    if (model.trainingGear) this.buildTrainingGear();

    // Rotor blur disc and its faint, density-correct shadow.
    const R = model.rotor.radius;
    this.discUniforms = { angle: { value: 0 }, opacity: { value: 1 } };
    // The hub group is scaled by sr, so the disc is built in 450 units.
    const Rl = R / this.sr;
    const cl = model.rotor.chord / this.sr;
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(Rl, 96), makeDiscMaterial(Rl, cl, model.rotor.blades, this.discUniforms));
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = 0.004;
    this.disc.castShadow = true;
    // three copies alphaMap/alphaTest from the visible material into the shadow depth material, so the stipple that
    // makes the disc shadow faint lives on the disc material itself (its own shader ignores both).
    const stipple = makeDiscShadowMaterial(Rl, cl, model.rotor.blades);
    this.disc.customDepthMaterial = stipple;
    this.stipple = stipple.alphaMap!;
    this.stipple.center.set(0.5, 0.5);
    const discMat = this.disc.material as THREE.ShaderMaterial;
    (discMat as unknown as { alphaMap: THREE.Texture | null }).alphaMap = stipple.alphaMap;
    discMat.alphaTest = stipple.alphaTest;
    this.disc.renderOrder = 5;
    this.tpp.add(this.disc);
    const tR = model.tail.radius;
    const tRl = tR / this.st;
    this.tailDisc = new THREE.Mesh(new THREE.CircleGeometry(tRl, 48), makeDiscMaterial(tRl, model.tail.chord / this.st, model.tail.blades, { angle: { value: 0 }, opacity: { value: 1 } }, false));
    this.tailDisc.rotation.y = Math.PI / 2;
    this.tailDisc.renderOrder = 5;
    this.tailSpin.parent!.add(this.tailDisc);
    this.tailDisc.position.copy(this.tailSpin.position);

    this.root.traverse((o) => {
      o.layers.set(LAYER_HELI);
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = !ghost;
        m.receiveShadow = !ghost;
      }
    });
    if (ghost) {
      // Translucent, unlit-looking: a hint of a helicopter, not a second one.
      for (const mats of this.partMats.values()) for (const mm of mats.values()) {
        const m = mm as THREE.MeshStandardMaterial;
        m.transparent = true;
        m.opacity = 0.3;
        m.depthWrite = false;
        m.map = null;
        m.color?.set(0x7fd4ff);
        m.emissive?.set(0x2a6a8a);
        m.userData.baseOpacity = 0.3;
        m.userData.baseTransparent = true;
      }
      for (const pc of this.parts.get('canopy')?.pieces ?? []) pc.group.traverse((o) => { if ((o as THREE.Mesh).geometry?.userData?.decal) o.visible = false; });
    }
    for (const p of this.parts.values()) for (const pc of p.pieces) pc.base.copy(pc.group.position);
  }

  /* ------------------------------------------------------------------------------------------------ */
  /* Building helpers                                                                                   */
  /* ------------------------------------------------------------------------------------------------ */

  private mat(part: string, key: MatKey, decal?: string): THREE.Material {
    let m = this.partMats.get(part);
    if (!m) this.partMats.set(part, (m = new Map()));
    const k = decal ? `decal:${decal}` : key;
    let mm = m.get(k);
    if (!mm) {
      mm = this.base[key].clone();
      if (decal) (mm as THREE.MeshStandardMaterial).map = decalTexture(decal);
      mm.userData.baseOpacity = mm.opacity;
      mm.userData.baseTransparent = mm.transparent;
      m.set(k, mm);
    }
    return mm;
  }

  /** A piece of a part: a group under `parent` that explodes by `explode` (450 units, parent space). */
  private handle(part: string): PartHandle {
    let h = this.parts.get(part);
    if (!h) this.parts.set(part, (h = { id: part, pieces: [], meshes: [] }));
    return h;
  }

  private piece(part: string, parent: THREE.Object3D, explode: [number, number, number] = [0, 0, 0]): THREE.Group {
    const h = this.handle(part);
    const g = new THREE.Group();
    g.userData.part = part;
    parent.add(g);
    h.pieces.push({ group: g, base: new THREE.Vector3(), explode: new THREE.Vector3(...explode) });
    return g;
  }

  private mesh(part: string, parent: THREE.Object3D, geo: THREE.BufferGeometry, key: MatKey, pos?: [number, number, number], rot?: [number, number, number]): THREE.Mesh {
    const m = new THREE.Mesh(geo, this.mat(part, key, geo.userData.decal as string | undefined));
    if (pos) m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    m.userData.part = part;
    parent.add(m);
    this.handle(part).meshes.push(m);
    this.disposables.push(geo);
    return m;
  }

  /** A rod between two points in `parent` space. */
  private rod(part: string, parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, key: MatKey): THREE.Mesh {
    const d = b.clone().sub(a);
    const m = this.mesh(part, parent, new THREE.CylinderGeometry(r, r, 1, 8), key);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(UP, d.clone().normalize());
    m.scale.set(1, d.length(), 1);
    return m;
  }

  private tube(part: string, parent: THREE.Object3D, pts: [number, number, number][], r: number, key: MatKey, segs = 24): THREE.Mesh {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    return this.mesh(part, parent, new THREE.TubeGeometry(curve, segs, r, 8, false), key);
  }

  /** A link rod updated every frame between two anchors (anywhere in the hierarchy). */
  private link(part: string, a: THREE.Object3D, b: THREE.Object3D, r: number): void {
    const m = this.mesh(part, this.root, new THREE.CylinderGeometry(r, r, 1, 6), 'steel');
    // Ball links at both ends, as on the real thing.
    const end = new THREE.CylinderGeometry(r * 2.2, r * 2.2, 0.08, 8);
    this.disposables.push(end);
    for (const y of [-0.46, 0.46]) {
      const e = new THREE.Mesh(end, this.mat(part, 'plastic'));
      e.position.y = y;
      e.userData.part = part;
      m.add(e);
      this.handle(part).meshes.push(e);
    }
    this.links.push({ mesh: m, a, b });
  }

  private ball(part: string, parent: THREE.Object3D, p: [number, number, number], r = 0.0022): THREE.Object3D {
    const m = this.mesh(part, parent, new THREE.SphereGeometry(r, 10, 8), 'steel', p);
    return m;
  }

  /** Map a point in core (450) space into root space. */
  private coreToRoot(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x * this.S.x, y * this.S.y, z * this.S.z);
  }

  /* ------------------------------------------------------------------------------------------------ */
  /* Airframe core                                                                                      */
  /* ------------------------------------------------------------------------------------------------ */

  private buildFrame(): void {
    const c = this.core;
    // Side plates: carbon, with lightening holes. Shape in (z, y), extruded along x.
    const outline = new THREE.Shape();
    const pts: [number, number][] = [[-0.078, -0.072], [-0.07, 0.008], [-0.05, 0.034], [0.04, 0.036], [0.07, 0.016], [0.088, 0.012], [0.088, -0.016], [0.07, -0.024], [0.058, -0.072]];
    outline.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) outline.lineTo(p[0], p[1]);
    outline.closePath();
    for (const [hz, hy, hr] of [[-0.052, -0.035, 0.011], [-0.03, 0.012, 0.008], [0.028, -0.048, 0.01], [0.05, 0.012, 0.007], [-0.055, -0.006, 0.006]] as const) {
      const hole = new THREE.Path();
      hole.absarc(hz, hy, hr, 0, Math.PI * 2, true);
      outline.holes.push(hole);
    }
    const plate = new THREE.ExtrudeGeometry(outline, { depth: 0.0018, bevelEnabled: false, curveSegments: 16 });
    plate.rotateY(-Math.PI / 2);
    for (const side of [-1, 1]) {
      const g = this.piece('frame', c, [side * 0.05, 0, 0]);
      this.mesh('frame', g, side > 0 ? plate : plate.clone(), 'carbon', [side > 0 ? 0.0258 : -0.024, 0, 0]);
    }
    const spacers = this.piece('frame', c, [0, -0.04, 0]);
    this.mesh('frame', spacers, new THREE.BoxGeometry(0.05, 0.002, 0.13), 'carbon', [0, -0.073, -0.008]);
    for (const [z, y] of [[-0.07, 0.0], [0.08, 0.0], [0.06, -0.06], [-0.06, -0.06]]) {
      this.mesh('frame', spacers, new THREE.CylinderGeometry(0.003, 0.003, 0.048, 8), 'aluDark', [0, y, z], [0, 0, Math.PI / 2]);
    }
    // Battery tray reaching forward under the canopy.
    this.mesh('frame', spacers, new THREE.BoxGeometry(0.034, 0.002, 0.11), 'carbon', [0, -0.067, -0.112]);

    // Bearing blocks.
    for (const y of [0.03, -0.02]) {
      const g = this.piece('bearing-blocks', c, [0, y > 0 ? 0.03 : -0.02, 0.04]);
      this.mesh('bearing-blocks', g, new THREE.BoxGeometry(0.046, 0.01, 0.022), 'aluBlue', [0, y, 0]);
      this.mesh('bearing-blocks', g, new THREE.CylinderGeometry(0.006, 0.006, 0.011, 16), 'steel', [0, y, 0]);
    }
  }

  private buildDrive(): void {
    const c = this.core;
    const hubY = this.model.hubOffset.y / this.S.y;
    // Main shaft (core space, top just under the head block).
    const shaft = this.piece('main-shaft', c, [0, 0.07, 0]);
    this.mesh('main-shaft', shaft, new THREE.CylinderGeometry(0.0025, 0.0025, hubY + 0.07, 12), 'steel', [0, (hubY - 0.07) / 2, 0]);

    // Main gear with the one-way bearing hub.
    const mg = this.piece('main-gear', c, [0, -0.045, 0]);
    this.mainGear.position.set(0, -0.035, 0);
    mg.add(this.mainGear);
    this.mesh('main-gear', this.mainGear, gearGeometry(72, 0.032, 0.0295, 0.005), 'gear', [0, 0, 0]);
    this.mesh('main-gear', this.mainGear, new THREE.CylinderGeometry(0.009, 0.009, 0.009, 20), 'aluDark');
    this.mesh('main-gear', this.mainGear, new THREE.CylinderGeometry(0.0055, 0.0055, 0.0095, 16), 'steel');
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.mesh('main-gear', this.mainGear, new THREE.CylinderGeometry(0.004, 0.004, 0.0052, 12), 'plastic', [Math.cos(a) * 0.019, 0, Math.sin(a) * 0.019]);
    }

    // Motor hanging below the gear in front of the shaft, pinion meshing with the main gear.
    const motorZ = -0.0385;
    const mo = this.piece('motor', c, [0, -0.06, -0.05]);
    this.mesh('motor', mo, new THREE.CylinderGeometry(0.0142, 0.0142, 0.004, 24), 'aluDark', [0, -0.044, motorZ]); // mount flange
    this.motorBell.position.set(0, -0.064, motorZ);
    mo.add(this.motorBell);
    this.mesh('motor', this.motorBell, new THREE.CylinderGeometry(0.0145, 0.0145, 0.034, 28, 1, false), 'motorBell');
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.mesh('motor', this.motorBell, new THREE.BoxGeometry(0.003, 0.02, 0.0012), 'motor', [Math.cos(a) * 0.0146, 0.002, Math.sin(a) * 0.0146], [0, -a, 0]);
    }
    this.mesh('motor', this.motorBell, new THREE.CylinderGeometry(0.006, 0.006, 0.0352, 16), 'motor');
    const pn = this.piece('pinion', c, [0, -0.02, -0.03]);
    this.pinion.position.set(0, -0.035, motorZ);
    pn.add(this.pinion);
    this.mesh('pinion', this.pinion, gearGeometry(13, 0.0062, 0.005, 0.006), 'brass');
    this.mesh('pinion', this.pinion, new THREE.CylinderGeometry(0.0016, 0.0016, 0.014, 8), 'steel', [0, -0.005, 0]);

    // Front tail drive at boom height on the main shaft.
    const td = this.piece('tail-drive-gear', c, [0, 0.0, 0.05]);
    this.tailDriveFront.position.set(0, 0, 0);
    td.add(this.tailDriveFront);
    if (this.head === 'flybar') {
      this.mesh('tail-drive-gear', this.tailDriveFront, gearGeometry(28, 0.0105, 0.0095, 0.007), 'plastic');
      for (const y of [-0.0042, 0.0042]) this.mesh('tail-drive-gear', this.tailDriveFront, new THREE.CylinderGeometry(0.012, 0.012, 0.0012, 24), 'alu', [0, y, 0]);
    } else {
      // Crown gear meshing with the torque tube's front pinion.
      this.mesh('tail-drive-gear', this.tailDriveFront, gearGeometry(40, 0.014, 0.0125, 0.003), 'aluDark', [0, -0.006, 0]);
      this.mesh('tail-drive-gear', this.tailDriveFront, new THREE.CylinderGeometry(0.008, 0.008, 0.008, 16), 'aluDark', [0, -0.002, 0]);
    }
  }

  private buildControls(): void {
    const c = this.core;
    this.swashRestY = 0.05;
    // Swashplate: tilting group; the lower ring does not turn, the upper ring turns with the head.
    const sw = this.piece('swashplate', c, [0, 0.03, 0]);
    sw.add(this.swashTilt);
    this.swashTilt.position.set(0, this.swashRestY, 0);
    this.mesh('swashplate', this.swashTilt, new THREE.CylinderGeometry(0.019, 0.019, 0.005, 32), 'alu', [0, -0.0025, 0]);
    this.mesh('swashplate', this.swashTilt, new THREE.CylinderGeometry(0.008, 0.008, 0.0062, 20), 'steel', [0, -0.0025, 0]);
    // Lower ring servo balls at 120° (rear = elevator, front left/right = aileron/pitch) plus the anti-rotation pin.
    const swashBalls: THREE.Object3D[] = [];
    for (const [bx, bz] of [[0.019, -0.011], [-0.019, -0.011], [0, 0.022]] as const) {
      const arm = new THREE.Vector3(bx, 0, bz).normalize().multiplyScalar(0.016);
      this.mesh('swashplate', this.swashTilt, new THREE.BoxGeometry(0.004, 0.003, 0.009), 'alu', [arm.x, -0.0035, arm.z], [0, Math.atan2(bx, bz), 0]);
      swashBalls.push(this.ball('swashplate', this.swashTilt, [bx, -0.0045, bz]));
    }
    this.mesh('swashplate', this.swashTilt, new THREE.CylinderGeometry(0.0015, 0.0015, 0.012, 8), 'steel', [0, -0.0025, 0.024], [Math.PI / 2, 0, 0]);
    this.swashTilt.add(this.swashSpin);
    this.mesh('swashplate', this.swashSpin, new THREE.CylinderGeometry(0.015, 0.015, 0.004, 32), 'aluBlue', [0, 0.0018, 0]);

    // Anti-rotation guide behind the shaft.
    const ar = this.piece('anti-rotation', c, [0, 0.01, 0.04]);
    this.mesh('anti-rotation', ar, new THREE.BoxGeometry(0.01, 0.03, 0.003), 'plastic', [0, 0.048, 0.03]);
    this.mesh('anti-rotation', ar, new THREE.BoxGeometry(0.003, 0.024, 0.0035), 'aluDark', [0, 0.05, 0.0285]);

    // Cyclic servos: two in front (arms reaching back to the front swash balls) and one behind the shaft.
    const servoSpecs: { body: [number, number, number]; shaft: [number, number, number]; ball: [number, number, number]; out: number }[] = [
      { body: [0.032, -0.006, -0.003], shaft: [0.021, 0.004, -0.003], ball: [0.021, 0.004, -0.011], out: 1 },
      { body: [-0.032, -0.006, -0.003], shaft: [-0.021, 0.004, -0.003], ball: [-0.021, 0.004, -0.011], out: -1 },
      { body: [0.0, -0.009, 0.034], shaft: [0.0, 0.004, 0.03], ball: [0.0, 0.004, 0.022], out: 0 },
    ];
    servoSpecs.forEach((sp, i) => {
      const g = this.piece('cyclic-servos', c, sp.out === 0 ? [0, -0.02, 0.05] : [sp.out * 0.05, 0, 0]);
      const side = sp.out === 0;
      this.mesh('cyclic-servos', g, new THREE.BoxGeometry(side ? 0.023 : 0.012, 0.023, side ? 0.012 : 0.023), 'servo', sp.body);
      this.mesh('cyclic-servos', g, new THREE.BoxGeometry(side ? 0.031 : 0.0125, 0.002, side ? 0.0125 : 0.031), 'servo', [sp.body[0], sp.body[1] + 0.008, sp.body[2]]);
      const arm = new THREE.Group();
      arm.position.set(...sp.shaft);
      g.add(arm);
      const L = sp.shaft[2] - sp.ball[2];
      this.mesh('cyclic-servos', arm, new THREE.BoxGeometry(0.0028, 0.0018, L + 0.004), 'plasticWhite', [0, 0, -L / 2]);
      this.mesh('cyclic-servos', arm, new THREE.CylinderGeometry(0.0025, 0.0025, 0.004, 12), 'plasticWhite', [0, 0, 0], [0, 0, Math.PI / 2]);
      const ball = this.ball('cyclic-servos', arm, [0, 0, -L]);
      this.servoArms.push({ arm, shaft: new THREE.Vector3(...sp.shaft), length: L, ball, swashBall: swashBalls[i] });
    });
    for (const s of this.servoArms) this.link('servo-pushrods', s.ball, s.swashBall, 0.0009 * this.S.y);
  }

  /* ------------------------------------------------------------------------------------------------ */
  /* Rotor head                                                                                         */
  /* ------------------------------------------------------------------------------------------------ */

  private buildHead(): void {
    const m = this.model;
    const sr = this.sr;
    const hub = new THREE.Group();
    hub.position.set(m.hubOffset.x, m.hubOffset.y, m.hubOffset.z);
    hub.scale.setScalar(sr);
    this.root.add(hub);
    hub.add(this.tpp);
    this.tpp.add(this.spin);
    hub.add(this.spinFlat);
    const R = m.rotor.radius / sr; // in 450 units: 0.36
    const chord = m.rotor.chord / sr;

    // Head block, head button.
    const hb = this.piece('head-block', this.spin, [0, 0.06, 0]);
    this.mesh('head-block', hb, new THREE.BoxGeometry(0.02, 0.014, 0.016), 'aluBlue');
    this.mesh('head-block', hb, new THREE.CylinderGeometry(0.0065, 0.0065, 0.016, 16), 'aluBlue', [0, -0.012, 0]);
    this.mesh('head-block', hb, new THREE.CylinderGeometry(0.004, 0.0045, 0.005, 16), 'aluDark', [0, 0.0095, 0]);
    this.mesh('head-block', hb, new THREE.CylinderGeometry(0.0012, 0.0012, 0.022, 8), 'steel', [0, -0.012, 0], [0, 0, Math.PI / 2]);
    // Feathering shaft through the block, with the damper rings showing at each side.
    const sp = this.piece('spindle', this.spin, [0, 0.045, 0]);
    this.mesh('spindle', sp, new THREE.CylinderGeometry(0.002, 0.002, 0.072, 12), 'steel', [0, 0, 0], [0, 0, Math.PI / 2]);
    for (const s of [-1, 1]) this.mesh('spindle', sp, new THREE.TorusGeometry(0.0042, 0.0012, 6, 16), 'rubber', [s * 0.0105, 0, 0], [0, Math.PI / 2, 0]);

    // Blades with grips: one pitch group per blade, the second rotated 180° about the shaft.
    const bladeGeo = bladeGeometry(R - 0.036, chord);
    this.disposables.push(bladeGeo);
    for (let b = 0; b < m.rotor.blades; b++) {
      const holder = new THREE.Group();
      holder.rotation.y = (b / m.rotor.blades) * Math.PI * 2;
      this.spin.add(holder);
      const pitch = new THREE.Group();
      holder.add(pitch);
      this.bladePitch.push(pitch);
      const grip = this.piece('blade-grips', pitch, [0.05, 0.03, 0]);
      this.mesh('blade-grips', grip, new THREE.BoxGeometry(0.026, 0.012, 0.014), 'alu', [0.026, 0, 0]);
      this.mesh('blade-grips', grip, new THREE.CylinderGeometry(0.0072, 0.0072, 0.012, 16), 'alu', [0.016, 0, 0], [0, 0, Math.PI / 2]);
      for (const y of [-0.0045, 0.0045]) this.mesh('blade-grips', grip, new THREE.BoxGeometry(0.018, 0.0022, 0.016), 'alu', [0.045, y, 0]);
      // Pitch arm on the leading side (rotation is clockwise from above, so +z leads on the +x blade).
      this.mesh('blade-grips', grip, new THREE.BoxGeometry(0.004, 0.003, 0.015), 'alu', [0.018, -0.003, 0.009]);
      const armBall = this.ball('blade-grips', grip, [0.018, -0.0055, 0.016]);
      const bolt = this.piece('blade-bolts', pitch, [0.04, 0.06, 0]);
      this.mesh('blade-bolts', bolt, new THREE.CylinderGeometry(0.0016, 0.0016, 0.016, 10), 'steel', [0.046, 0, 0]);
      this.mesh('blade-bolts', bolt, new THREE.CylinderGeometry(0.003, 0.003, 0.0025, 6), 'steel', [0.046, 0.0075, 0]);
      this.mesh('blade-bolts', bolt, new THREE.CylinderGeometry(0.003, 0.003, 0.003, 6), 'steel', [0.046, -0.0075, 0]);
      const bl = this.piece('main-blades', pitch, [0.1, 0.07, 0]);
      const blade = this.mesh('main-blades', bl, bladeGeo, 'blade', [0.036, 0, 0]);
      this.bladeMeshes.push(bl);
      // Tracking tape near the tip: a different colour on each blade.
      this.mesh('main-blades', bl, new THREE.BoxGeometry(0.022, chord * 0.1, chord * 0.98), b === 0 ? 'tapeRed' : 'tapeYellow', [R - 0.04, 0, -chord * 0.25]);
      blade.castShadow = true;

      // Pitch link from the upper swash ring to the grip arm (FBL: direct; flybar: via the mixer, simplified).
      // Upper ring ball under the pitch arm: (0.018, 0.016) turned by the blade's angle on the head.
      const a = holder.rotation.y;
      const px = 0.018;
      const pz = 0.016;
      const bx = px * Math.cos(a) + pz * Math.sin(a);
      const bz = -px * Math.sin(a) + pz * Math.cos(a);
      const swashBall = this.ball('swashplate', this.swashSpin, [bx, 0.0045, bz]);
      this.mesh('swashplate', this.swashSpin, new THREE.BoxGeometry(0.004, 0.003, 0.024), 'aluBlue', [bx / 2, 0.003, bz / 2], [0, Math.atan2(bx, bz), 0]);
      this.link('head-links', swashBall, armBall, 0.0009 * sr);

      if (this.head === 'flybar') {
        // Bell-Hiller mixing arm on the grip, pointing to the leading side.
        const mix = this.piece('mixing-arms', pitch, [0.03, 0.05, 0.02]);
        this.mesh('mixing-arms', mix, new THREE.BoxGeometry(0.003, 0.004, 0.026), 'plastic', [0.012, 0.009, 0.006]);
        this.mesh('mixing-arms', mix, new THREE.CylinderGeometry(0.0025, 0.0025, 0.006, 10), 'steel', [0.012, 0.009, 0], [0, 0, Math.PI / 2]);
      }
    }

    if (this.head === 'flybar') {
      // Flybar across the head (90° to the blades) on its seesaw, teetering with the simulated flybar plane.
      const fs = this.piece('flybar-seesaw', this.spinFlat, [0, 0.09, 0]);
      fs.position.y = 0.014;
      this.mesh('flybar-seesaw', fs, new THREE.BoxGeometry(0.028, 0.006, 0.01), 'plastic');
      for (const s of [-1, 1]) this.mesh('flybar-seesaw', fs, new THREE.BoxGeometry(0.003, 0.012, 0.012), 'plastic', [s * 0.0135, -0.004, 0]);
      this.flybarTeeter = new THREE.Group();
      fs.add(this.flybarTeeter);
      const fb = this.piece('flybar', this.flybarTeeter, [0, 0.02, 0]);
      this.mesh('flybar', fb, new THREE.CylinderGeometry(0.0013, 0.0013, 0.36, 8), 'steel', [0, 0, 0], [Math.PI / 2, 0, 0]);
      const pad = this.piece('flybar-paddles', this.flybarTeeter, [0, 0.02, 0]);
      const paddle = paddleGeometry();
      this.disposables.push(paddle);
      for (const s of [-1, 1]) this.mesh('flybar-paddles', pad, paddle, 'plastic', [0, 0, s * 0.155], [0, s > 0 ? 0 : Math.PI, 0]);
      // Washout on the shaft below the head block, turning with the head.
      const wo = this.piece('washout', this.spinFlat, [0, 0.035, 0]);
      this.washout = new THREE.Group();
      this.washout.position.y = -0.026;
      wo.add(this.washout);
      this.mesh('washout', this.washout, new THREE.CylinderGeometry(0.0065, 0.0065, 0.006, 16), 'alu');
      this.mesh('washout', this.washout, new THREE.BoxGeometry(0.03, 0.003, 0.004), 'plastic', [0, 0.001, 0]);
      for (const s of [-1, 1]) this.ball('washout', this.washout, [s * 0.015, 0.001, 0.003]);
    }
  }

  /* ------------------------------------------------------------------------------------------------ */
  /* Tail                                                                                               */
  /* ------------------------------------------------------------------------------------------------ */

  private buildTail(): void {
    const m = this.model;
    const st = this.st;
    const boomY = 0;
    const zFront = this.coreToRoot(0, 0, 0.07).z;
    const zEnd = m.tailOffset.z - 0.012 * st;
    const boomR = 0.0075 * st;

    // Boom.
    const bm = this.piece('tail-boom', this.root, [0, 0, 0.06]);
    this.mesh('tail-boom', bm, new THREE.CylinderGeometry(boomR, boomR, zEnd - zFront, 20, 1, true), 'alu', [0, boomY, (zFront + zEnd) / 2], [Math.PI / 2, 0, 0]);
    // Boom clamp on the frame.
    this.mesh('tail-boom', bm, new THREE.CylinderGeometry(boomR * 1.35, boomR * 1.35, 0.022 * this.S.z, 16), 'plastic', [0, boomY, zFront + 0.006 * this.S.z], [Math.PI / 2, 0, 0]);

    // Tail drive inside the boom: a twisted belt on the trainer, a torque tube on the FBL machines.
    const tdr = this.piece('tail-drive', this.root, [0, -0.04, 0.03]);
    if (this.head === 'flybar') {
      for (const s of [-1, 1]) this.mesh('tail-drive', tdr, twistedBelt(zFront - 0.01, zEnd, boomR * 0.55 * s, 0.006 * st, 0.0008 * st), 'belt', [0, boomY, 0]);
    } else {
      this.mesh('tail-drive', tdr, new THREE.CylinderGeometry(0.0018 * st, 0.0018 * st, zEnd - zFront, 8), 'steel', [0, boomY, (zFront + zEnd) / 2], [Math.PI / 2, 0, 0]);
      for (const f of [0.35, 0.7]) this.mesh('tail-drive', tdr, new THREE.TorusGeometry(boomR * 0.6, boomR * 0.25, 6, 16), 'rubber', [0, boomY, zFront + (zEnd - zFront) * f]);
    }

    // Boom supports from the frame bottom to the boom.
    const sup = this.piece('boom-supports', this.root, [0, -0.02, 0.03]);
    const zs = zFront + (zEnd - zFront) * 0.58;
    for (const s of [-1, 1]) {
      const a = this.coreToRoot(s * 0.022, -0.066, 0.062);
      const b = new THREE.Vector3(s * boomR * 0.9, boomY - boomR * 0.6, zs);
      this.rod('boom-supports', sup, a, b, 0.0016 * st, 'carbon');
      this.mesh('boom-supports', sup, new THREE.SphereGeometry(0.003 * st, 8, 6), 'plastic', [b.x, b.y, b.z]);
    }
    this.mesh('boom-supports', sup, new THREE.CylinderGeometry(boomR * 1.3, boomR * 1.3, 0.01 * st, 14), 'plastic', [0, boomY, zs], [Math.PI / 2, 0, 0]);

    // Horizontal stabiliser.
    const hs = this.piece('h-stab', this.root, [0, 0.03, 0.04]);
    const zh = zFront + (zEnd - zFront) * 0.66;
    const stabShape = new THREE.Shape();
    stabShape.moveTo(-0.06 * st, 0.012 * st);
    stabShape.lineTo(0.06 * st, 0.012 * st);
    stabShape.lineTo(0.055 * st, -0.022 * st);
    stabShape.lineTo(-0.055 * st, -0.022 * st);
    stabShape.closePath();
    const stab = new THREE.ExtrudeGeometry(stabShape, { depth: 0.0015 * st, bevelEnabled: false });
    stab.rotateX(Math.PI / 2);
    this.mesh('h-stab', hs, stab, 'carbon', [0, boomY - boomR - 0.002 * st, zh]);
    this.mesh('h-stab', hs, new THREE.CylinderGeometry(boomR * 1.3, boomR * 1.3, 0.016 * st, 14), 'plastic', [0, boomY, zh], [Math.PI / 2, 0, 0]);

    // Tail group at the end of the boom (450 units, scaled by the tail rotor size).
    const tail = new THREE.Group();
    tail.position.set(0, boomY, zEnd);
    tail.scale.setScalar(st);
    this.root.add(tail);
    const hubUp = (m.tailOffset.y - boomY) / st;
    const hubBack = (m.tailOffset.z - zEnd) / st;
    const tc = this.piece('tail-case', tail, [0, 0, 0.03]);
    this.mesh('tail-case', tc, new THREE.BoxGeometry(0.013, hubUp + 0.016, 0.024), 'plastic', [0.002, hubUp / 2, hubBack]);
    this.mesh('tail-case', tc, new THREE.CylinderGeometry(0.0095, 0.0095, 0.02, 16), 'plastic', [0, 0, -0.002], [Math.PI / 2, 0, 0]);
    this.mesh('tail-case', tc, new THREE.CylinderGeometry(0.0062, 0.0062, 0.016, 16), 'aluDark', [0.006, hubUp, hubBack], [0, 0, Math.PI / 2]);

    // Vertical fin, swept, from the lower guard to the top contact point.
    const fn = this.piece('v-fin', tail, [0, 0, 0.05]);
    // The fin's top and bottom tips are the physics hard points at the tail (fin top, boom end).
    const tailPts = m.contacts.filter((k) => k.kind === 'hard' && k.p.z > m.tailOffset.z * 0.9);
    const top = tailPts.reduce((a, k) => (k.p.y > a.p.y ? k : a));
    const low = tailPts.reduce((a, k) => (k.p.y < a.p.y ? k : a));
    const finTopY = (top.p.y - boomY) / st;
    const finLowY = (low.p.y - boomY) / st;
    const finTopZ = (top.p.z - zEnd) / st;
    const finLowZ = (low.p.z - zEnd) / st;
    const fin = new THREE.Shape();
    fin.moveTo(-0.004, finLowY * 0.45);
    fin.lineTo(finLowZ - 0.02, finLowY);
    fin.lineTo(finLowZ, finLowY + 0.004);
    fin.lineTo(hubBack + 0.016, -0.004);
    fin.lineTo(finTopZ, finTopY - 0.004);
    fin.lineTo(finTopZ - 0.018, finTopY);
    fin.lineTo(hubBack - 0.006, hubUp + 0.008);
    fin.lineTo(-0.004, 0.006);
    fin.closePath();
    const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.0015, bevelEnabled: false });
    finGeo.rotateY(-Math.PI / 2);
    this.mesh('v-fin', fn, finGeo, 'carbon', [-0.0035, 0, 0]);
    this.mesh('v-fin', fn, decalPlane('fin'), 'decal', [-0.0055, hubUp * 0.2 + finTopY * 0.35, (finTopZ + hubBack) * 0.45], [0, -Math.PI / 2, 0]);

    // Tail output shaft, hub, grips and blades on the right side, spinning about x.
    const ts = this.piece('tail-shaft', tail, [0.02, 0, 0]);
    this.mesh('tail-shaft', ts, new THREE.CylinderGeometry(0.0016, 0.0016, 0.036, 8), 'steel', [0.012, hubUp, hubBack], [0, 0, Math.PI / 2]);
    const hubG = this.piece('tail-hub', tail, [0.05, 0, 0]);
    this.tailSpin.position.set(0.026, hubUp, hubBack);
    hubG.add(this.tailSpin);
    this.mesh('tail-hub', this.tailSpin, new THREE.BoxGeometry(0.006, 0.014, 0.006), 'aluDark');
    const tR = m.tail.radius / st;
    const tChord = m.tail.chord / st;
    const tBlade = bladeGeometry(tR - 0.012, tChord);
    this.disposables.push(tBlade);
    for (let b = 0; b < m.tail.blades; b++) {
      const holder = new THREE.Group();
      holder.rotation.x = (b / m.tail.blades) * Math.PI * 2;
      this.tailSpin.add(holder);
      const pitch = new THREE.Group();
      holder.add(pitch);
      this.tailBladePitch.push(pitch);
      this.mesh('tail-hub', pitch, new THREE.BoxGeometry(0.006, 0.01, 0.01), 'alu', [0, 0.008, 0]);
      const blg = this.piece('tail-blades', pitch, [0.02, 0.025, 0]);
      // Blade geometry spans +x: turn it to span +y in the tail rotor plane.
      this.mesh('tail-blades', blg, tBlade, 'blade', [0, 0.012, 0], [0, 0, Math.PI / 2]);
      this.tailBladeMeshes.push(blg);
    }
    // Pitch slider on the shaft between case and hub.
    const sl = this.piece('pitch-slider', tail, [0.035, 0, 0]);
    this.slider.position.set(0.016, hubUp, hubBack);
    sl.add(this.slider);
    this.mesh('pitch-slider', this.slider, new THREE.CylinderGeometry(0.0045, 0.0045, 0.005, 14), 'alu', [0, 0, 0], [0, 0, Math.PI / 2]);
    this.mesh('pitch-slider', this.slider, new THREE.BoxGeometry(0.003, 0.02, 0.004), 'plastic');
    // Pitch lever (bellcrank) on the case, driven by the tail rod.
    const pl = this.piece('pitch-lever', tail, [0.02, -0.02, 0]);
    this.pitchLever.position.set(0.006, hubUp - 0.012, hubBack - 0.004);
    pl.add(this.pitchLever);
    this.mesh('pitch-lever', this.pitchLever, new THREE.BoxGeometry(0.003, 0.004, 0.016), 'aluDark', [0, 0, 0.002]);
    this.mesh('pitch-lever', this.pitchLever, new THREE.BoxGeometry(0.012, 0.004, 0.003), 'aluDark', [0.006, 0, 0.009]);
    const leverBall = this.ball('pitch-lever', this.pitchLever, [0.0, -0.002, -0.006], 0.0018);

    // Tail servo clamped on the boom, with its arm and the long rod to the tail.
    const tsv = this.piece('tail-servo', this.root, [0.04, -0.02, 0]);
    const zServo = zFront + (zEnd - zFront) * 0.2;
    const servoCentre = new THREE.Vector3(0.012 * st, boomY - 0.004 * st, zServo);
    this.mesh('tail-servo', tsv, new THREE.BoxGeometry(0.011 * st, 0.022 * st, 0.022 * st), 'servo', [servoCentre.x, servoCentre.y, servoCentre.z]);
    this.mesh('tail-servo', tsv, new THREE.CylinderGeometry(boomR * 1.25, boomR * 1.25, 0.01 * st, 14), 'plastic', [0, boomY, zServo], [Math.PI / 2, 0, 0]);
    this.tailServoArm.position.set(servoCentre.x + 0.007 * st, servoCentre.y + 0.006 * st, zServo);
    tsv.add(this.tailServoArm);
    this.mesh('tail-servo', this.tailServoArm, new THREE.BoxGeometry(0.002 * st, 0.016 * st, 0.003 * st), 'plasticWhite', [0, 0.006 * st, 0]);
    const servoBall = this.ball('tail-servo', this.tailServoArm, [0, 0.012 * st, 0], 0.0018 * st);

    const tr = this.piece('tail-rod', this.root, [0.025, 0, 0]);
    this.link('tail-rod', servoBall, leverBall, 0.0007 * st);
    for (const f of [0.45, 0.72]) {
      const z = zFront + (zEnd - zFront) * f;
      this.mesh('tail-rod', tr, new THREE.CylinderGeometry(boomR * 1.25, boomR * 1.25, 0.006 * st, 14), 'plastic', [0, boomY, z], [Math.PI / 2, 0, 0]);
      this.mesh('tail-rod', tr, new THREE.BoxGeometry(0.004 * st, 0.004 * st, 0.004 * st), 'plastic', [boomR * 1.4 + 0.004 * st, boomY + 0.01 * st, z]);
    }
    this.tailRod.position.set(0, 0, 0);
  }

  /* ------------------------------------------------------------------------------------------------ */
  /* Electronics, canopy, landing gear                                                                  */
  /* ------------------------------------------------------------------------------------------------ */

  private buildElectronics(): void {
    const c = this.core;
    if (this.power === 'nitro') {
      // A small receiver pack instead of the flight LiPo; no ESC.
      const rxp = this.piece('battery', c, [0, -0.03, -0.08]);
      this.mesh('battery', rxp, roundedBox(0.03, 0.014, 0.04, 0.003), 'battery', [0, -0.02, -0.15]);
    }
    this.buildReceiverAndGyro();
    if (this.power === 'nitro') return;
    const bat = this.piece('battery', c, [0, -0.07, -0.06]);
    this.mesh('battery', bat, roundedBox(0.032, 0.023, 0.1, 0.003), 'battery', [0, -0.054, -0.11]);
    this.mesh('battery', bat, new THREE.BoxGeometry(0.033, 0.024, 0.012), 'rubber', [0, -0.054, -0.1]); // velcro strap
    this.tube('battery', bat, [[0.01, -0.05, -0.06], [0.014, -0.044, -0.05], [0.024, -0.04, -0.035], [0.03, -0.044, -0.01]], 0.0016, 'wireRed');
    this.tube('battery', bat, [[0.004, -0.05, -0.06], [0.008, -0.043, -0.05], [0.022, -0.038, -0.035], [0.03, -0.046, -0.01]], 0.0016, 'wireBlack');
    this.tube('battery', bat, [[-0.012, -0.05, -0.062], [-0.015, -0.04, -0.07], [-0.014, -0.046, -0.09]], 0.0009, 'wireYellow'); // balance lead

    const esc = this.piece('esc', c, [0.06, -0.02, 0]);
    this.mesh('esc', esc, roundedBox(0.012, 0.011, 0.046, 0.002), 'esc', [0.034, -0.048, 0.012]);
    this.mesh('esc', esc, new THREE.BoxGeometry(0.0125, 0.003, 0.03), 'aluDark', [0.034, -0.042, 0.012]);
    for (const [i, key] of (['wireBlack', 'wireOrange', 'wireYellow'] as const).entries()) {
      const dy = -0.046 - i * 0.003;
      this.tube('esc', esc, [[0.034, dy, -0.011], [0.03, dy - 0.004, -0.025], [0.016, -0.06, -0.034], [0.008, -0.07, -0.04]], 0.0012, key);
    }

  }

  private buildReceiverAndGyro(): void {
    const c = this.core;
    const rx = this.piece('receiver', c, [-0.06, -0.02, 0]);
    this.mesh('receiver', rx, roundedBox(0.009, 0.014, 0.03, 0.0015), 'rx', [-0.032, -0.046, 0.0]);
    this.tube('receiver', rx, [[-0.034, -0.04, 0.012], [-0.04, -0.03, 0.03], [-0.05, -0.02, 0.06]], 0.0006, 'wireBlack');
    this.tube('receiver', rx, [[-0.034, -0.05, 0.012], [-0.042, -0.062, 0.025], [-0.046, -0.085, 0.03]], 0.0006, 'wireBlack');
    this.mesh('receiver', rx, new THREE.SphereGeometry(0.0012, 8, 6), 'led', [-0.0365, -0.044, -0.008]);

    const gy = this.piece('gyro', c, [0, -0.06, 0.02]);
    this.mesh('gyro', gy, roundedBox(0.024, 0.009, 0.028, 0.002), 'gyro', [0, -0.08, 0.035]);
    this.mesh('gyro', gy, new THREE.BoxGeometry(0.024, 0.002, 0.028), 'rubber', [0, -0.0748, 0.035]);
    this.mesh('gyro', gy, new THREE.SphereGeometry(0.0013, 8, 6), 'led', [0.008, -0.0755, 0.0215]);
    this.mesh('gyro', gy, decalPlane(this.head === 'fbl' ? 'fbl' : 'gyro'), 'decal', [0, -0.0848, 0.035], [Math.PI / 2, 0, 0]);
  }

  private buildAirframe(): void {
    const c = this.core;
    // Canopy: a lathe pod from the nose back past the shaft, open at the top rear for the swashplate.
    const can = this.piece('canopy', c, [0, 0.06, -0.1]);
    this.mesh('canopy', can, canopyGeometry(), 'canopy');
    // Side decals.
    for (const s of [-1, 1]) {
      this.mesh('canopy', can, decalPlane(this.model.rotor.radius > 0.6 ? '700' : this.model.rotor.radius < 0.3 ? '250' : '450'), 'decal', [s * 0.0458, 0.0, -0.085], [0, s * Math.PI / 2, 0]);
    }
    const cm = this.piece('canopy-mounts', c, [0, 0.03, -0.04]);
    for (const s of [-1, 1]) {
      this.mesh('canopy-mounts', cm, new THREE.CylinderGeometry(0.0022, 0.0022, 0.016, 8), 'aluDark', [s * 0.033, 0.012, -0.062], [0, 0, Math.PI / 2]);
      this.mesh('canopy-mounts', cm, new THREE.TorusGeometry(0.0035, 0.0014, 6, 14), 'rubber', [s * 0.0452, 0.012, -0.062], [0, Math.PI / 2, 0]);
    }

    // Skids exactly on the contact points, with upturned ends; struts bowed between frame and skids.
    const m = this.model;
    const skid = m.contacts.filter((k) => k.kind === 'skid' && !k.gear);
    const xs = [...new Set(skid.map((k) => k.p.x))];
    const zMin = Math.min(...skid.map((k) => k.p.z));
    const zMax = Math.max(...skid.map((k) => k.p.z));
    const y0 = skid[0].p.y;
    const r = 0.0042 * this.S.y;
    const sk = this.piece('skids', this.root, [0, -0.05, 0]);
    for (const x of xs) {
      const y = y0 + r;
      const len = zMax - zMin;
      this.tube('skids', sk, [
        [x, y + len * 0.1, zMin - len * 0.18],
        [x, y + len * 0.02, zMin - len * 0.08],
        [x, y, zMin],
        [x, y, (zMin + zMax) / 2],
        [x, y, zMax],
        [x, y + len * 0.015, zMax + len * 0.08],
        [x, y + len * 0.05, zMax + len * 0.13],
      ], r, 'alu', 48);
      for (const z of [zMin - len * 0.18, zMax + len * 0.13]) this.mesh('skids', sk, new THREE.SphereGeometry(r * 1.1, 10, 8), 'plastic', [x, y + (z < zMin ? len * 0.1 : len * 0.05), z]);
    }
    // The skids rest exactly on the surface; ground decals (the pad) use a polygon offset, so the skids need a bigger one.
    for (const m of this.parts.get('skids')!.meshes) {
      const mat = m.material as THREE.Material;
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -6;
      mat.polygonOffsetUnits = -6;
    }
    const struts = this.piece('skid-struts', this.root, [0, -0.025, 0]);
    const yb = this.coreToRoot(0, -0.074, 0).y;
    const half = Math.abs(xs[0]);
    const frameHalf = 0.025 * this.S.x;
    for (const zc of [-0.075 * this.S.z, 0.065 * this.S.z]) {
      this.tube('skid-struts', struts, [
        [-half, y0 + r, zc],
        [-half * 0.98, y0 + r + (yb - y0) * 0.45, zc],
        [-frameHalf * 1.6, yb - 0.002, zc],
        [0, yb - 0.003, zc],
        [frameHalf * 1.6, yb - 0.002, zc],
        [half * 0.98, y0 + r + (yb - y0) * 0.45, zc],
        [half, y0 + r, zc],
      ], 0.0045 * this.S.y, 'plastic', 40);
      for (const x of xs) this.mesh('skid-struts', struts, new THREE.CylinderGeometry(r * 1.6, r * 1.6, 0.008 * this.S.z, 10), 'plastic', [x, y0 + r, zc], [Math.PI / 2, 0, 0]);
    }
  }

  /**
   * Nitro power plant instead of motor and ESC: glow engine with its cooling head and glow plug, muffler, fuel tank,
   * the centrifugal clutch under the main gear, and a throttle servo. The main gear is the same.
   */
  private buildEngine(): void {
    const c = this.core;
    const hubY = this.model.hubOffset.y / this.S.y;
    const shaft = this.piece('main-shaft', c, [0, 0.07, 0]);
    this.mesh('main-shaft', shaft, new THREE.CylinderGeometry(0.0025, 0.0025, hubY + 0.07, 12), 'steel', [0, (hubY - 0.07) / 2, 0]);
    const mg = this.piece('main-gear', c, [0, -0.045, 0]);
    this.mainGear.position.set(0, -0.035, 0);
    mg.add(this.mainGear);
    this.mesh('main-gear', this.mainGear, gearGeometry(72, 0.032, 0.0295, 0.005), 'gear');
    this.mesh('main-gear', this.mainGear, new THREE.CylinderGeometry(0.009, 0.009, 0.009, 20), 'aluDark');
    // Clutch bell and pinion in front of the shaft, the engine below with the cooling fan.
    const cl = this.piece('clutch', c, [0, -0.03, -0.04]);
    this.pinion.position.set(0, -0.035, -0.0385);
    cl.add(this.pinion);
    this.mesh('clutch', this.pinion, gearGeometry(13, 0.0062, 0.005, 0.006), 'brass');
    this.mesh('clutch', this.pinion, new THREE.CylinderGeometry(0.011, 0.011, 0.012, 20), 'steel', [0, -0.011, 0]);
    this.motorBell.position.set(0, -0.056, -0.0385);
    cl.add(this.motorBell);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.mesh('clutch', this.motorBell, new THREE.BoxGeometry(0.012, 0.004, 0.0012), 'plastic', [Math.cos(a) * 0.012, 0, Math.sin(a) * 0.012], [0, -a, 0]);
    }
    const en = this.piece('engine', c, [0, -0.07, -0.06]);
    this.mesh('engine', en, new THREE.CylinderGeometry(0.013, 0.015, 0.024, 20), 'engine', [0, -0.07, -0.0385]); // crankcase
    for (let i = 0; i < 5; i++) this.mesh('engine', en, new THREE.CylinderGeometry(0.017, 0.017, 0.0016, 24), 'engine', [0, -0.084 - i * 0.003, -0.0385]); // head fins
    this.mesh('engine', en, new THREE.CylinderGeometry(0.0022, 0.0022, 0.005, 8), 'brass', [0, -0.099, -0.0385]); // glow plug
    this.mesh('engine', en, new THREE.CylinderGeometry(0.004, 0.004, 0.02, 10), 'engine', [0.016, -0.08, -0.0385], [0, 0, Math.PI / 2]); // carburettor
    const mu = this.piece('muffler', c, [0.05, -0.05, 0]);
    this.tube('muffler', mu, [[-0.012, -0.085, -0.0385], [-0.03, -0.09, -0.03], [-0.034, -0.09, 0.0], [-0.032, -0.085, 0.05]], 0.0075, 'alu', 24);
    const ft = this.piece('fuel-tank', c, [0, -0.04, -0.07]);
    this.mesh('fuel-tank', ft, roundedBox(0.03, 0.026, 0.07, 0.006), 'fuel', [0, -0.052, -0.1]);
    this.tube('fuel-tank', ft, [[0.008, -0.04, -0.07], [0.016, -0.06, -0.055], [0.016, -0.08, -0.042]], 0.0012, 'wireYellow');
    const tsv = this.piece('throttle-servo', c, [0.05, 0, 0]);
    this.mesh('throttle-servo', tsv, new THREE.BoxGeometry(0.012, 0.023, 0.023), 'servo', [0.032, -0.05, -0.035]);
    this.tube('throttle-servo', tsv, [[0.03, -0.04, -0.035], [0.024, -0.06, -0.04], [0.018, -0.08, -0.0385]], 0.0007, 'steel');
    const td = this.piece('tail-drive-gear', c, [0, 0.0, 0.05]);
    td.add(this.tailDriveFront);
    if (this.head === 'flybar') this.mesh('tail-drive-gear', this.tailDriveFront, gearGeometry(28, 0.0105, 0.0095, 0.007), 'plastic');
    else this.mesh('tail-drive-gear', this.tailDriveFront, gearGeometry(40, 0.014, 0.0125, 0.003), 'aluDark', [0, -0.006, 0]);
  }

  /** Training gear: a cross of rods ending in balls, exactly on the physics' gear contact points. */
  private buildTrainingGear(): void {
    const balls = this.model.contacts.filter((k) => k.gear);
    if (!balls.length) return;
    const g = this.piece('training-gear', this.root, [0, -0.04, 0]);
    const y = balls[0].p.y;
    const r = this.model.rotor.radius;
    for (const b of balls) {
      this.rod('training-gear', g, new THREE.Vector3(0, y + r * 0.03, 0), new THREE.Vector3(b.p.x, y + r * 0.03, b.p.z), r * 0.012, 'carbon');
      this.mesh('training-gear', g, new THREE.SphereGeometry(r * 0.1, 14, 10), 'ball', [b.p.x, y + r * 0.1, b.p.z]);
    }
  }

  /* ------------------------------------------------------------------------------------------------ */
  /* Per frame                                                                                          */
  /* ------------------------------------------------------------------------------------------------ */

  update(s: HeliState, dt: number): void {
    const m = this.model;
    this.root.position.set(s.pos.x, s.pos.y, s.pos.z);
    this.root.quaternion.set(s.ori.x, s.ori.y, s.ori.z, s.ori.w);
    // The rotor disc follows the simulated tip-path plane: normal = (b1, 1, a1) in body frame.
    this.tpp.rotation.set(s.a1, 0, -s.b1, 'XZY');
    const omega = this.spinOverride ?? s.rotorOmega;
    const spinDir = m.clockwise ? -1 : 1;
    this.bladeAngle += spinDir * omega * dt;
    this.spin.rotation.y = this.bladeAngle;
    this.spinFlat.rotation.y = this.bladeAngle;
    this.swashSpin.rotation.y = this.bladeAngle;
    this.mainGear.rotation.y = this.bladeAngle;
    this.tailDriveFront.rotation.y = this.bladeAngle;
    const ratio = 72 / 13;
    this.pinion.rotation.y = -this.bladeAngle * ratio;
    this.motorBell.rotation.y = -this.bladeAngle * ratio;
    this.tailAngle += omega * m.tailGearRatio * dt;
    this.tailSpin.rotation.x = this.tailAngle;

    // Blur: above ~60 rad/s the eye sees a disc, not blades.
    const blur = THREE.MathUtils.clamp((omega - 50) / 60, 0, 1);
    this.disc.visible = blur > 0;
    this.discUniforms.opacity.value = blur;
    this.discUniforms.angle.value = this.bladeAngle * 0.02; // a slow strobe of the blades, like on video
    this.stipple.rotation = this.bladeAngle; // the disc shadow flickers as the blades sweep, rather than a frozen pattern
    for (const b of this.bladeMeshes) b.visible = blur < 1;
    this.tailDisc.visible = blur > 0;
    for (const b of this.tailBladeMeshes) b.visible = blur < 1;

    // Swashplate: collective lifts it, cyclic tilts it. Blade pitch per blade: collective plus the cyclic for where the
    // blade is. The upper ring's balls carry it to the pitch arms, so the links stay the same length.
    let cycA = s.servoCycPitch;
    let cycB = s.servoCycRoll;
    if (this.head === 'flybar') {
      // On a flybar head the swashplate follows the sticks; the blades get Bell (swash) + Hiller (flybar).
      const bell = m.controller.flybarBellRatio;
      cycA = (s.servoCycPitch - (1 - bell) * s.fbA) / bell;
      cycB = (s.servoCycRoll - (1 - bell) * s.fbB) / bell;
    }
    const gain = 0.016; // metres of ball travel per radian of blade pitch (pitch arm length)
    this.swashTilt.position.y = this.swashRestY + s.servoCollective * gain;
    const n = new THREE.Vector3(cycA * 0.8, 1, -cycB * 0.8).normalize();
    this.swashTilt.quaternion.setFromUnitVectors(UP, n);
    if (this.washout) this.washout.position.y = -0.026 + s.servoCollective * gain;
    const nb = this.bladePitch.length;
    for (let i = 0; i < nb; i++) {
      const psi = this.bladeAngle + (i / nb) * Math.PI * 2;
      // Blade direction in the body frame (rotation about +y): x = cos, z = -sin.
      const dx = Math.cos(psi);
      const dz = -Math.sin(psi);
      // Max pitch 90° ahead of where the disc should rise (gyroscopic precession).
      const theta = s.servoCollective + s.servoCycPitch * -dx + s.servoCycRoll * dz;
      this.bladePitch[i].rotation.x = -theta;
    }
    if (this.flybarTeeter) {
      // Flybar end at local +z after the spin: its height in the flybar plane (fbA back, fbB right).
      const fx = Math.sin(this.bladeAngle);
      const fz = Math.cos(this.bladeAngle);
      this.flybarTeeter.rotation.x = -(-fz * s.fbA - fx * s.fbB);
    }
    // Tail: pitch slider and blades, lever, servo arm.
    const tp = s.servoTail;
    for (const p of this.tailBladePitch) p.rotation.y = tp;
    this.slider.position.x = 0.016 - tp * 0.012;
    this.pitchLever.rotation.y = tp * 0.7;
    this.tailServoArm.rotation.z = -tp * 0.9;

    this.root.updateMatrixWorld(true);
    // Servo arms follow their swash balls (pushrod length fixed).
    const tmp = new THREE.Vector3();
    for (const sa of this.servoArms) {
      if (this.explodeT > 0.01) {
        sa.arm.rotation.x = 0;
        continue;
      }
      sa.swashBall.getWorldPosition(tmp);
      this.core.worldToLocal(tmp);
      const target = tmp.y - (this.swashRestY - 0.0045 - 0.004);
      const sin = THREE.MathUtils.clamp((target - sa.shaft.y) / sa.length, -0.9, 0.9);
      sa.arm.rotation.x = Math.asin(sin);
    }
    this.root.updateMatrixWorld(true);
    this.updateLinks();
  }

  private updateLinks(): void {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    for (const l of this.links) {
      l.a.getWorldPosition(a).applyMatrix4(inv);
      l.b.getWorldPosition(b).applyMatrix4(inv);
      const d = b.clone().sub(a);
      const len = d.length();
      l.mesh.position.copy(a).addScaledVector(d, 0.5);
      if (len > 1e-6) l.mesh.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
      l.mesh.scale.set(1, Math.max(len, 1e-4), 1);
    }
  }

  /* ------------------------------------------------------------------------------------------------ */
  /* Hangar API                                                                                         */
  /* ------------------------------------------------------------------------------------------------ */

  /** 0 = assembled, 1 = fully exploded. */
  setExplode(t: number): void {
    this.explodeT = t;
    for (const p of this.parts.values()) {
      for (const pc of p.pieces) pc.group.position.copy(pc.base).addScaledVector(pc.explode, t);
    }
  }

  setCanopy(visible: boolean): void {
    for (const pc of this.parts.get('canopy')?.pieces ?? []) pc.group.visible = visible;
  }

  /** Highlight one part (glow) and fade the rest; null restores everything. */
  highlight(id: string | null, hover: string | null = null): void {
    for (const [pid, mats] of this.partMats) {
      const sel = id === pid;
      const fade = id !== null && !sel;
      for (const mm of mats.values()) {
        const m = mm as THREE.MeshStandardMaterial;
        if (m.emissive && !m.userData.baseEmissive) m.userData.baseEmissive = m.emissive.clone();
        if (m.emissive) {
          m.emissive.copy(m.userData.baseEmissive);
          if (sel) m.emissive.setRGB(0.9, 0.55, 0.05);
          else if (hover === pid) m.emissive.setRGB(0.25, 0.18, 0.04);
          m.emissiveIntensity = sel ? 0.55 : hover === pid ? 1 : (m.userData.baseEmissiveIntensity ??= m.emissiveIntensity);
        }
        m.transparent = fade ? true : m.userData.baseTransparent;
        m.opacity = fade ? 0.14 : m.userData.baseOpacity;
        m.depthWrite = !fade;
        m.needsUpdate = true;
      }
    }
  }

  /** Meshes for raycasting, and the world-space centre of a part. */
  pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const p of this.parts.values()) for (const m of p.meshes) if (m.visible) out.push(m);
    return out;
  }

  partCentre(id: string, out = new THREE.Vector3()): THREE.Vector3 {
    const box = new THREE.Box3();
    for (const m of this.parts.get(id)?.meshes ?? []) box.expandByObject(m);
    return box.isEmpty() ? this.root.getWorldPosition(out) : box.getCenter(out);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const mats of this.partMats.values()) for (const m of mats.values()) m.dispose();
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Geometry                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

/** Spur gear lying flat (axis = y). */
function gearGeometry(teeth: number, rOuter: number, rRoot: number, thickness: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const steps = teeth * 4;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const phase = i % 4;
    const r = phase === 1 || phase === 2 ? rOuter : rRoot;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -thickness / 2);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Symmetric aerofoil blade spanning +x from 0 to `span`, leading edge towards +z, rounded tip, slight root flare. */
function bladeGeometry(span: number, chord: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const t = 0.12;
  const n = 14;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const x = 1 - Math.cos((i / n) * Math.PI * 0.5);
    const y = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x);
    pts.push(new THREE.Vector2(x, y));
  }
  // Shape in (chord, thickness); leading edge at chord 0 → mapped to +z later.
  s.moveTo(-(pts[0].x - 0.25) * chord, 0);
  for (const p of pts) s.lineTo(-(p.x - 0.25) * chord, p.y * chord);
  for (let i = pts.length - 1; i >= 0; i--) s.lineTo(-(pts[i].x - 0.25) * chord, -pts[i].y * chord);
  const g = new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: false, steps: 10, curveSegments: 1 });
  // Extruded along +z: turn so the span runs along +x and the leading edge (shape -x) faces +z.
  g.rotateY(Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const f = x / span;
    // Tip: round the trailing corner; root: slightly wider and thicker where it sits in the grip.
    let k = 1;
    if (f > 0.94) k = 1 - (f - 0.94) * 3;
    if (f < 0.06) k = 1 + (0.06 - f) * 2;
    const z = pos.getZ(i);
    pos.setZ(i, z > 0 ? z : z * k);
    pos.setY(i, pos.getY(i) * (f < 0.06 ? 1.4 : 1));
  }
  g.computeVertexNormals();
  return g;
}

function paddleGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.012, -0.002);
  s.lineTo(0.012, -0.002);
  s.quadraticCurveTo(0.017, 0.03, 0.01, 0.04);
  s.lineTo(-0.01, 0.04);
  s.quadraticCurveTo(-0.017, 0.03, -0.012, -0.002);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.0025, bevelEnabled: true, bevelSize: 0.0008, bevelThickness: 0.0008, bevelSegments: 2 });
  g.translate(0, 0, -0.00125);
  // Flat in the rotor plane, extending outwards along +z.
  g.rotateX(Math.PI / 2);
  g.rotateY(Math.PI);
  return g;
}

/** The canopy pod: lathe along z from the nose, squashed sideways, top rear opened for the head mechanics. */
function canopyGeometry(): THREE.BufferGeometry {
  const prof: [number, number][] = [
    [0.0, 0.0], [0.0015, 0.008], [0.006, 0.017], [0.014, 0.026], [0.026, 0.036], [0.045, 0.047], [0.07, 0.056], [0.1, 0.063], [0.13, 0.067], [0.16, 0.067], [0.19, 0.064], [0.215, 0.06], [0.235, 0.056], [0.25, 0.053],
  ];
  const pts = prof.map(([z, r]) => new THREE.Vector2(r, z));
  const lathe = new THREE.LatheGeometry(pts, 48);
  lathe.rotateX(Math.PI / 2); // lathe axis y → +z
  lathe.scale(0.66, 1, 1);
  lathe.translate(0, -0.008, -0.222);
  // Open the top rear (the swashplate, links and anti-rotation guide come through here).
  const g = lathe.toNonIndexed();
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const keepP: number[] = [];
  const keepU: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    let cut = true;
    for (let k = 0; k < 3; k++) {
      const y = pos.getY(i + k);
      const z = pos.getZ(i + k);
      if (!(y > 0.012 + Math.max(0, -0.02 - z) * 2 && z > -0.045)) cut = false;
    }
    if (cut) continue;
    for (let k = 0; k < 3; k++) {
      keepP.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
      keepU.push(uv.getX(i + k), uv.getY(i + k));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(keepP, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(keepU, 2));
  out.computeVertexNormals();
  return out;
}

/** Belt ribbon from z0 to z1 at side offset x, twisting 90° along its length. */
function twistedBelt(z0: number, z1: number, x: number, width: number, thick: number): THREE.BufferGeometry {
  const segs = 40;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const z = z0 + (z1 - z0) * t;
    const a = t * Math.PI * 0.5;
    const ox = Math.cos(a) * x;
    const oy = Math.sin(a) * x;
    const wx = Math.sin(a) * width * 0.5;
    const wy = -Math.cos(a) * width * 0.5;
    pos.push(ox - wx, oy - wy, z, ox + wx, oy + wy, z);
    if (i < segs) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  void thick;
  return g;
}

function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -d / 2);
  return g;
}

/** Small text decal (a plane with a canvas texture assigned through the 'decal' material map at draw time). */
const decalTextures = new Map<string, THREE.Texture>();
function decalPlane(kind: string): THREE.BufferGeometry {
  const size: Record<string, [number, number]> = { '250': [0.07, 0.022], '450': [0.07, 0.022], '700': [0.07, 0.022], fin: [0.03, 0.012], fbl: [0.02, 0.012], gyro: [0.02, 0.012] };
  const [w, h] = size[kind] ?? [0.03, 0.01];
  const g = new THREE.PlaneGeometry(w, h);
  g.userData.decal = kind;
  return g;
}

/* ------------------------------------------------------------------------------------------------ */
/* Materials                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
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

let sharedMats: Record<MatKey, THREE.Material> | null = null;

function makeMaterials(): Record<MatKey, THREE.Material> {
  if (sharedMats) return sharedMats;
  const carbonTex = canvas(64, 64, (g) => {
    // 2x2 twill weave.
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const on = ((x + y) >> 1) % 2 === 0;
      const grad = g.createLinearGradient(x * 8, y * 8, x * 8 + (on ? 8 : 0), y * 8 + (on ? 0 : 8));
      grad.addColorStop(0, on ? '#2a2c30' : '#151619');
      grad.addColorStop(0.5, on ? '#3c3f45' : '#1d1f23');
      grad.addColorStop(1, on ? '#222428' : '#121315');
      g.fillStyle = grad;
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  });
  carbonTex.repeat.set(30, 30);
  const batteryTex = canvas(256, 128, (g) => {
    g.fillStyle = '#1b3f8f';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#ffd200';
    g.fillRect(0, 50, 256, 28);
    g.fillStyle = '#111';
    g.font = 'bold 22px sans-serif';
    g.fillText('LiPo 2200mAh 3S 11.1V', 10, 72);
    g.fillStyle = '#fff';
    g.font = 'bold 26px sans-serif';
    g.fillText('25C', 10, 36);
  });
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const phys = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(o);
  sharedMats = {
    carbon: phys({ color: 0xffffff, map: carbonTex, roughness: 0.38, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
    alu: std({ color: 0xd9dde2, roughness: 0.28, metalness: 1 }),
    aluBlue: std({ color: 0x2f6fe0, roughness: 0.3, metalness: 0.9 }),
    aluDark: std({ color: 0x3a3d44, roughness: 0.35, metalness: 0.9 }),
    steel: std({ color: 0xc8ccd2, roughness: 0.2, metalness: 1 }),
    plastic: std({ color: 0x18191c, roughness: 0.55 }),
    plasticWhite: std({ color: 0xf0f0ea, roughness: 0.5 }),
    gear: std({ color: 0xe9e4d4, roughness: 0.45 }),
    blade: phys({ color: 0x101114, map: carbonTex, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06 }),
    rubber: std({ color: 0x0d0d0e, roughness: 0.95 }),
    canopy: phys({ color: 0xffffff, roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide }),
    battery: std({ map: batteryTex, roughness: 0.55 }),
    esc: std({ color: 0x1a8ed8, roughness: 0.45 }),
    gyro: std({ color: 0xb8bcc4, roughness: 0.3, metalness: 0.85 }),
    rx: std({ color: 0x2a2a2e, roughness: 0.5 }),
    motor: std({ color: 0x2c2e33, roughness: 0.4, metalness: 0.8 }),
    motorBell: std({ color: 0xc89b2e, roughness: 0.3, metalness: 1 }),
    brass: std({ color: 0xd8b56a, roughness: 0.25, metalness: 1 }),
    wireRed: std({ color: 0xc81818, roughness: 0.5 }),
    wireBlack: std({ color: 0x141414, roughness: 0.5 }),
    wireYellow: std({ color: 0xe8c21a, roughness: 0.5 }),
    wireOrange: std({ color: 0xe86a1a, roughness: 0.5 }),
    belt: std({ color: 0x24211d, roughness: 0.8, side: THREE.DoubleSide }),
    tapeRed: std({ color: 0xff2a2a, roughness: 0.4 }),
    tapeYellow: std({ color: 0xffd400, roughness: 0.4 }),
    decal: std({ color: 0xffffff, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }),
    led: std({ color: 0x40ff60, emissive: 0x40ff60, emissiveIntensity: 3 }),
    servo: std({ color: 0x222326, roughness: 0.45 }),
    ball: std({ color: 0xff8a00, roughness: 0.85 }),
    engine: std({ color: 0x9aa0a8, roughness: 0.45, metalness: 0.85 }),
    fuel: phys({ color: 0xf2efe6, roughness: 0.25, transmission: 0.2, thickness: 0.01 }),
  };
  return sharedMats;
}

/**
 * The canopy paint: the model's colour (or the classic default for its size), a dark belly for orientation, tinted
 * windows, and the scheme the pilot picked (stripes, flames, checker), or a factory swoosh when none is set.
 * u runs round the canopy from the belly (0) via the right side (0.25), the top (0.5) and the left (0.75); v runs
 * from the nose (0) to the rear (1).
 */
function canopyMaterial(m: HeliModel): THREE.Material {
  const hex = m.color && /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : m.rotor.radius > 0.6 ? '#1f5fd6' : m.rotor.radius < 0.3 ? '#f2b705' : '#c8161d';
  const mat = makeMaterials().canopy.clone() as THREE.MeshPhysicalMaterial;
  if (typeof document === 'undefined') return mat;
  mat.map = livery(hex, m.scheme);
  return mat;
}

function livery(base: string, scheme: CanopyScheme | undefined): THREE.Texture {
  return canvas(1024, 512, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 1024, 512);
    if (scheme === 'stripes') {
      g.fillStyle = '#ffffff';
      for (const x of [470, 530]) g.fillRect(x, 0, 24, 512);
      g.fillStyle = '#111111';
      g.fillRect(500, 0, 24, 512);
    } else if (scheme === 'checker') {
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 16; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2 === 0) g.fillRect(i * 64, j * 64, 64, 64);
    } else if (scheme === 'flames') {
      for (const [col, w, len] of [['#ffd34d', 26, 330], ['#ff6a00', 14, 220]] as const) {
        g.fillStyle = col;
        for (let k = 0; k < 12; k++) {
          const x0 = 200 + k * 52;
          g.beginPath();
          g.moveTo(x0 - w, 0);
          g.quadraticCurveTo(x0 - w / 3, len * 0.45 + (k % 3) * 20, x0, len + (k % 2) * 40);
          g.quadraticCurveTo(x0 + w / 3, len * 0.45 + ((k + 1) % 3) * 20, x0 + w, 0);
          g.closePath();
          g.fill();
        }
      }
    } else if (scheme !== 'solid') {
      // Factory scheme: a white swoosh with a yellow pinstripe on each side.
      g.fillStyle = '#f5f5f2';
      for (const cx of [256, 768]) {
        g.beginPath();
        g.moveTo(cx - 110, 512);
        g.bezierCurveTo(cx - 90, 330, cx + 60, 250, cx + 120, 40);
        g.lineTo(cx + 150, 60);
        g.bezierCurveTo(cx + 90, 270, cx - 40, 360, cx - 60, 512);
        g.closePath();
        g.fill();
      }
      g.strokeStyle = '#ffcc00';
      g.lineWidth = 8;
      for (const cx of [256, 768]) {
        g.beginPath();
        g.moveTo(cx - 140, 512);
        g.bezierCurveTo(cx - 120, 330, cx + 30, 250, cx + 92, 20);
        g.stroke();
      }
    }
    // Dark belly: the orientation cue every RC pilot paints on.
    g.fillStyle = '#16171a';
    g.fillRect(0, 0, 150, 512);
    g.fillRect(874, 0, 150, 512);
    // Tinted windows at the front top.
    g.fillStyle = '#0c1a26';
    for (const cx of [400, 624]) {
      g.beginPath();
      g.ellipse(cx, 150, 70, 95, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.25)';
    for (const cx of [385, 610]) {
      g.beginPath();
      g.ellipse(cx, 120, 18, 40, 0.3, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Text decals (model number on the canopy, fin lettering, unit labels), one texture per kind. */
function decalTexture(kind: string): THREE.Texture {
  let tex = decalTextures.get(kind);
  if (!tex) {
    tex = canvas(512, 160, (g) => {
        g.clearRect(0, 0, 512, 160);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        if (kind === '250' || kind === '450' || kind === '700') {
          g.font = 'italic 900 120px sans-serif';
          g.fillStyle = '#ffffff';
          g.strokeStyle = '#111';
          g.lineWidth = 10;
          g.strokeText(kind, 256, 84);
          g.fillText(kind, 256, 84);
        } else if (kind === 'fin') {
          g.font = 'bold 84px sans-serif';
          g.fillStyle = '#ffcc00';
          g.fillText('RC HELI', 256, 84);
        } else {
          g.fillStyle = '#1b1c20';
          g.fillRect(40, 20, 432, 120);
          g.font = 'bold 72px sans-serif';
          g.fillStyle = '#ffffff';
          g.fillText(kind === 'fbl' ? 'FBL 3X' : 'GYRO HH', 256, 82);
        }
    });
    decalTextures.set(kind, tex);
  }
  return tex;
}

/** Rotor blur: shading that follows blade area (solidity falls off as 1/r), the tracking-tape ring, a faint strobe. */
function makeDiscMaterial(R: number, chord: number, blades: number, u: { angle: { value: number }; opacity: { value: number } }, tapeOn = true): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { ...u, R: { value: R }, chord: { value: chord }, blades: { value: blades }, tapeOn: { value: tapeOn ? 1 : 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float angle; uniform float opacity; uniform float R; uniform float chord; uniform float blades; uniform float tapeOn;
      varying vec2 vP;
      void main() {
        float r = length(vP) / R;
        if (r > 1.0 || r < 0.1) discard;
        // Fraction of the circle covered by blades at this radius.
        float solidity = blades * chord / (6.2832 * r * R);
        float a = solidity * 2.4 + 0.05;
        float ph = atan(vP.y, vP.x) * blades * 0.5 - angle;
        a *= 0.8 + 0.35 * pow(abs(cos(ph)), 24.0);
        vec3 col = vec3(0.05);
        // Tracking tape ring.
        float tape = tapeOn * smoothstep(0.84, 0.85, r) * (1.0 - smoothstep(0.91, 0.92, r));
        col = mix(col, vec3(1.0, 0.55, 0.1), tape * 0.8);
        a = max(a, tape * 0.22);
        a *= smoothstep(1.0, 0.985, r) * opacity;
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  });
}

/** Shadow of the spinning disc: a stipple whose density equals the blade solidity, so the ground sees ~3-20% shade. */
function makeDiscShadowMaterial(R: number, chord: number, blades: number): THREE.MeshDepthMaterial {
  const size = 512;
  const tex = canvas(size, size, (g) => {
    const img = g.createImageData(size, size);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      let v = 0;
      if (r < 1 && r > 0.08) {
        const solidity = (blades * chord) / (2 * Math.PI * r * R);
        const density = Math.min(0.6, solidity * 2.2 + 0.05);
        v = rnd() < density ? 255 : 0;
      }
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, false);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: tex, alphaTest: 0.5 });
}
