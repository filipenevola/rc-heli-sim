import * as THREE from 'three';
import { GATES, EIGHT_GATES, type GateSpec } from '../game/challenges';

/** Checkpoint rings for the circuit challenge. The next ring to fly through glows yellow; done ones green. */
export class GateMeshes {
  readonly group = new THREE.Group();
  private mats = {
    next: new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffd34d, emissiveIntensity: 0.6 }),
    todo: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    done: new THREE.MeshStandardMaterial({ color: 0x3ddc84, emissive: 0x3ddc84, emissiveIntensity: 0.4 }),
  };

  private sets: { gates: GateSpec[]; rings: THREE.Mesh[] }[] = [];
  /** The beginner's hover box: a translucent drum over the pad, 1-4 m up within 4 m, shown until that challenge is done. */
  readonly hoverBox = new THREE.Group();

  constructor() {
    for (const gates of [GATES, EIGHT_GATES]) this.sets.push({ gates, rings: this.build(gates, gates === EIGHT_GATES ? 0x6ec6ff : 0xffffff) });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 3, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    wall.position.set(0, 2.5, -6);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.6 });
    for (const y of [1, 4]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 64; i++) pts.push(new THREE.Vector3(4 * Math.cos((i / 64) * Math.PI * 2), y, -6 + 4 * Math.sin((i / 64) * Math.PI * 2)));
      this.hoverBox.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
    }
    this.hoverBox.add(wall);
    this.group.add(this.hoverBox);
  }

  private build(gates: GateSpec[], color: number): THREE.Mesh[] {
    const rings: THREE.Mesh[] = [];
    const geo = new THREE.TorusGeometry(2.2, 0.12, 10, 40);
    const todo = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    for (const g of gates) {
      const ring = new THREE.Mesh(geo, todo);
      ring.userData.todo = todo;
      ring.position.set(g.x, g.y, g.z);
      ring.rotation.y = g.order % 2 === 0 ? 0 : Math.PI / 2;
      ring.castShadow = true;
      this.group.add(ring);
      rings.push(ring);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, g.y - 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x888888 }));
      pole.position.set(g.x, (g.y - 2.2) / 2, g.z);
      this.group.add(pole);
    }
    return rings;
  }

  /** Highlight: next ring yellow, passed rings green, for each gate set; the hover box until that challenge is done. */
  update(next: [number, number], done: [boolean, boolean], hoverBoxDone = false): void {
    this.hoverBox.visible = !hoverBoxDone;
    this.sets.forEach((set, k) => {
      set.rings.forEach((r, i) => {
        r.material = done[k] || i < next[k] ? this.mats.done : i === next[k] ? this.mats.next : (r.userData.todo as THREE.Material);
      });
    });
  }
}
