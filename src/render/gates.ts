import * as THREE from 'three';
import { GATES } from '../game/challenges';

/** Checkpoint rings for the circuit challenge. The next ring to fly through glows yellow; done ones green. */
export class GateMeshes {
  readonly group = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private mats = {
    next: new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffd34d, emissiveIntensity: 0.6 }),
    todo: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    done: new THREE.MeshStandardMaterial({ color: 0x3ddc84, emissive: 0x3ddc84, emissiveIntensity: 0.4 }),
  };

  constructor() {
    const geo = new THREE.TorusGeometry(2.2, 0.12, 10, 40);
    for (const g of GATES) {
      const ring = new THREE.Mesh(geo, this.mats.todo);
      ring.position.set(g.x, g.y, g.z);
      // Face the direction of travel around the circuit: rings 1/3 face along z, 2/4 along x.
      ring.rotation.y = g.order % 2 === 0 ? 0 : Math.PI / 2;
      ring.castShadow = true;
      this.group.add(ring);
      this.rings.push(ring);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, g.y - 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x888888 }));
      pole.position.set(g.x, (g.y - 2.2) / 2, g.z);
      this.group.add(pole);
    }
  }

  update(nextGate: number, circuitDone: boolean): void {
    this.rings.forEach((r, i) => {
      r.material = circuitDone || i < nextGate ? this.mats.done : i === nextGate ? this.mats.next : this.mats.todo;
    });
  }
}
