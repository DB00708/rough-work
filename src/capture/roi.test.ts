import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROI,
  MIN_ROI_SIZE,
  ROI_STORAGE_KEY,
  clampRoi,
  loadRoi,
  moveRoi,
  parseRoi,
  resizeRoi,
  roiToPixels,
  saveRoi,
} from './roi';

describe('roi geometry', () => {
  it('clamps into the frame with a minimum size', () => {
    expect(clampRoi({ x: -0.2, y: 0.95, w: 0.01, h: 2 })).toEqual({ x: 0, y: 0, w: MIN_ROI_SIZE, h: 1 });
  });

  it('moves without leaving the frame', () => {
    expect(moveRoi({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, 0.5, -0.9)).toEqual({ x: 0.6, y: 0, w: 0.4, h: 0.4 });
  });

  it('resizes from a corner, keeping the opposite corner fixed', () => {
    const r = resizeRoi({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'nw', 0.1, -0.1);
    expect(r.x).toBeCloseTo(0.3);
    expect(r.y).toBeCloseTo(0.1);
    expect(r.x + r.w).toBeCloseTo(0.7);
    expect(r.y + r.h).toBeCloseTo(0.7);
  });

  it('does not let a corner cross the opposite one', () => {
    const r = resizeRoi({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'se', -1, -1);
    expect(r.w).toBeCloseTo(MIN_ROI_SIZE);
    expect(r.h).toBeCloseTo(MIN_ROI_SIZE);
    expect(r.x).toBeCloseTo(0.2);
  });

  it('maps to frame pixels', () => {
    expect(roiToPixels({ x: 0.1, y: 0.2, w: 0.5, h: 0.5 }, 1280, 720)).toEqual({ sx: 128, sy: 144, sw: 640, sh: 360 });
  });
});

describe('roi storage', () => {
  it('parses valid JSON and rejects junk', () => {
    expect(parseRoi('{"x":0.1,"y":0.1,"w":0.5,"h":0.5}')).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    expect(parseRoi('not json')).toBeNull();
    expect(parseRoi('{"x":"a","y":0,"w":1,"h":1}')).toBeNull();
    expect(parseRoi(null)).toBeNull();
  });

  it('round-trips through a storage object', () => {
    const map = new Map<string, string>();
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    saveRoi({ x: 0.2, y: 0.3, w: 0.4, h: 0.5 }, store);
    expect(map.has(ROI_STORAGE_KEY)).toBe(true);
    expect(loadRoi(store)).toEqual({ x: 0.2, y: 0.3, w: 0.4, h: 0.5 });
  });

  it('falls back to the default when storage throws or is missing', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadRoi(throwing)).toEqual(DEFAULT_ROI);
    expect(() => saveRoi(DEFAULT_ROI, throwing)).not.toThrow();
    expect(loadRoi(null)).toEqual(DEFAULT_ROI);
    expect(loadRoi()).toEqual(DEFAULT_ROI); // node: no localStorage
  });
});
