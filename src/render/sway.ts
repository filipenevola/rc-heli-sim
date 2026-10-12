import * as THREE from 'three';

/** One tree for the sway: where it stands (base on the ground) and its scale. */
export interface SwayTree { x: number; z: number; scale: number; base: number }
/** An instanced layer of crowns: the mesh and the height of that layer's centre above the base, per unit scale. */
export interface SwayLayer { mesh: THREE.InstancedMesh; cy: number; /** Which tree each instance belongs to. */ index: number[] }

/** Wind sampler: local wind at a point (world frame), m/s. */
export type WindSampler = (x: number, y: number, z: number) => { x: number; z: number };

/**
 * Trees lean downwind and flutter with the gusts: the cue a real pilot reads before the windsock. Every crown layer
 * pivots about the base of its tree, so the lean grows with height like a real trunk bending. Cheap: a few
 * dozen matrices per frame.
 */
export function makeSway(trees: SwayTree[], layers: SwayLayer[]): (sample: WindSampler, time: number) => void {
  const m = new THREE.Matrix4();
  const rot = new THREE.Matrix4();
  const sc = new THREE.Matrix4();
  const lift = new THREE.Matrix4();
  const axis = new THREE.Vector3();
  const phase = trees.map((_, i) => i * 1.37);
  return (sample, time) => {
    for (const layer of layers) {
      for (let k = 0; k < layer.index.length; k++) {
        const t = trees[layer.index[k]];
        const w = sample(t.x, t.base + 6 * t.scale, t.z);
        const speed = Math.hypot(w.x, w.z);
        // Lean: ~1.4° per m/s, capped near 12°, with a slow surge and a fast flutter that grow with the wind.
        const surge = 1 + 0.3 * Math.sin(time * 1.7 + phase[layer.index[k]]);
        const flutter = 0.004 * speed * Math.sin(time * 7.3 + phase[layer.index[k]] * 2.1);
        const angle = Math.min(0.21, 0.025 * speed) * surge + flutter;
        if (speed > 1e-3) axis.set(w.z / speed, 0, -w.x / speed);
        else axis.set(1, 0, 0);
        rot.makeRotationAxis(axis, angle);
        sc.makeScale(t.scale, t.scale, t.scale);
        lift.makeTranslation(0, layer.cy, 0);
        m.makeTranslation(t.x, t.base, t.z).multiply(rot).multiply(sc).multiply(lift);
        layer.mesh.setMatrixAt(k, m);
      }
      layer.mesh.instanceMatrix.needsUpdate = true;
    }
  };
}
