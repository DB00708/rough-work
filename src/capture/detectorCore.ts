// Pure new-line detection state machine. It eats one ink mask per sample
// (already thresholded, in ROI coordinates) and decides when a new line is
// finished. No DOM, no timers: the caller feeds samples at its own rate.
//
// Rules:
// 1. Stability: the mask must change by at most `stillTolerance` (fraction of
//    pixels) for `stableSamples` samples in a row. A moving hand or pen keeps
//    the scene unstable, so nothing is emitted while the student writes.
// 2. The first stable mask becomes the baseline (ink already on the page).
// 3. When stable, ink present now but absent from the (dilated) baseline is
//    new ink. Its rows are grouped into bands; the union band is the new line.
// 4. Obstruction: a band taller than `maxBandFraction` of the ROI, or denser
//    than `maxBandDensity`, is a hand/shadow/object, not a line. It is not
//    emitted. If it stays for `rebaselineSamples` stable samples, the baseline
//    is reset to the current mask (page moved, object left on the page).
// 5. Large ink loss (erasing, page swapped) also resets the baseline.
// 6. New ink that overlaps the rows of the last emitted line is a
//    continuation (the student paused mid-line): the event has `amends: true`
//    and the band covers both.

import {
  type Band,
  type Mask,
  bandHeight,
  bandOverlap,
  countDiff,
  countInk,
  dilate,
  findBands,
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
  /** Max fraction of pixels that may change between samples while "still". */
  stillTolerance: number;
  /** Dilation radius applied to the baseline, to absorb 1-2 px camera jitter. */
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
  /** Stable samples of persistent obstruction before the baseline is reset. */
  rebaselineSamples: number;
  /** Fraction of baseline ink that may disappear before the baseline is reset. */
  maxInkLossFraction: number;
  /** Padding added above and below the band, as a fraction of its height. */
  padFraction: number;
  minPadRows: number;
  /** Min vertical overlap (fraction of the smaller band) to count as a continuation. */
  amendOverlap: number;
}

export function defaultCoreOptions(width: number, height: number): CoreOptions {
  return {
    width,
    height,
    stableSamples: 3,
    stillTolerance: 0.002,
    shiftTolerance: 1,
    minRowInk: Math.max(2, Math.round(width * 0.008)),
    maxGapRows: Math.max(2, Math.round(height * 0.03)),
    minBandHeight: 3,
    minNewInk: Math.max(12, Math.round(width * height * 0.0006)),
    maxBandFraction: 0.4,
    maxBandDensity: 0.4,
    rebaselineSamples: 12,
    maxInkLossFraction: 0.3,
    padFraction: 0.3,
    minPadRows: 3,
    amendOverlap: 0.3,
  };
}

export type CoreStatus = 'warming' | 'moving' | 'settling' | 'idle' | 'obstructed';

export type CoreEvent =
  | { type: 'baseline' }
  | { type: 'rebaseline'; reason: 'obstruction' | 'ink-loss' }
  | {
      type: 'line';
      /** Padded band to crop, in mask rows. */
      band: Band;
      /** Unpadded band of new ink. */
      rawBand: Band;
      /** True when this extends the previous line instead of starting a new one. */
      amends: boolean;
      forced: boolean;
    };

export interface CoreState {
  status: CoreStatus;
  stillCount: number;
  /** Fraction of pixels that changed at the last sample. */
  lastChange: number;
  baseline: Mask | null;
  last: Mask | null;
  /** Unpadded band of the last emitted line. */
  lastLine: Band | null;
}

export interface DetectorCore {
  push(mask: Mask): CoreEvent | null;
  /** Emit whatever new ink exists in the last mask now, ignoring stability. */
  force(): Extract<CoreEvent, { type: 'line' }> | null;
  reset(): void;
  state(): CoreState;
  readonly options: CoreOptions;
}

interface Candidate {
  rawBand: Band;
  obstructed: boolean;
}

