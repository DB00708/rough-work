// Region of interest (the "frame your page" guide box), in normalized
// coordinates: 0..1 fractions of the video frame. Pure helpers + storage.

export interface Roi {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

export const DEFAULT_ROI: Roi = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
export const MIN_ROI_SIZE = 0.1;
export const ROI_STORAGE_KEY = 'roughwork.capture.roi.v1';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keeps the box inside the frame and at least MIN_ROI_SIZE wide/tall. */
export function clampRoi(r: Roi): Roi {
  const w = clamp(r.w, MIN_ROI_SIZE, 1);
  const h = clamp(r.h, MIN_ROI_SIZE, 1);
  return { x: clamp(r.x, 0, 1 - w), y: clamp(r.y, 0, 1 - h), w, h };
}

export function moveRoi(r: Roi, dx: number, dy: number): Roi {
  return clampRoi({ ...r, x: r.x + dx, y: r.y + dy });
}

/** Drags one corner by (dx, dy); the opposite corner stays fixed. */
export function resizeRoi(r: Roi, corner: Corner, dx: number, dy: number): Roi {
  let x0 = r.x;
  let y0 = r.y;
  let x1 = r.x + r.w;
  let y1 = r.y + r.h;
  if (corner === 'nw' || corner === 'sw') x0 = clamp(x0 + dx, 0, x1 - MIN_ROI_SIZE);
  else x1 = clamp(x1 + dx, x0 + MIN_ROI_SIZE, 1);
  if (corner === 'nw' || corner === 'ne') y0 = clamp(y0 + dy, 0, y1 - MIN_ROI_SIZE);
  else y1 = clamp(y1 + dy, y0 + MIN_ROI_SIZE, 1);
  return clampRoi({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

/** Parses a stored ROI. Returns null for anything malformed. */
export function parseRoi(raw: string | null | undefined): Roi | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    const { x, y, w, h } = v as Record<string, unknown>;
    if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    return clampRoi({ x: x as number, y: y as number, w: w as number, h: h as number });
  } catch {
    return null;
  }
}

type ReadStore = Pick<Storage, 'getItem'>;
type WriteStore = Pick<Storage, 'setItem'>;

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadRoi(storage: ReadStore | null = defaultStorage()): Roi {
  try {
    return parseRoi(storage?.getItem(ROI_STORAGE_KEY)) ?? DEFAULT_ROI;
  } catch {
    return DEFAULT_ROI;
  }
}

export function saveRoi(roi: Roi, storage: WriteStore | null = defaultStorage()): void {
  try {
    storage?.setItem(ROI_STORAGE_KEY, JSON.stringify(clampRoi(roi)));
  } catch {
    // Private mode or blocked storage: the ROI just is not remembered.
  }
}

/** ROI in source pixels of a frame, rounded and at least 1 px. */
export function roiToPixels(roi: Roi, frameW: number, frameH: number) {
  const r = clampRoi(roi);
  const sx = Math.round(r.x * frameW);
  const sy = Math.round(r.y * frameH);
  const sw = Math.max(1, Math.min(frameW - sx, Math.round(r.w * frameW)));
  const sh = Math.max(1, Math.min(frameH - sy, Math.round(r.h * frameH)));
  return { sx, sy, sw, sh };
}
