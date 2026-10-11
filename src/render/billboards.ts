import * as THREE from 'three';
import { BILLBOARDS, type Billboard } from '../sim/ads';

/**
 * Roadside-style billboards: two posts and a panel whose face is a canvas texture (logo, name, tagline,
 * URL). Click/tap a panel to open the site. Logos load asynchronously and repaint the texture.
 */
export function createBillboards(): { group: THREE.Group; panels: THREE.Mesh[] } {
  const group = new THREE.Group();
  const panels: THREE.Mesh[] = [];
  const post = new THREE.MeshStandardMaterial({ color: 0x5a5e66, roughness: 0.7, metalness: 0.5 });
  const back = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.9 });
  const base = import.meta.env.BASE_URL;

  for (const b of BILLBOARDS) {
    const g = new THREE.Group();
    const tex = paint(b, null);
    const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(b.width, b.height, 0.12), [back, back, back, back, front, back]);
    panel.position.y = b.elevation + b.height / 2;
    panel.castShadow = panel.receiveShadow = true;
    panel.userData.billboard = b;
    g.add(panel);
    panels.push(panel);
    // Frame.
    const frame = new THREE.Mesh(new THREE.BoxGeometry(b.width + 0.2, b.height + 0.2, 0.08), back);
    frame.position.set(0, panel.position.y, -0.08);
    frame.castShadow = true;
    g.add(frame);
    for (const px of [-b.width * 0.35, b.width * 0.35]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, b.elevation + 0.3, 10), post);
      p.position.set(px, (b.elevation + 0.3) / 2, -0.1);
      p.castShadow = true;
      g.add(p);
    }
    g.position.set(b.x, 0, b.z);
    g.rotation.y = b.rot;
    group.add(g);

    // Load the logo and repaint.
    const img = new Image();
    img.onload = () => {
      const t = paint(b, img);
      front.map = t;
      front.emissiveMap = t;
      front.needsUpdate = true;
      tex.dispose();
    };
    img.src = `${base}ads/${b.logo}`;
  }
  return { group, panels };
}

function paint(b: Billboard, logo: HTMLImageElement | null): THREE.CanvasTexture {
  const W = 1024;
  const H = Math.round((W * b.height) / b.width);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = b.bg;
  g.fillRect(0, 0, W, H);
  // Accent stripe along the bottom.
  g.fillStyle = b.accent;
  g.fillRect(0, H - Math.round(H * 0.05), W, Math.round(H * 0.05));
  const pad = Math.round(H * 0.1);
  const logoBox = Math.round(H * 0.6);
  let textX = pad;
  if (logo) {
    const lw = logo.naturalWidth || logo.width || 300;
    const lh = logo.naturalHeight || logo.height || 150;
    const aspect = lw / lh;
    // Wide wordmarks get the full width across the top; square icons sit on the left.
    if (aspect > 2.5) {
      // Keep the wordmark to the top ~35% so the product name below it stays big.
      const w = Math.min(W - 2 * pad, H * 0.35 * aspect);
      const h = w / aspect;
      g.drawImage(logo, pad, pad, w, h);
      drawText(g, b, pad, pad + h + pad * 0.6, W - 2 * pad, H - (pad + h + pad * 0.6) - H * 0.07, true);
      return finish(c);
    }
    const h = logoBox;
    const w = h * aspect;
    g.drawImage(logo, pad, (H - H * 0.05) / 2 - h / 2, w, h);
    textX = pad + w + pad;
  }
  drawText(g, b, textX, pad, W - textX - pad, H - 2 * pad - H * 0.05, false);
  return finish(c);
}

function drawText(g: CanvasRenderingContext2D, b: Billboard, x: number, y: number, w: number, h: number, compact: boolean): void {
  const nameSize = compact ? Math.round(h * 0.45) : Math.round(h * 0.3);
  g.fillStyle = b.fg;
  g.textBaseline = 'top';
  g.font = `bold ${nameSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  g.fillText(b.name, x, y);
  const tagSize = Math.round(nameSize * 0.42);
  g.font = `${tagSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  const lines = wrap(g, b.tagline, w);
  let ty = y + nameSize * 1.15;
  for (const line of lines.slice(0, compact ? 1 : 3)) {
    g.fillText(line, x, ty);
    ty += tagSize * 1.25;
  }
  g.fillStyle = b.accent;
  g.font = `bold ${Math.round(tagSize * 0.95)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  g.fillText(b.url.replace(/^https?:\/\//, ''), x, y + h - tagSize * 1.1);
}

function wrap(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const wd of words) {
    const t = cur ? `${cur} ${wd}` : wd;
    if (g.measureText(t).width > width && cur) {
      lines.push(cur);
      cur = wd;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function finish(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
