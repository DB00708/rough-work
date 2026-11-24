// Pure image helpers for line detection. No DOM: every function works on
// plain typed arrays so it can be tested with synthetic data.
//
// Conventions:
// - A gray image is a Uint8Array of length w*h, row-major, 0 = black.
// - A mask is a Uint8Array of length w*h with values 0 or 1 (1 = ink).

export type Mask = Uint8Array;

/** A horizontal band of rows, inclusive on both ends. */
export interface Band {
  y0: number;
  y1: number;
  /** Number of ink pixels counted inside the band. */
  ink: number;
}

/** RGBA (as from ImageData.data) to 8-bit luma. */
export function toGray(rgba: ArrayLike<number>, w: number, h: number): Uint8Array {
  const n = w * h;
  const out = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  }
  return out;
}

/** Summed-area table with one row/column of zero padding: size (w+1)*(h+1). */
export function integralImage(gray: ArrayLike<number>, w: number, h: number): Float64Array {
  const W = w + 1;
  const ii = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      ii[(y + 1) * W + x + 1] = ii[y * W + x + 1] + rowSum;
    }
  }
  return ii;
}

export interface ThresholdOptions {
  /** Half size of the local window in pixels. */
  radius: number;
  /** A pixel is ink when it is this many gray levels darker than its local mean. */
  offset: number;
}

/**
 * Adaptive (local mean) threshold for dark ink on light paper.
 * Smooth lighting gradients and soft shadows stay below the offset, so they
 * do not become ink; thin dark strokes do.
 */
export function adaptiveThreshold(
  gray: ArrayLike<number>,
  w: number,
  h: number,
  { radius, offset }: ThresholdOptions,
): Mask {
  const ii = integralImage(gray, w, h);
  const W = w + 1;
  const r = Math.max(1, Math.round(radius));
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      const sum =
        ii[(y1 + 1) * W + x1 + 1] - ii[y0 * W + x1 + 1] - ii[(y1 + 1) * W + x0] + ii[y0 * W + x0];
      const mean = sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
      mask[y * w + x] = gray[y * w + x] < mean - offset ? 1 : 0;
    }
  }
  return mask;
}

/** Removes ink pixels that have no ink neighbour (8-connected). Salt noise. */
export function denoise(mask: Mask, w: number, h: number): Mask {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let found = false;
      for (let dy = -1; dy <= 1 && !found; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          if (mask[yy * w + xx]) {
            found = true;
            break;
          }
        }
      }
      if (found) out[i] = 1;
    }
  }
  return out;
}

/** Square dilation with radius r (separable). r <= 0 returns a copy. */
export function dilate(mask: Mask, w: number, h: number, r: number): Mask {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      for (let xx = x0; xx <= x1; xx++) {
        if (mask[y * w + xx]) {
          tmp[y * w + x] = 1;
          break;
        }
      }
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      for (let yy = y0; yy <= y1; yy++) {
        if (tmp[yy * w + x]) {
          out[y * w + x] = 1;
          break;
        }
      }
    }
  }
  return out;
}

export function countInk(mask: Mask): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

/** Number of pixels where the two masks differ. */
export function countDiff(a: Mask, b: Mask): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** Ink in `current` that is not in `reference` (reference is usually dilated). */
export function subtractMask(current: Mask, reference: Mask): Mask {
  const out = new Uint8Array(current.length);
  for (let i = 0; i < current.length; i++) out[i] = current[i] && !reference[i] ? 1 : 0;
  return out;
}

/** Ink pixel count per row. */
export function rowProfile(mask: Mask, w: number, h: number): Uint32Array {
  const p = new Uint32Array(h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    const off = y * w;
    for (let x = 0; x < w; x++) n += mask[off + x];
    p[y] = n;
  }
  return p;
}

export interface BandOptions {
  /** A row counts as inked when it has at least this many ink pixels. */
  minRowInk: number;
  /** Inked rows separated by at most this many empty rows join one band. */
  maxGapRows: number;
  /** Bands shorter than this (rows) are dropped. */
  minHeight: number;
  /** Bands with fewer ink pixels than this are dropped. */
  minInk: number;
}

/** Groups inked rows of a row profile into bands. */
export function findBands(profile: ArrayLike<number>, opts: BandOptions): Band[] {
  const bands: Band[] = [];
  let cur: Band | null = null;
  let gap = 0;
  for (let y = 0; y < profile.length; y++) {
    const v = profile[y];
    if (v >= opts.minRowInk) {
      if (cur) {
        cur.y1 = y;
        cur.ink += v;
      } else {
        cur = { y0: y, y1: y, ink: v };
      }
      gap = 0;
    } else if (cur) {
      gap++;
      if (gap > opts.maxGapRows) {
        bands.push(cur);
        cur = null;
        gap = 0;
      }
    }
  }
  if (cur) bands.push(cur);
  return bands.filter((b) => b.y1 - b.y0 + 1 >= opts.minHeight && b.ink >= opts.minInk);
}

/** Smallest band covering all bands, or null when the list is empty. */
export function unionBands(bands: Band[]): Band | null {
  if (bands.length === 0) return null;
  let y0 = Infinity;
  let y1 = -Infinity;
  let ink = 0;
  for (const b of bands) {
    y0 = Math.min(y0, b.y0);
    y1 = Math.max(y1, b.y1);
    ink += b.ink;
  }
  return { y0, y1, ink };
}

/** Grows a band by `pad` rows on each side, clamped to [0, h-1]. */
export function padBand(band: Band, pad: number, h: number): Band {
  const p = Math.max(0, Math.round(pad));
  return { y0: Math.max(0, band.y0 - p), y1: Math.min(h - 1, band.y1 + p), ink: band.ink };
}

export function bandHeight(b: Band): number {
  return b.y1 - b.y0 + 1;
}

/** Rows shared by two bands (0 when they do not overlap). */
export function bandOverlap(a: Band, b: Band): number {
  return Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1);
}

/** Pixelwise OR of two masks. */
export function orMask(a: Mask, b: Mask): Mask {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] | b[i];
  return out;
}

/**
 * Height in rows of the tallest 8-connected ink blob. Handwritten characters
 * are short; the outline of a hand or an arm has long connected edges.
 */
export function maxComponentHeight(mask: Mask, w: number, h: number): number {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let best = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let minY = h;
    let maxY = -1;
    while (top > 0) {
      const i = stack[--top];
      const y = (i / w) | 0;
      const x = i - y * w;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j] && !seen[j]) {
            seen[j] = 1;
            stack[top++] = j;
          }
        }
      }
    }
    best = Math.max(best, maxY - minY + 1);
  }
  return best;
}
