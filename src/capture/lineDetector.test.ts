// Runs createLineDetector end to end in node with a fake canvas and video.
// The fake "camera" renders a synthetic page straight into the analysis
// canvas, so we can check sampling, emit timing and crop geometry.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLineDetector } from './lineDetector';
import { toCameraError, cameraConstraints } from './useCamera';

interface DrawCall {
  args: number[];
  canvas: FakeCanvas;
}

/** Rows (in analysis-canvas coordinates) that currently have ink. */
let inkRows: Array<[number, number]> = [];
let draws: DrawCall[] = [];

class FakeCanvas {
  width = 300;
  height = 150;
  getContext() {
    return {
      drawImage: (_src: unknown, ...args: number[]) => draws.push({ args, canvas: this }),
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4).fill(230);
        for (const [y0, y1] of inkRows) {
          for (let y = y0; y <= y1; y++) {
            for (let x = 20; x < w - 20; x += 3) {
              const j = (y * w + x) * 4;
              data[j] = data[j + 1] = data[j + 2] = 20;
            }
          }
        }
        return { data, width: w, height: h };
      },
    };
  }
  toDataURL(type: string, q: number) {
    return `data:${type};q=${q};w=${this.width};h=${this.height}`;
  }
}

const video = { readyState: 4, videoWidth: 1280, videoHeight: 720 } as unknown as HTMLVideoElement;

