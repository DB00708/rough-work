// Browser side of line detection: samples the <video> into a small grayscale
// canvas, thresholds it, feeds the pure detector core, and crops finished
// lines from the full-resolution frame as JPEG data URLs.
//
// Privacy: frames are drawn into in-memory canvases only. Nothing here stores
// or uploads a frame; the crop data URL is handed to listeners and kept only
// as `lastCrop` for the debug view.

import {
  createDetectorCore,
  type CoreOptions,
  type CoreStatus,
  type DetectorCore,
  type ObstructionReason,
} from './detectorCore';
import { DEFAULT_ROI, clampRoi, roiToPixels, type Roi } from './roi';
import { adaptiveThreshold, denoise, toGray, type Band, type Mask } from './vision';

/** Pixel rectangle in the full-resolution video frame. */
export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One finished handwritten line. */
export interface CapturedLine {
  /** JPEG data URL of the line band (full ROI width). Memory only. */
  cropDataUrl: string;
  /** Where the crop came from, in video pixels. */
  bbox: BBox;
  /**
   * True when this crop extends the previous line (the student paused
   * mid-line and then kept writing on the same row). The pipeline should
   * re-read and replace the last line instead of adding a new one.
   */
  amends: boolean;
  /** True when produced by forceLineDone() (spacebar) rather than auto-detect. */
  forced: boolean;
  /** Date.now() at capture. */
  at: number;
}

export type LineListener = (line: CapturedLine) => void;

export interface LineDetectorOptions {
  /** Diff sample interval in ms (default 500). The AI read cadence is the pipeline's job. */
  intervalMs?: number;
  /** Guide box, normalized 0..1 (default DEFAULT_ROI). */
  roi?: Roi;
  /** Convenience listener; same as calling onLine(cb). */
  onLine?: LineListener;
  /** Width of the downscaled analysis canvas in px (default 320). */
  procWidth?: number;
  /** JPEG quality of the crop (default 0.85). */
  jpegQuality?: number;
  /** Max crop width in px (default 1024). */
  maxCropWidth?: number;
  /** Local window radius as a fraction of procWidth (default 1/32). */
  thresholdRadiusFraction?: number;
  /** Gray levels below the local mean to count as ink (default 12). */
  thresholdOffset?: number;
  /** Overrides for the detector core (stability, obstruction rules...). */
  core?: Partial<Omit<CoreOptions, 'width' | 'height'>>;
}

export interface DetectorDebug {
  status: CoreStatus | 'no-video';
  /** Why the scene is obstructed (hand, arm, covered text), if it is. */
  obstruction: ObstructionReason | null;
  stillCount: number;
  lastChange: number;
  procWidth: number;
  procHeight: number;
  /** Current ink mask (procWidth x procHeight), or null before the first sample. */
  mask: Mask | null;
  /** Committed ("stable") ink mask. */
  baseline: Mask | null;
  /** Last emitted band, in mask rows (padded). */
  lastBand: Band | null;
  lastCrop: string | null;
  linesEmitted: number;
  roi: Roi;
}

export interface LineDetector {
  /** Feed a frame; sampled at most once per intervalMs. Returns a line if one finished. */
  onFrame(video: HTMLVideoElement): CapturedLine | null;
  /**
   * Spacebar fallback: crop the ink added since the last emit, now.
   * Returns null when there is no new ink or a hand/arm is in the guide box
   * (see getDebug().obstruction). Before the first baseline, all ink counts as new.
   */
  forceLineDone(video?: HTMLVideoElement): CapturedLine | null;
  /** Subscribe to finished lines. Returns an unsubscribe function. */
  onLine(cb: LineListener): () => void;
  /** Start an internal timer that samples `video` every intervalMs. */
  start(video: HTMLVideoElement): void;
  /** Stop the timer. Call it on unmount, or the timer keeps sampling the old video. */
  stop(): void;
  /** Forget all known ink; the next stable frame becomes the new baseline. Call it for a new page. */
  reset(): void;
  /** Change the guide box. Resets the baseline. */
  setRoi(roi: Roi): void;
  getRoi(): Roi;
  getDebug(): DetectorDebug;
}

function videoUsable(v: HTMLVideoElement | null | undefined): v is HTMLVideoElement {
  return !!v && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0;
}

