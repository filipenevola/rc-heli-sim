import * as THREE from 'three';

/**
 * Pilot's-eye camera: you stand on the field and track the model, exactly like at the flying site.
 * The field of view narrows with distance (auto-zoom) so a model 40 m away is still readable,
 * which is what every RC sim does and what makes orientation training transfer to the real thing.
 */
export class PilotCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly eye = new THREE.Vector3(0, 1.7, 0);
  private lookAt = new THREE.Vector3(0, 1, -6);
  /** Field of view at close range, degrees. */
  baseFov = 42;
  minFov = 7;
  /** Distance beyond which the camera starts zooming. */
  zoomStart = 5;
  autoZoom = true;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.05, 2000);
    this.camera.position.copy(this.eye);
  }

  update(target: THREE.Vector3, dt: number): void {
    // Smooth the aim a little: a real head does not twitch at 1 kHz.
    const k = 1 - Math.exp(-dt * 14);
    this.lookAt.lerp(target, k);
    this.camera.position.copy(this.eye);
    this.camera.lookAt(this.lookAt);
    const d = this.lookAt.distanceTo(this.eye);
    const fov = this.autoZoom ? THREE.MathUtils.clamp((this.baseFov * this.zoomStart) / Math.max(d, this.zoomStart), this.minFov, this.baseFov) : this.baseFov;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
