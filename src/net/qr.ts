/**
 * A small QR code encoder (byte mode, error-correction level L, versions 1–9, ISO/IEC 18004) for the phone-radio
 * pairing link. No dependency: about 150 lines of the standard, with proper Reed–Solomon and mask selection.
 */

// Per version (1..9), level L: total codewords, EC codewords per block, number of blocks, alignment centres.
const VERSIONS: { total: number; ec: number; blocks: number; align: number[] }[] = [
  { total: 26, ec: 7, blocks: 1, align: [] },
  { total: 44, ec: 10, blocks: 1, align: [6, 18] },
  { total: 70, ec: 15, blocks: 1, align: [6, 22] },
  { total: 100, ec: 20, blocks: 1, align: [6, 26] },
  { total: 134, ec: 26, blocks: 1, align: [6, 30] },
  { total: 172, ec: 18, blocks: 2, align: [6, 34] },
  { total: 196, ec: 20, blocks: 2, align: [6, 22, 38] },
  { total: 242, ec: 24, blocks: 2, align: [6, 24, 42] },
  { total: 292, ec: 30, blocks: 2, align: [6, 26, 46] },
];

// GF(256) with the QR primitive polynomial 0x11d.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsEncode(data: number[], ecLen: number): number[] {
  // Generator polynomial (x - α^0)(x - α^1)...(x - α^(ecLen-1)).
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= mul(gen[j], EXP[i]);
    }
    gen = next;
  }
  const rem = new Array<number>(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ rem[0];
    rem.shift();
    rem.push(0);
    if (factor !== 0) for (let j = 0; j < ecLen; j++) rem[j] ^= mul(gen[j + 1], factor);
  }
  return rem;
}

