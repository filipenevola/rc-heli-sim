import * as THREE from 'three';

export type CameraMode = 'pilot' | 'chase' | 'front' | 'top' | 'drone';
export const CAMERA_MODES: CameraMode[] = ['pilot', 'chase', 'front', 'top', 'drone'];
export const CAMERA_LABELS: Record<CameraMode, string> = {
  pilot: 'Pilot on the field',
  chase: 'Chase (behind the tail)',
  front: 'In front',
  top: 'Top down',
  drone: 'Camera drone',
};

/**
 * Camera rig with several behaviours:
 *  - pilot: you stand on the field and track the model, with auto-zoom like every RC sim. The realistic one.
 *  - chase: behind the tail, turning with the heading. Orientation is never ambiguous here.
 *  - front: ahead of the nose looking back, i.e. nose-in practice without losing sight.
 *  - top: straight above, north up, to see drift.
 *  - drone: a second aircraft slowly circling the model with a long lens.
 */
export class PilotCamera {
  readonly camera: THREE.PerspectiveCamera;
  /**
   * Hangar orbit: when set, overrides the mode. The camera circles `target` (yaw/pitch in rad, distance in m), used by
   * the parts view. Eases towards these values.
   */
  orbit: { target: THREE.Vector3; yaw: number; pitch: number; distance: number; fov: number } | null = null;
  private orbitNow = { target: new THREE.Vector3(), yaw: 0, pitch: 0, distance: 1 };
  readonly eye = new THREE.Vector3(0, 1.7, 0);
  mode: CameraMode = 'pilot';
  /** Field of view at close range, degrees. */
  baseFov = 42;
  minFov = 7;
  /** Distance beyond which the pilot camera starts zooming. */
  zoomStart = 5;
  autoZoom = true;
  private lookAt = new THREE.Vector3(0, 1, -6);
  private pos = new THREE.Vector3(0, 1.7, 0);
  private droneAngle = 0;
  /** Ground height under a point: the chase, front and drone cameras stay above the terrain. Flat by default. */
  groundAt: (x: number, z: number) => number = () => 0;
  private tmp = new THREE.Vector3();
  private fwd = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.3, 2000);
    this.camera.position.copy(this.eye);
  }

  /** Move where the pilot stands (eye height stays 1.7 m above the ground there). */
  setEye(x: number, z: number, groundY = 0): void {
    this.eye.set(x, groundY + 1.7, z);
    if (this.mode === 'pilot') this.pos.copy(this.eye);
  }

  cycle(): CameraMode {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    return this.mode;
  }

  update(target: THREE.Vector3, heliQuat: THREE.Quaternion, dt: number): void {
    const k = 1 - Math.exp(-dt * 14);
    const kPos = 1 - Math.exp(-dt * 6);
    // Heading-only forward vector (ignore pitch/roll so a flip does not throw the chase camera around).
    this.fwd.set(0, 0, -1).applyQuaternion(heliQuat);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    const up = new THREE.Vector3(0, 1, 0);
    let fov = this.baseFov;

    const near = this.orbit ? 0.02 : 0.3;
    if (this.camera.near !== near) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    if (this.orbit) {
      const o = this.orbit;
      const n = this.orbitNow;
      const ko = 1 - Math.exp(-dt * 7);
      n.target.lerp(o.target, ko);
      n.yaw += (o.yaw - n.yaw) * ko;
      n.pitch += (o.pitch - n.pitch) * ko;
      n.distance += (o.distance - n.distance) * ko;
      this.pos.set(
        n.target.x + Math.sin(n.yaw) * Math.cos(n.pitch) * n.distance,
        n.target.y + Math.sin(n.pitch) * n.distance,
        n.target.z + Math.cos(n.yaw) * Math.cos(n.pitch) * n.distance,
      );
      this.pos.y = Math.max(this.pos.y, 0.05);
      this.lookAt.copy(n.target);
      this.camera.position.copy(this.pos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.lookAt);
      if (Math.abs(o.fov - this.camera.fov) > 0.01) {
        this.camera.fov += (o.fov - this.camera.fov) * ko;
        this.camera.updateProjectionMatrix();
      }
      return;
    }

    switch (this.mode) {
      case 'pilot': {
        this.pos.copy(this.eye);
        this.lookAt.lerp(target, k);
        const d = this.lookAt.distanceTo(this.eye);
        fov = this.autoZoom ? THREE.MathUtils.clamp((this.baseFov * this.zoomStart) / Math.max(d, this.zoomStart), this.minFov, this.baseFov) : this.baseFov;
        break;
      }
      case 'chase': {
        this.tmp.copy(target).addScaledVector(this.fwd, -4).add(new THREE.Vector3(0, 1.4, 0));
        this.tmp.y = Math.max(this.tmp.y, this.groundAt(this.tmp.x, this.tmp.z) + 0.4);
        this.pos.lerp(this.tmp, kPos);
        this.lookAt.lerp(target, k);
        fov = 55;
        break;
      }
      case 'front': {
        this.tmp.copy(target).addScaledVector(this.fwd, 4).add(new THREE.Vector3(0, 1.0, 0));
        this.tmp.y = Math.max(this.tmp.y, this.groundAt(this.tmp.x, this.tmp.z) + 0.4);
        this.pos.lerp(this.tmp, kPos);
        this.lookAt.lerp(target, k);
        fov = 55;
        break;
      }
      case 'top': {
        this.tmp.copy(target).add(new THREE.Vector3(0, 14, 0.001));
        this.pos.lerp(this.tmp, kPos);
        this.lookAt.lerp(target, k);
        up.set(0, 0, -1); // north (away from the pilot) is up on screen
        fov = 50;
        break;
      }
      case 'drone': {
        this.droneAngle += dt * 0.12;
        this.tmp.set(target.x + Math.cos(this.droneAngle) * 9, target.y + 3.5, target.z + Math.sin(this.droneAngle) * 9);
        this.tmp.y = Math.max(this.tmp.y, this.groundAt(this.tmp.x, this.tmp.z) + 1.5);
        this.pos.lerp(this.tmp, kPos);
        this.lookAt.lerp(target, k);
        fov = 32;
        break;
      }
    }

    this.camera.position.copy(this.pos);
    this.camera.up.copy(up);
    this.camera.lookAt(this.lookAt);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Start the orbit from where the camera is now, so entering the hangar glides instead of jumping. */
  beginOrbit(target: THREE.Vector3, yaw: number, pitch: number, distance: number): void {
    const off = this.camera.position.clone().sub(target);
    const d = Math.max(off.length(), 0.01);
    this.orbitNow.target.copy(this.lookAt);
    this.orbitNow.distance = d;
    this.orbitNow.pitch = Math.asin(THREE.MathUtils.clamp(off.y / d, -1, 1));
    this.orbitNow.yaw = Math.atan2(off.x, off.z);
    // Take the short way round.
    while (yaw - this.orbitNow.yaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw - this.orbitNow.yaw < -Math.PI) yaw += Math.PI * 2;
    this.orbit = { target: target.clone(), yaw, pitch, distance, fov: 35 };
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
