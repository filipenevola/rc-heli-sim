import * as THREE from 'three';

/**
 * Cumulus field made of soft billboard puffs. Clouds give the sky structure, so when the camera
 * zooms into blue you still see which way the model is drifting. Cheap: a few hundred sprites with
 * one shared texture, no per-frame work beyond the slow drift.
 */
export function createClouds(): THREE.Group {
  const group = new THREE.Group();
  const tex = makePuffTexture();
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.95, fog: false });
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const clouds = 42;
  for (let c = 0; c < clouds; c++) {
    const ang = rnd() * Math.PI * 2;
    const dist = 80 + rnd() * 420;
    const cx = Math.cos(ang) * dist;
    const cz = Math.sin(ang) * dist;
    const cy = 90 + rnd() * 110;
    const size = 25 + rnd() * 45;
    const puffs = 5 + Math.floor(rnd() * 6);
    for (let p = 0; p < puffs; p++) {
      const s = new THREE.Sprite(mat);
      const px = cx + (rnd() - 0.5) * size * 1.6;
      const pz = cz + (rnd() - 0.5) * size * 0.9;
      const py = cy + (rnd() - 0.3) * size * 0.35;
      s.position.set(px, py, pz);
      const ps = size * (0.5 + rnd() * 0.6);
      s.scale.set(ps, ps * 0.62, 1);
      group.add(s);
    }
  }
  // A few high thin ones straight overhead so looking up is never featureless.
  for (let i = 0; i < 40; i++) {
    const s = new THREE.Sprite(mat);
    s.position.set((rnd() - 0.5) * 500, 220 + rnd() * 60, (rnd() - 0.5) * 500);
    const ps = 40 + rnd() * 50;
    s.scale.set(ps, ps * 0.35, 1);
    (s.material as THREE.SpriteMaterial).opacity = 0.95;
    group.add(s);
  }
  return group;
}

/** Slow drift with the wind so clouds feel alive. */
export function driftClouds(group: THREE.Group, dt: number, windX: number, windZ: number): void {
  group.position.x += (windX * 0.3 + 0.4) * dt;
  group.position.z += windZ * 0.3 * dt;
  // Wrap so the field never drifts away over a long session.
  if (Math.abs(group.position.x) > 300) group.position.x = -Math.sign(group.position.x) * 300;
  if (Math.abs(group.position.z) > 300) group.position.z = -Math.sign(group.position.z) * 300;
}

function makePuffTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 60, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.45, 'rgba(250,252,255,0.75)');
  grad.addColorStop(0.8, 'rgba(235,240,250,0.25)');
  grad.addColorStop(1, 'rgba(230,236,248,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
