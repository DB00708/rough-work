// Pure new-line detection state machine. It eats one ink mask per sample
// (already thresholded, in ROI coordinates) and decides when a new line is
// finished. No DOM, no timers: the caller feeds samples at its own rate.
//
// Rules:
// 1. Stability: the mask may change by at most max(stillTolerance * pixels,
//    stillInkFraction * ink pixels) between samples, for `stableSamples`
//    samples in a row. A moving hand or pen keeps the scene unstable.
// 2. Known ink: the first stable mask becomes the known ink. Every emitted
//    line is added to it. Known ink only grows until reset() (one page per
//    session; call reset() for a new page). So ink that is hidden for a while
//    (hand over the text) and then reappears is never "new".
// 3. When stable, ink present now but absent from the (dilated) known ink is
//    new ink. Its rows are grouped into bands; the union band is the new line.
// 4. Obstruction (a hand, sleeve or object, not a line). Any of:
//    - band taller than maxBandFraction of the ROI, or denser than maxBandDensity;
//    - a connected blob of new ink taller than maxComponentFraction of the ROI
//      (a hand outline has long vertical edges; characters are short);
//    - the band reaches the bottom edge of the ROI (arms enter from below);
//    - known ink is covered: more than maxInkLossFraction of it is missing.
//    Obstructions are not emitted and block forceLineDone(). If one stays for
//    `rebaselineSamples` stable samples, it is absorbed into the known ink
//    (an object left on the page).
// 5. New ink on the same rows as the last line, and starting to the right of
//    it, is a continuation (the student paused mid-line): `amends: true`, and
//    the band covers both.

import {
  type Band,
  type Mask,
  bandHeight,
  bandOverlap,
  countDiff,
  countInk,
  dilate,
  findBands,
  maxComponentHeight,
  orMask,
  padBand,
  rowProfile,
  subtractMask,
  unionBands,
} from './vision';

export interface CoreOptions {
  width: number;
  height: number;
  /** Consecutive still samples needed before the scene counts as stable. */
  stableSamples: number;
  /** Fraction of all pixels that may change between samples while "still". */
  stillTolerance: number;
  /** Fraction of current ink pixels that may flicker between samples while "still". */
  stillInkFraction: number;
  /** Dilation radius applied to known ink, to absorb 1-2 px camera jitter. */
  shiftTolerance: number;
  minRowInk: number;
  maxGapRows: number;
  minBandHeight: number;
  /** Minimum new ink pixels (whole union) to count as a line. */
  minNewInk: number;
  /** Bands taller than this fraction of the ROI height are obstructions. */
  maxBandFraction: number;
  /** Bands whose ink fills more than this fraction of the band area are obstructions. */
  maxBandDensity: number;
  /** A connected blob of new ink taller than this fraction of the ROI is an obstruction. */
  maxComponentFraction: number;
  /** New ink within this many rows of the ROI bottom edge is an obstruction. */
  bottomEdgeRows: number;
  /** Stable samples of persistent obstruction before it is absorbed into known ink. */
  rebaselineSamples: number;
  /** Fraction of known ink that may be hidden before the scene counts as covered. */
  maxInkLossFraction: number;
  /** Padding added above and below the band, as a fraction of its height. */
  padFraction: number;
  minPadRows: number;
  /** Min vertical overlap (fraction of the smaller band) to count as a continuation. */
  amendOverlap: number;
  /** New ink may start this many columns left of the last line's right end and still amend it. */
  amendSlackCols: number;
}

export function defaultCoreOptions(width: number, height: number): CoreOptions {
  return {
    width,
    height,
    stableSamples: 3,
    stillTolerance: 0.002,
    stillInkFraction: 0.03,
    shiftTolerance: 1,
    minRowInk: Math.max(2, Math.round(width * 0.008)),
    maxGapRows: Math.max(2, Math.round(height * 0.03)),
    minBandHeight: 3,
    minNewInk: Math.max(12, Math.round(width * height * 0.0006)),
    maxBandFraction: 0.3,
    maxBandDensity: 0.4,
    maxComponentFraction: 0.18,
    bottomEdgeRows: 2,
    rebaselineSamples: 12,
    maxInkLossFraction: 0.15,
    padFraction: 0.3,
    minPadRows: 3,
    amendOverlap: 0.6,
    amendSlackCols: Math.max(3, Math.round(width * 0.03)),
  };
}

