import { describe, expect, it } from 'vitest';
import {
  adaptiveThreshold,
  bandOverlap,
  countDiff,
  countInk,
  denoise,
  dilate,
  findBands,
  integralImage,
  maxComponentHeight,
  orMask,
  padBand,
  rowProfile,
  subtractMask,
  toGray,
  unionBands,
} from './vision';

const W = 60;
const H = 40;

/** Paper with a left-to-right lighting gradient (shadow on the left). */
function paper(w = W, h = H): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = 120 + Math.round((100 * x) / (w - 1));
  return g;
}

function stroke(g: Uint8Array, w: number, y: number, x0: number, x1: number, v = 30) {
  for (let x = x0; x <= x1; x++) g[y * w + x] = v;
}

describe('toGray', () => {
  it('maps white, black and pure green to luma', () => {
    const rgba = [255, 255, 255, 255, 0, 0, 0, 255, 0, 255, 0, 255];
    const g = toGray(rgba, 3, 1);
    expect(g[0]).toBe(255);
    expect(g[1]).toBe(0);
    expect(g[2]).toBe(149);
  });
});

describe('integralImage', () => {
  it('sums the whole image in the last cell', () => {
    const g = [1, 2, 3, 4, 5, 6];
    const ii = integralImage(g, 3, 2);
    expect(ii[ii.length - 1]).toBe(21);
    expect(ii[1 * 4 + 3]).toBe(6); // first row sum
  });
});

describe('adaptiveThreshold', () => {
  it('finds no ink on a smooth lighting gradient', () => {
    const m = adaptiveThreshold(paper(), W, H, { radius: 5, offset: 15 });
    expect(countInk(m)).toBe(0);
  });

  it('finds dark strokes in both the bright and the shadowed part', () => {
    const g = paper();
    stroke(g, W, 10, 5, 15, 60); // in the shadow (bg ~130)
    stroke(g, W, 20, 40, 55, 100); // in the bright part (bg ~200)
    const m = adaptiveThreshold(g, W, H, { radius: 5, offset: 15 });
    const p = rowProfile(m, W, H);
    expect(p[10]).toBe(11);
    expect(p[20]).toBe(16);
    expect(countInk(m)).toBe(27);
  });

  it('ignores a soft shadow edge', () => {
    const g = new Uint8Array(W * H).fill(210);
    // A blurred shadow: brightness falls 4 levels per row.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = Math.max(80, 210 - Math.max(0, y - 15) * 4);
    const m = adaptiveThreshold(g, W, H, { radius: 5, offset: 15 });
    expect(countInk(m)).toBe(0);
  });
});

describe('denoise', () => {
  it('drops isolated pixels and keeps connected ones', () => {
    const m = new Uint8Array(W * H);
    m[5 * W + 5] = 1; // isolated
    m[10 * W + 10] = 1;
    m[10 * W + 11] = 1; // pair
    const d = denoise(m, W, H);
    expect(d[5 * W + 5]).toBe(0);
    expect(d[10 * W + 10]).toBe(1);
    expect(d[10 * W + 11]).toBe(1);
  });
});

describe('dilate', () => {
  it('grows a pixel into a (2r+1) square, clipped at edges', () => {
    const m = new Uint8Array(W * H);
    m[10 * W + 10] = 1;
    m[0] = 1;
    const d = dilate(m, W, H, 1);
    expect(countInk(d)).toBe(9 + 4);
    expect(d[11 * W + 11]).toBe(1);
    expect(d[12 * W + 12]).toBe(0);
  });

  it('absorbs a 1 px shift when subtracting', () => {
    const a = new Uint8Array(W * H);
    const b = new Uint8Array(W * H);
    for (let x = 10; x < 30; x++) {
      a[10 * W + x] = 1;
      b[11 * W + x + 1] = 1;
    }
    expect(countDiff(a, b)).toBe(40);
    expect(countInk(subtractMask(b, dilate(a, W, H, 1)))).toBe(0);
  });
});

describe('findBands', () => {
  const opts = { minRowInk: 2, maxGapRows: 2, minHeight: 2, minInk: 5 };

  it('groups inked rows and bridges small gaps (fraction bars, exponents)', () => {
    const p = [0, 0, 5, 6, 0, 0, 4, 0, 0, 0, 0, 7, 7, 7, 0];
    expect(findBands(p, opts)).toEqual([
      { y0: 2, y1: 6, ink: 15 },
      { y0: 11, y1: 13, ink: 21 },
    ]);
  });

  it('ignores rows below minRowInk and too-short bands', () => {
    expect(findBands([1, 1, 1, 0, 9, 0, 0, 0], opts)).toEqual([]);
  });

  it('closes a band that runs to the last row', () => {
    expect(findBands([0, 3, 3], opts)).toEqual([{ y0: 1, y1: 2, ink: 6 }]);
  });
});

describe('band helpers', () => {
  it('unions, pads and overlaps', () => {
    expect(unionBands([])).toBeNull();
    expect(unionBands([{ y0: 5, y1: 8, ink: 3 }, { y0: 2, y1: 3, ink: 4 }])).toEqual({ y0: 2, y1: 8, ink: 7 });
    expect(padBand({ y0: 1, y1: 30, ink: 1 }, 3, 32)).toEqual({ y0: 0, y1: 31, ink: 1 });
    expect(bandOverlap({ y0: 0, y1: 5, ink: 0 }, { y0: 4, y1: 9, ink: 0 })).toBe(2);
    expect(bandOverlap({ y0: 0, y1: 3, ink: 0 }, { y0: 4, y1: 9, ink: 0 })).toBe(0);
  });
});

describe('orMask / maxComponentHeight', () => {
  it('ORs masks', () => {
    expect(Array.from(orMask(Uint8Array.from([0, 1, 0]), Uint8Array.from([0, 0, 1])))).toEqual([0, 1, 1]);
  });

  it('measures the tallest 8-connected blob', () => {
    const m = new Uint8Array(W * H);
    // A short "character" 5 rows tall.
    for (let y = 2; y <= 6; y++) m[y * W + 3] = 1;
    // A diagonal edge 20 rows tall (connected through corners).
    for (let y = 10; y < 30; y++) m[y * W + 10 + y] = 1;
    expect(maxComponentHeight(m, W, H)).toBe(20);
    expect(maxComponentHeight(new Uint8Array(W * H), W, H)).toBe(0);
  });
});
