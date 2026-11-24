// ADAPTER (orchestrator fixes at merge). Single import point for T3's capture
// module. Until `src/capture` exists on main, this file holds a minimal local
// stand-in with the shapes Practice.tsx needs. At merge, replace the body with:
//
//   export { useCamera, createLineDetector, FrameGuide } from '../capture';
//
// and map any shape differences here, so Practice.tsx does not change.
import { createElement, useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface LineCropEvent {
  cropDataUrl: string;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface LineDetector {
  /** Feed a video frame; emits onLine once per new written line. */
  onFrame(video: HTMLVideoElement): void;
  /** Spacebar: emit the newest region now. */
  forceLineDone(): void;
}

export interface LineDetectorOptions {
  onLine(e: LineCropEvent): void;
}

export type CameraStatus = 'idle' | 'starting' | 'live' | 'error';

export interface CameraHandle {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  error: string | null;
  start(): Promise<void>;
  stop(): void;
}

/** Stand-in camera hook: getUserMedia, rear camera preferred, no recording. */
export function useCamera(): CameraHandle {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser has no camera access.');
      setStatus('error');
      return;
    }
    setStatus('starting');
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStatus('live');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Camera blocked');
      setStatus('error');
    }
  }, []);

  useEffect(() => stop, [stop]);

  return { videoRef, status, error, start, stop };
}

/** Stand-in detector: no auto-detect; forceLineDone crops the whole frame. */
export function createLineDetector(opts: LineDetectorOptions): LineDetector {
  let last: HTMLVideoElement | null = null;
  return {
    onFrame(video) {
      last = video;
    },
    forceLineDone() {
      const v = last;
      if (!v || !v.videoWidth) return;
      const scale = Math.min(1, 1024 / v.videoWidth);
      const w = Math.round(v.videoWidth * scale);
      const h = Math.round(v.videoHeight * scale);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, w, h);
      opts.onLine({ cropDataUrl: c.toDataURL('image/jpeg', 0.8), bbox: { x: 0, y: 0, w, h } });
    },
  };
}

/** Stand-in guide box drawn over the video. */
export function FrameGuide() {
  return createElement('div', { className: 'frame-guide', 'aria-hidden': true });
}