export type CoreStatus = 'warming' | 'moving' | 'settling' | 'idle' | 'obstructed';

export type ObstructionReason = 'tall' | 'dense' | 'blob' | 'bottom-edge' | 'covered';

export type LineEvent = {
  type: 'line';
  /** Padded band to crop, in mask rows. */
  band: Band;
  /** Unpadded band of new ink. */
  rawBand: Band;
  /** True when this extends the previous line instead of starting a new one. */
  amends: boolean;
  forced: boolean;
};

export type CoreEvent = { type: 'baseline' } | { type: 'rebaseline'; reason: 'obstruction' } | LineEvent;

export interface CoreState {
  status: CoreStatus;
  /** Why the scene is obstructed, when status is 'obstructed'. */
  obstruction: ObstructionReason | null;
  stillCount: number;
  /** Fraction of pixels that changed at the last sample. */
  lastChange: number;
  /** Known ink (committed). */
  baseline: Mask | null;
  last: Mask | null;
  /** Unpadded band of the last emitted line. */
  lastLine: Band | null;
}

export interface DetectorCore {
  push(mask: Mask): CoreEvent | null;
  /**
   * Emit the new ink in the last mask now, ignoring stability. Returns null
   * when there is no new ink or the scene is obstructed (hand in frame).
   * Before any baseline, all ink in the mask counts as new.
   */
  force(): LineEvent | null;
  reset(): void;
  state(): CoreState;
  readonly options: CoreOptions;
}

interface Candidate {
  rawBand: Band;
  /** Column extent of the new ink. */
  x0: number;
  x1: number;
  obstruction: ObstructionReason | null;
}