/** Encode text (UTF-8) into a module matrix: true = dark. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  // Pick the smallest version whose data capacity fits: 4 bits mode + 8 bits count + data + 4 bits terminator.
  let v = -1;
  for (let i = 0; i < VERSIONS.length; i++) {
    const dataCw = VERSIONS[i].total - VERSIONS[i].ec * VERSIONS[i].blocks;
    if (dataCw * 8 >= 12 + bytes.length * 8) { v = i; break; }
  }
  if (v < 0) throw new Error('QR: text too long');
  const spec = VERSIONS[v];
  const version = v + 1;
  const size = 17 + version * 4;
  const dataCw = spec.total - spec.ec * spec.blocks;

  // Bit stream: mode 0100, count (8 bits), data, terminator, pad to bytes, pad codewords 0xEC/0x11.
  const bits: number[] = [];
  const push = (val: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, dataCw * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let p = 0; data.length < dataCw; p++) data.push(p % 2 === 0 ? 0xec : 0x11);

  // Blocks, EC, interleave.
  const per = dataCw / spec.blocks;
  const blocks = Array.from({ length: spec.blocks }, (_, i) => data.slice(i * per, (i + 1) * per));
  const ecs = blocks.map((b) => rsEncode(b, spec.ec));
  const stream: number[] = [];
  for (let i = 0; i < per; i++) for (const b of blocks) stream.push(b[i]);
  for (let i = 0; i < spec.ec; i++) for (const e of ecs) stream.push(e[i]);

  // Matrix with function patterns; `reserved` marks modules that carry no data.
  const m: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (r: number, c: number, dark: boolean) => { m[r][c] = dark; reserved[r][c] = true; };
  const finder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r;
      const cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const edge = r === -1 || r === 7 || c === -1 || c === 7;
      const ring = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      set(rr, cc, !edge && (ring || core));
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);
  for (const r of spec.align) for (const c of spec.align) {
    if (reserved[r][c]) continue; // overlaps a finder
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  set(size - 8, 8, true); // dark module
  // Reserve format info areas (filled after masking) and version info (v >= 7).
  for (let i = 0; i < 9; i++) { reserved[8][i] = true; reserved[i][8] = true; }
  for (let i = 0; i < 8; i++) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }
  if (version >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { reserved[i][size - 11 + j] = true; reserved[size - 11 + j][i] = true; }

  // Place data bits in the zigzag, skipping column 6.
  const all: number[] = [];
  for (const cw of stream) for (let i = 7; i >= 0; i--) all.push((cw >> i) & 1);
  let idx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < size; k++) {
      const upward = ((right + 1) & 2) === 0;
      const r = upward ? size - 1 - k : k;
      for (const c of [right, right - 1]) {
        if (reserved[r][c]) continue;
        m[r][c] = idx < all.length ? all[idx++] === 1 : false;
      }
    }
  }

  // Masks: choose the one with the lowest penalty.
  const maskFn = [
    (r: number, c: number) => (r + c) % 2 === 0,
    (r: number) => r % 2 === 0,
    (_r: number, c: number) => c % 3 === 0,
    (r: number, c: number) => (r + c) % 3 === 0,
    (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];
  const applyMask = (k: number): boolean[][] => m.map((row, r) => row.map((d, c) => (reserved[r][c] ? d : d !== maskFn[k](r, c))));
  const writeFormat = (grid: boolean[][], k: number) => {
    // Level L = 01, then 3 mask bits; BCH(15,5) with generator 0x537, XOR 0x5412.
    let f = (0b01 << 3) | k;
    let rem = f << 10;
    for (let i = 14; i >= 10; i--) if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
    f = ((f << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((f >> i) & 1) === 1;
    for (let i = 0; i < 6; i++) grid[8][i] = bit(14 - i);
    grid[8][7] = bit(8); grid[8][8] = bit(7); grid[7][8] = bit(6);
    for (let i = 0; i < 6; i++) grid[5 - i][8] = bit(5 - i);
    for (let i = 0; i < 7; i++) grid[size - 1 - i][8] = bit(14 - i);
    for (let i = 0; i < 8; i++) grid[8][size - 8 + i] = bit(7 - i);
    if (version >= 7) {
      let vi = version << 12;
      let r2 = vi;
      for (let i = 17; i >= 12; i--) if (r2 & (1 << i)) r2 ^= 0x1f25 << (i - 12);
      vi |= r2;
      for (let i = 0; i < 18; i++) {
        const d = ((vi >> i) & 1) === 1;
        grid[Math.floor(i / 3)][size - 11 + (i % 3)] = d;
        grid[size - 11 + (i % 3)][Math.floor(i / 3)] = d;
      }
    }
  };
  const penalty = (g: boolean[][]): number => {
    let p = 0;
    const runs = (line: boolean[]) => {
      let run = 1;
      for (let i = 1; i <= line.length; i++) {
        if (i < line.length && line[i] === line[i - 1]) run++;
        else { if (run >= 5) p += 3 + (run - 5); run = 1; }
      }
    };
    for (let i = 0; i < size; i++) { runs(g[i]); runs(g.map((row) => row[i])); }
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const d = g[r][c];
      if (g[r][c + 1] === d && g[r + 1][c] === d && g[r + 1][c + 1] === d) p += 3;
    }
    const pat = [true, false, true, true, true, false, true];
    const finderLike = (line: boolean[], i: number) => {
      for (let k = 0; k < 7; k++) if (line[i + k] !== pat[k]) return false;
      const before = i >= 4 && line.slice(i - 4, i).every((x) => !x);
      const after = i + 11 <= line.length && line.slice(i + 7, i + 11).every((x) => !x);
      return before || after;
    };
    for (let i = 0; i < size; i++) {
      const row = g[i];
      const col = g.map((r) => r[i]);
      for (let j = 0; j <= size - 7; j++) { if (finderLike(row, j)) p += 40; if (finderLike(col, j)) p += 40; }
    }
    let dark = 0;
    for (const row of g) for (const d of row) if (d) dark++;
    p += 10 * Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5);
    return p;
  };
  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let k = 0; k < 8; k++) {
    const g = applyMask(k);
    writeFormat(g, k);
    const s = penalty(g);
    if (s < bestScore) { bestScore = s; best = g; }
  }
  return best!;
}

/** SVG markup for the code with a 4-module quiet zone; scales to any CSS size. */
export function qrSvg(text: string, px = 160): string {
  const m = qrMatrix(text);
  const n = m.length + 8;
  let d = '';
  for (let r = 0; r < m.length; r++) for (let c = 0; c < m.length; c++) if (m[r][c]) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
