/**
 * Billboards on the field for the Quave Holdings portfolio (https://quaveholdings.com/portfolio).
 * Pure data: the world adds colliders from it, the renderer draws the panels, the UI lists the links.
 */
export interface Billboard {
  id: string;
  name: string;
  tagline: string;
  url: string;
  /** Logo under public/ads/, drawn on the panel. */
  logo: string;
  /** Panel colours. */
  bg: string;
  fg: string;
  accent: string;
  /** Panel size (m) and bottom edge height above ground. */
  width: number;
  height: number;
  elevation: number;
  /** Position of the panel centre on the ground plane and heading (rad): 0 faces the pilot (+z), the pilot stands at the origin. */
  x: number;
  z: number;
  rot: number;
}

const big = { width: 16, height: 7, elevation: 3.5 };
const std = { width: 6, height: 3, elevation: 2.2 };

export const BILLBOARDS: Billboard[] = [
  // The flagship, centre back of the field behind the fence.
  { id: 'quave-one', name: 'Any Cloud. One Platform.', tagline: 'Deploy, scale and manage infrastructure like Vercel, on YOUR cloud account or ours.', url: 'https://quave.one', logo: 'quave-one-logo.svg', bg: '#1b1b1b', fg: '#ffffff', accent: '#B3FE71', ...big, x: 0, z: -40, rot: 0 },
  // The holding company itself, right next to it.
  { id: 'quave-holdings', name: 'Quave Holdings', tagline: 'Investing in well-run businesses. quaveholdings.com', url: 'https://quaveholdings.com/portfolio', logo: 'quave-holdings-logo.svg', bg: '#0b0f1a', fg: '#f3e9c9', accent: '#EABF34', width: 9, height: 4, elevation: 2.4, x: -16, z: -38, rot: 0.15 },
  { id: 'quave-services', name: 'Quave', tagline: 'We transform ideas into digital products, then keep them running at peak performance.', url: 'https://quave.dev', logo: 'quave-logo.svg', bg: '#ffffff', fg: '#1f2330', accent: '#CE5993', width: 9, height: 4, elevation: 2.4, x: 16, z: -38, rot: -0.15 },
  // Along the fence, left and right.
  { id: 'quave-run', name: 'Quave Run', tagline: 'AI that works inside your business, done for you. You never touch a prompt.', url: 'https://quave.run', logo: 'quave-run-icon.svg', bg: '#fff7f2', fg: '#2b1a12', accent: '#d4521c', ...std, x: -30, z: -34, rot: 0.35 },
  { id: 'quave-magistral', name: 'Quave Magistral', tagline: 'Conferência de receita para farmácias de manipulação.', url: 'https://quave.run/farmacias', logo: 'quave-run-icon.svg', bg: '#1f2937', fg: '#f9fafb', accent: '#d4521c', ...std, x: -42, z: -28, rot: 0.6 },
  { id: 'quave-pager', name: 'Quave Pager', tagline: 'The pager for urgent workflows. Your phone and Mac ring until you act.', url: 'https://pager.quave.ai', logo: 'pager-icon.png', bg: '#111318', fg: '#ffffff', accent: '#ff3b30', ...std, x: 30, z: -34, rot: -0.35 },
  { id: 'erva-token', name: 'Erva Token', tagline: 'ervatoken.com', url: 'https://ervatoken.com', logo: 'erva-logo.png', bg: '#0b3d2e', fg: '#e8f5ee', accent: '#8ed9a8', ...std, x: 42, z: -28, rot: -0.6 },
  // By the pond and the farm, seen when you fly the circuit.
  { id: 'alone', name: 'AloneDev', tagline: 'A comunidade que une founders de sucesso.', url: 'https://alone.quave.dev', logo: 'alone-wolf.png', bg: '#101014', fg: '#ffffff', accent: '#c9a84c', ...std, x: 56, z: -8, rot: -1.2 },
  { id: 'investpass', name: 'investPass', tagline: 'Saúde financeira para colaboradores. Resultado para empresas.', url: 'https://invest-pass.com', logo: 'investpass-favicon.svg', bg: '#ffffff', fg: '#0f172a', accent: '#10B981', ...std, x: -44, z: 4, rot: 1.3 },
  { id: 'cerradox', name: 'cerradoX', tagline: 'AI-native trading for high-value crops.', url: 'https://cerradox.com', logo: 'cerradox-icon.png', bg: '#14281d', fg: '#f1f7f3', accent: '#9be08a', ...std, x: 0, z: 56, rot: Math.PI },
];

/** Panel corners on the ground plane (for a conservative axis-aligned collider). */
export function billboardFootprint(b: Billboard): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const hw = b.width / 2;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  // Panel spans along its local x axis; rotate by heading.
  const dx = Math.abs(hw * c) + 0.2;
  const dz = Math.abs(hw * s) + 0.2;
  return { minX: b.x - dx, maxX: b.x + dx, minZ: b.z - dz, maxZ: b.z + dz };
}