beforeEach(() => {
  inkRows = [];
  draws = [];
  vi.stubGlobal('document', { createElement: () => new FakeCanvas() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function run(det: ReturnType<typeof createLineDetector>, n: number, v: HTMLVideoElement = video) {
  const out = [];
  for (let i = 0; i < n; i++) {
    // Advance the clock past intervalMs so onFrame samples every call.
    vi.advanceTimersByTime(600);
    const line = det.onFrame(v);
    if (line) out.push(line);
  }
  return out;
}

describe('createLineDetector (fake canvas)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date', 'performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits one cropped line after new ink settles, mapped to video pixels', () => {
    const onLine = vi.fn();
    // ROI = full frame: 1280x720 -> analysis 320x180, scale 4.
    const det = createLineDetector({ roi: { x: 0, y: 0, w: 1, h: 1 }, onLine });
    expect(run(det, 4)).toEqual([]); // baseline on empty page
    inkRows = [[60, 66]];
    const lines = run(det, 4);
    expect(lines).toHaveLength(1);
    expect(onLine).toHaveBeenCalledTimes(1);
    const line = lines[0];
    expect(line.forced).toBe(false);
    expect(line.amends).toBe(false);
    expect(line.bbox.x).toBe(0);
    expect(line.bbox.width).toBe(1280);
    // Band 60..66 padded by >=3 rows, times scale 4.
    expect(line.bbox.y).toBeLessThanOrEqual(57 * 4);
    expect(line.bbox.y + line.bbox.height).toBeGreaterThanOrEqual(67 * 4);
    expect(line.bbox.height).toBeLessThan(30 * 4);
    // JPEG, quality 0.85, width capped at 1024.
    expect(line.cropDataUrl).toMatch(/^data:image\/jpeg;q=0.85;w=1024;/);
    expect(det.getDebug().linesEmitted).toBe(1);
    expect(det.getDebug().lastCrop).toBe(line.cropDataUrl);
  });

  it('samples at most once per interval in onFrame', () => {
    const det = createLineDetector({ intervalMs: 500 });
    det.onFrame(video);
    const after1 = draws.length;
    det.onFrame(video);
    expect(draws.length).toBe(after1);
    vi.advanceTimersByTime(500);
    det.onFrame(video);
    expect(draws.length).toBeGreaterThan(after1);
  });

  it('forceLineDone crops new ink immediately', () => {
    const det = createLineDetector({ roi: { x: 0, y: 0, w: 1, h: 1 } });
    run(det, 4);
    inkRows = [[100, 105]];
    const line = det.forceLineDone(video);
    expect(line).not.toBeNull();
    expect(line!.forced).toBe(true);
    expect(line!.bbox.y).toBeLessThanOrEqual(100 * 4);
    expect(det.forceLineDone(video)).toBeNull(); // nothing new since
  });

  it('crops inside the ROI only', () => {
    const det = createLineDetector({ roi: { x: 0.25, y: 0.5, w: 0.5, h: 0.5 } });
    run(det, 4);
    inkRows = [[10, 14]];
    const [line] = run(det, 4);
    expect(line.bbox.x).toBe(320);
    expect(line.bbox.width).toBe(640);
    expect(line.bbox.y).toBeGreaterThanOrEqual(360);
  });

  it('maps crops to the video resolution, not the analysis size (1920x1080)', () => {
    const hd = { readyState: 4, videoWidth: 1920, videoHeight: 1080 } as unknown as HTMLVideoElement;
    const det = createLineDetector({ roi: { x: 0, y: 0, w: 1, h: 1 } });
    run(det, 4, hd);
    inkRows = [[60, 66]]; // analysis 320x180, scale 6
    const [line] = run(det, 4, hd);
    expect(line.bbox.width).toBe(1920);
    expect(line.bbox.y).toBeLessThanOrEqual(60 * 6);
    expect(line.bbox.y).toBeGreaterThanOrEqual(50 * 6);
    expect(line.bbox.y + line.bbox.height).toBeGreaterThanOrEqual(67 * 6);
    expect(line.cropDataUrl).toMatch(/w=1024;/); // capped
  });

  it('handles a tall ROI that hits the 480-row analysis clamp', () => {
    const tall = { readyState: 4, videoWidth: 320, videoHeight: 1280 } as unknown as HTMLVideoElement;
    const det = createLineDetector({ roi: { x: 0, y: 0, w: 1, h: 1 } });
    run(det, 4, tall);
    expect(det.getDebug().procHeight).toBe(480);
    inkRows = [[200, 206]]; // scale 1280/480
    const [line] = run(det, 4, tall);
    const scale = 1280 / 480;
    expect(line.bbox.y).toBeLessThanOrEqual(200 * scale);
    expect(line.bbox.y).toBeGreaterThanOrEqual(190 * scale);
    expect(line.bbox.y + line.bbox.height).toBeGreaterThanOrEqual(207 * scale);
    expect(line.bbox.width).toBe(320);
  });

  it('ignores frames before the video has dimensions', () => {
    const det = createLineDetector();
    const notReady = { readyState: 0, videoWidth: 0, videoHeight: 0 } as unknown as HTMLVideoElement;
    expect(det.onFrame(notReady)).toBeNull();
    expect(det.forceLineDone(notReady)).toBeNull();
    expect(det.getDebug().status).toBe('no-video');
  });

  it('setRoi resets the baseline; unsubscribe stops delivery', () => {
    const cb = vi.fn();
    const det = createLineDetector({ roi: { x: 0, y: 0, w: 1, h: 1 } });
    const off = det.onLine(cb);
    run(det, 4);
    det.setRoi({ x: 0, y: 0, w: 1, h: 0.9 });
    inkRows = [[40, 45]];
    expect(run(det, 4)).toEqual([]); // ink present at first stable frame = baseline
    off();
    inkRows = [[40, 45], [90, 95]];
    expect(run(det, 4)).toHaveLength(1);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('camera helpers', () => {
  it('maps getUserMedia errors to friendly kinds', () => {
    expect(toCameraError({ name: 'NotAllowedError' }).kind).toBe('permission-denied');
    expect(toCameraError({ name: 'NotFoundError' }).kind).toBe('no-camera');
    expect(toCameraError({ name: 'OverconstrainedError' }).kind).toBe('no-camera');
    expect(toCameraError({ name: 'NotReadableError' }).kind).toBe('camera-busy');
    expect(toCameraError(new Error('x')).kind).toBe('unknown');
    expect(toCameraError(null).kind).toBe('unknown');
  });

  it('prefers the environment camera at 1280x720, or an exact device', () => {
    const def = cameraConstraints(null).video as MediaTrackConstraints;
    expect(def.facingMode).toEqual({ ideal: 'environment' });
    expect(def.width).toEqual({ ideal: 1280 });
    const pick = cameraConstraints('abc').video as MediaTrackConstraints;
    expect(pick.deviceId).toEqual({ exact: 'abc' });
    expect(pick.facingMode).toBeUndefined();
    expect(cameraConstraints(null).audio).toBe(false);
  });
});