export function createDetectorCore(partial: Partial<CoreOptions> & { width: number; height: number }): DetectorCore {
  const o: CoreOptions = { ...defaultCoreOptions(partial.width, partial.height), ...partial };
  const { width: w, height: h } = o;
  const N = w * h;

  let prev: Mask | null = null;
  let known: Mask | null = null;
  let knownDil: Mask | null = null;
  let knownInk = 0;
  let stillCount = 0;
  let lastChange = 1;
  let obstructedCount = 0;
  let status: CoreStatus = 'warming';
  let obstruction: ObstructionReason | null = null;
  let lastLine: (Band & { x0: number; x1: number }) | null = null;

  function addKnown(mask: Mask) {
    known = known ? orMask(known, mask) : mask.slice();
    knownDil = dilate(known, w, h, o.shiftTolerance);
    knownInk = countInk(known);
    obstructedCount = 0;
  }

  function covered(mask: Mask): boolean {
    if (!known || knownInk === 0) return false;
    const lost = countInk(subtractMask(known, dilate(mask, w, h, o.shiftTolerance)));
    return lost > Math.max(o.minNewInk, o.maxInkLossFraction * knownInk);
  }

  function candidate(mask: Mask): Candidate | null {
    const added = knownDil ? subtractMask(mask, knownDil) : mask;
    const bands = findBands(rowProfile(added, w, h), {
      minRowInk: o.minRowInk,
      maxGapRows: o.maxGapRows,
      minHeight: o.minBandHeight,
      minInk: 1,
    });
    const u = unionBands(bands);
    const isCovered = covered(mask);
    if (!u || u.ink < o.minNewInk) {
      return isCovered ? { rawBand: { y0: 0, y1: 0, ink: 0 }, x0: 0, x1: 0, obstruction: 'covered' } : null;
    }
    let x0 = w;
    let x1 = -1;
    for (let y = u.y0; y <= u.y1; y++) {
      for (let x = 0; x < w; x++) {
        if (added[y * w + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
        }
      }
    }
    let reason: ObstructionReason | null = null;
    // 'covered' first: it must win so a covering hand is never absorbed.
    if (isCovered) reason = 'covered';
    else if (bandHeight(u) > o.maxBandFraction * h) reason = 'tall';
    else if (u.ink / (bandHeight(u) * w) > o.maxBandDensity) reason = 'dense';
    else if (u.y1 >= h - o.bottomEdgeRows) reason = 'bottom-edge';
    else if (maxComponentHeight(added, w, h) > o.maxComponentFraction * h) reason = 'blob';
    return { rawBand: u, x0, x1, obstruction: reason };
  }

  function emit(mask: Mask, c: Candidate, forced: boolean): LineEvent {
    let raw = c.rawBand;
    let x0 = c.x0;
    let x1 = c.x1;
    let amends = false;
    if (lastLine) {
      const ov = bandOverlap(raw, lastLine);
      const sameRows = ov > 0 && ov >= o.amendOverlap * Math.min(bandHeight(raw), bandHeight(lastLine));
      const continuesRight = c.x0 >= lastLine.x1 - o.amendSlackCols;
      if (sameRows && continuesRight) {
        amends = true;
        raw = { y0: Math.min(raw.y0, lastLine.y0), y1: Math.max(raw.y1, lastLine.y1), ink: raw.ink };
        x0 = Math.min(x0, lastLine.x0);
        x1 = Math.max(x1, lastLine.x1);
      }
    }
    const pad = Math.max(o.minPadRows, bandHeight(raw) * o.padFraction);
    addKnown(mask);
    lastLine = { ...raw, x0, x1 };
    status = 'idle';
    obstruction = null;
    return { type: 'line', band: padBand(raw, pad, h), rawBand: raw, amends, forced };
  }

  return {
    options: o,

    push(mask) {
      if (mask.length !== N) throw new Error(`mask size ${mask.length} != ${w}x${h}`);
      if (prev) {
        const diff = countDiff(prev, mask);
        lastChange = diff / N;
        const allowed = Math.max(o.stillTolerance * N, o.stillInkFraction * countInk(mask));
        stillCount = diff <= allowed ? stillCount + 1 : 0;
      } else {
        lastChange = 1;
        stillCount = 0;
      }
      prev = mask;

      if (stillCount < o.stableSamples) {
        status = !known ? 'warming' : stillCount === 0 ? 'moving' : 'settling';
        return null;
      }

      if (!known) {
        addKnown(mask);
        status = 'idle';
        return { type: 'baseline' };
      }

      const c = candidate(mask);
      if (!c) {
        obstructedCount = 0;
        status = 'idle';
        obstruction = null;
        return null;
      }
      if (c.obstruction) {
        obstructedCount++;
        status = 'obstructed';
        obstruction = c.obstruction;
        // Absorb a persistent object, but never because known ink is merely
        // covered: absorbing that would add the hand, not the page.
        if (obstructedCount >= o.rebaselineSamples && c.obstruction !== 'covered') {
          addKnown(mask);
          lastLine = null;
          status = 'idle';
          obstruction = null;
          return { type: 'rebaseline', reason: 'obstruction' };
        }
        return null;
      }
      return emit(mask, c, false);
    },

    force() {
      if (!prev) return null;
      const c = candidate(prev);
      if (!c || c.obstruction) {
        if (c?.obstruction) {
          status = 'obstructed';
          obstruction = c.obstruction;
        }
        return null;
      }
      return emit(prev, c, true);
    },

    reset() {
      prev = null;
      known = null;
      knownDil = null;
      knownInk = 0;
      stillCount = 0;
      lastChange = 1;
      obstructedCount = 0;
      status = 'warming';
      obstruction = null;
      lastLine = null;
    },

    state() {
      return {
        status,
        obstruction,
        stillCount,
        lastChange,
        baseline: known,
        last: prev,
        lastLine: lastLine ? { y0: lastLine.y0, y1: lastLine.y1, ink: lastLine.ink } : null,
      };
    },
  };
}
