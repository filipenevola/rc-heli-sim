import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeSway } from './sway';

describe('tree sway', () => {
  it('leans the crown downwind, pivoting about the tree base, and stands straight in calm air', () => {
    const mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 2, 6), new THREE.MeshBasicMaterial(), 1);
    const sway = makeSway([{ x: 10, z: -5, scale: 1, base: 2 }], [{ mesh, cy: 5, index: [0] }]);
    const m = new THREE.Matrix4();
    const up = new THREE.Vector3();
    const pos = new THREE.Vector3();
    sway(() => ({ x: 0, z: 0 }), 0);
    mesh.getMatrixAt(0, m);
    pos.setFromMatrixPosition(m);
    expect(pos.x).toBeCloseTo(10);
    expect(pos.y).toBeCloseTo(7); // base 2 + layer centre 5
    sway(() => ({ x: 8, z: 0 }), 0); // wind blowing toward +x
    mesh.getMatrixAt(0, m);
    up.set(0, 1, 0).transformDirection(m);
    expect(up.x).toBeGreaterThan(0.1); // top leans toward +x
    pos.setFromMatrixPosition(m);
    expect(pos.x).toBeGreaterThan(10.3); // the layer centre moved downwind because it pivots about the base
    expect(pos.y).toBeLessThan(7);
    expect(pos.y).toBeGreaterThan(6.5);
  });
});