export function createLineDetector(opts: LineDetectorOptions = {}): LineDetector {
  const intervalMs = opts.intervalMs ?? 500;
  const procWidth = Math.max(64, Math.round(opts.procWidth ?? 320));
  const jpegQuality = opts.jpegQuality ?? 0.85;
  const maxCropWidth = opts.maxCropWidth ?? 1024;
  const radiusFrac = opts.thresholdRadiusFraction ?? 1 / 32;
  const offset = opts.thresholdOffset ?? 12;

  let roi = clampRoi(opts.roi ?? DEFAULT_ROI);
  const listeners = new Set<LineListener>();
  if (opts.onLine) listeners.add(opts.onLine);

  let core: DetectorCore | null = null;
  let procHeight = 0;
  let coreKey = '';
  let lastSampleAt = -Infinity;
  let lastVideo: HTMLVideoElement | null = null;
  let lastBand: Band | null = null;
  let lastCrop: string | null = null;
  let linesEmitted = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  let procCanvas: HTMLCanvasElement | null = null;
  let procCtx: CanvasRenderingContext2D | null = null;
  let cropCanvas: HTMLCanvasElement | null = null;

  function ensureProc(w: number, h: number) {
    if (!procCanvas) {
      procCanvas = document.createElement('canvas');
      procCtx = procCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (procCanvas.width !== w) procCanvas.width = w;
    if (procCanvas.height !== h) procCanvas.height = h;
    return procCtx;
  }

  /** Grabs the ROI of the current frame as an ink mask, rebuilding the core if geometry changed. */
  function sampleMask(video: HTMLVideoElement): Mask | null {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const { sx, sy, sw, sh } = roiToPixels(roi, vw, vh);
    const pw = Math.min(procWidth, sw);
    const ph = Math.max(8, Math.min(480, Math.round((pw * sh) / sw)));
    const key = `${vw}x${vh}|${sx},${sy},${sw},${sh}|${pw}x${ph}`;
    if (key !== coreKey || !core) {
      coreKey = key;
      procHeight = ph;
      core = createDetectorCore({ ...opts.core, width: pw, height: ph });
      lastBand = null;
    }
    const ctx = ensureProc(pw, ph);
    if (!ctx) return null;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, pw, ph);
    const img = ctx.getImageData(0, 0, pw, ph);
    const gray = toGray(img.data, pw, ph);
    const radius = Math.max(2, Math.round(pw * radiusFrac));
    return denoise(adaptiveThreshold(gray, pw, ph, { radius, offset }), pw, ph);
  }

  function crop(video: HTMLVideoElement, band: Band, forced: boolean, amends: boolean): CapturedLine | null {
    const { sx, sy, sw, sh } = roiToPixels(roi, video.videoWidth, video.videoHeight);
    const scale = sh / procHeight;
    const y = Math.max(sy, Math.floor(sy + band.y0 * scale));
    const yEnd = Math.min(sy + sh, Math.ceil(sy + (band.y1 + 1) * scale));
    const height = Math.max(1, yEnd - y);
    const outW = Math.min(maxCropWidth, sw);
    const outH = Math.max(1, Math.round((height * outW) / sw));
    if (!cropCanvas) cropCanvas = document.createElement('canvas');
    cropCanvas.width = outW;
    cropCanvas.height = outH;
    const ctx = cropCanvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, sx, y, sw, height, 0, 0, outW, outH);
    const cropDataUrl = cropCanvas.toDataURL('image/jpeg', jpegQuality);
    // Release the pixels; the data URL is the only copy.
    cropCanvas.width = 1;
    cropCanvas.height = 1;
    return { cropDataUrl, bbox: { x: sx, y, width: sw, height }, amends, forced, at: Date.now() };
  }

  function deliver(line: CapturedLine) {
    lastCrop = line.cropDataUrl;
    linesEmitted++;
    for (const cb of listeners) {
      try {
        cb(line);
      } catch (err) {
        console.error('[capture] onLine listener failed', err);
      }
    }
  }

  function stopTimer() {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function sample(video: HTMLVideoElement): CapturedLine | null {
    if (!videoUsable(video)) return null;
    lastVideo = video;
    const mask = sampleMask(video);
    if (!mask || !core) return null;
    const ev = core.push(mask);
    if (!ev || ev.type !== 'line') return null;
    lastBand = ev.band;
    const line = crop(video, ev.band, false, ev.amends);
    if (line) deliver(line);
    return line;
  }

  return {
    onFrame(video) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - lastSampleAt < intervalMs) return null;
      lastSampleAt = now;
      return sample(video);
    },

    forceLineDone(video) {
      const v = video ?? lastVideo;
      if (!videoUsable(v)) return null;
      // Take a fresh sample so the force sees the latest ink.
      lastVideo = v;
      const mask = sampleMask(v);
      if (!mask || !core) return null;
      const pushed = core.push(mask);
      const ev = pushed?.type === 'line' ? pushed : core.force();
      if (!ev) return null;
      lastBand = ev.band;
      const line = crop(v, ev.band, true, ev.amends);
      if (line) deliver(line);
      return line;
    },

    onLine(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    start(video) {
      stopTimer();
      lastVideo = video;
      timer = setInterval(() => {
        lastSampleAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        sample(video);
      }, intervalMs);
    },

    stop: stopTimer,

    reset() {
      core?.reset();
      lastBand = null;
      lastCrop = null;
    },

    setRoi(next) {
      const r = clampRoi(next);
      if (r.x === roi.x && r.y === roi.y && r.w === roi.w && r.h === roi.h) return;
      roi = r;
      coreKey = ''; // forces a new core (fresh baseline) on the next sample
    },

    getRoi() {
      return roi;
    },

    getDebug() {
      const s = core?.state();
      return {
        status: s ? s.status : 'no-video',
        obstruction: s?.obstruction ?? null,
        stillCount: s?.stillCount ?? 0,
        lastChange: s?.lastChange ?? 0,
        procWidth: core?.options.width ?? 0,
        procHeight: core?.options.height ?? 0,
        mask: s?.last ?? null,
        baseline: s?.baseline ?? null,
        lastBand,
        lastCrop,
        linesEmitted,
        roi,
      };
    },
  };
}
