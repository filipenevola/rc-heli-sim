import { describe, expect, it } from 'vitest';
import { qrMatrix, qrSvg } from './qr';

describe('QR encoder', () => {
  it('picks the smallest version and lays out the finder patterns', () => {
    const m = qrMatrix('https://heli.filipenevola.com/radio.html?c=ABCD'); // 47 bytes: version 3-L (53 bytes)
    expect(m.length).toBe(29);
    for (const [r0, c0] of [[0, 0], [0, 22], [22, 0]]) {
      for (let i = 0; i < 7; i++) {
        expect(m[r0][c0 + i]).toBe(true);
        expect(m[r0 + 6][c0 + i]).toBe(true);
      }
      expect(m[r0 + 3][c0 + 3]).toBe(true);
      expect(m[r0 + 1][c0 + 1]).toBe(false);
    }
    // Timing patterns alternate between the finders.
    for (let i = 8; i < 21; i++) { expect(m[6][i]).toBe(i % 2 === 0); expect(m[i][6]).toBe(i % 2 === 0); }
    // Alignment pattern centred at (22, 22) for version 3.
    expect(m[22][22]).toBe(true);
    expect(m[21][22]).toBe(false);
    expect(m[20][22]).toBe(true);
    expect(m[21][8]).toBe(true); // dark module
  });

  it('is deterministic, grows with the text and refuses what does not fit', () => {
    expect(qrMatrix('hello')).toEqual(qrMatrix('hello'));
    expect(qrMatrix('hello').length).toBe(21);
    expect(qrMatrix('x'.repeat(200)).length).toBe(53); // version 9
    expect(() => qrMatrix('x'.repeat(240))).toThrow();
    expect(qrMatrix('hello')).not.toEqual(qrMatrix('hellp'));
  });

  it('renders an svg with a quiet zone', () => {
    const svg = qrSvg('ABCD', 100);
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain('width="100"');
  });
});