export function createDetectorCore(partial: Partial<CoreOptions> & { width: number; height: number }): DetectorCore {
  const o: CoreOptions = { ...defaultCoreOptions(partial.width, partial.height), ...partial };
  const { width: w, height: h } = o;
  const N = w * h;

  let prev: Mask | null = null;
  let baseline: Mask | null = null;
  let baselineDil: Mask | null = null;
  let baselineInk = 0;
  let stillCount = 0;
  let lastChange = 1;
  let obstructedCount = 0;
  let status: CoreStatus = 'warming';
  let lastLine: Band | null = null;

  function setBaseline(mask: Mask) {
    baseline = mask;
    baselineDil = dilate(mask, w, h, o.shiftTolerance);
    baselineInk = countInk(mask);
    obstructedCount = 0;
  }

  function candidate(mask: Mask): Candidate | null {
    const ref = baselineDil ?? new Uint8Array(N);
    const added = subtractMask(mask, ref);
    const bands = findBands(rowProfile(added, w, h), {
      minRowInk: o.minRowInk,
      maxGapRows: o.maxGapRows,
      minHeight: o.minBandHeight,
      minInk: 1,
    });
    const u = unionBands(bands);
    if (!u || u.ink < o.minNewInk) return null;
    const density = u.ink / (bandHeight(u) * w);
    const obstructed = bandHeight(u) > o.maxBandFraction * h || density > o.maxBandDensity;
    return { rawBand: u, obstructed };
  }

  function inkLoss(mask: Mask): number {
    if (!baseline) return 0;
    const lost = subtractMask(baseline, dilate(mask, w, h, o.shiftTolerance));
    return countInk(lost);
  }

  function emit(mask: Mask, rawBand: Band, forced: boolean): Extract<CoreEvent, { type: 'line' }> {
    let raw = rawBand;
    let amends = false;
    if (lastLine) {
      const ov = bandOverlap(raw, lastLine);
      if (ov > 0 && ov >= o.amendOverlap * Math.min(bandHeight(raw), bandHeight(lastLine))) {
        amends = true;
        raw = { y0: Math.min(raw.y0, lastLine.y0), y1: Math.max(raw.y1, lastLine.y1), ink: raw.ink };
      }
    }
    const pad = Math.max(o.minPadRows, bandHeight(raw) * o.padFraction);
    setBaseline(mask);
    lastLine = raw;
    status = 'idle';
    return { type: 'line', band: padBand(raw, pad, h), rawBand: raw, amends, forced };
  }

  return {
    options: o,

    push(mask) {
      if (mask.length !== N) throw new Error(`mask size ${mask.length} != ${w}x${h}`);
      lastChange = prev ? countDiff(prev, mask) / N : 1;
      prev = mask;
      stillCount = lastChange <= o.stillTolerance ? stillCount + 1 : 0;

      if (stillCount < o.stableSamples) {
        status = !baseline ? 'warming' : stillCount === 0 ? 'moving' : 'settling';
        return null;
      }

      if (!baseline) {
        setBaseline(mask);
        status = 'idle';
        return { type: 'baseline' };
      }

      if (baselineInk > 0 && inkLoss(mask) > o.maxInkLossFraction * baselineInk) {
        setBaseline(mask);
        lastLine = null;
        status = 'idle';
        return { type: 'rebaseline', reason: 'ink-loss' };
      }

      const c = candidate(mask);
      if (!c) {
        obstructedCount = 0;
        status = 'idle';
        return null;
      }
      if (c.obstructed) {
        obstructedCount++;
        status = 'obstructed';
        if (obstructedCount >= o.rebaselineSamples) {
          setBaseline(mask);
          lastLine = null;
          status = 'idle';
          return { type: 'rebaseline', reason: 'obstruction' };
        }
        return null;
      }
      return emit(mask, c.rawBand, false);
    },

    force() {
      if (!prev) return null;
      const c = candidate(prev);
      if (!c) return null;
      return emit(prev, c.rawBand, true);
    },

    reset() {
      prev = null;
      baseline = null;
      baselineDil = null;
      baselineInk = 0;
      stillCount = 0;
      lastChange = 1;
      obstructedCount = 0;
      status = 'warming';
      lastLine = null;
    },

    state() {
      return { status, stillCount, lastChange, baseline, last: prev, lastLine };
    },
  };
}
