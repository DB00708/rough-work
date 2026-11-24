// Webcam hook. Render `<video ref={videoRef} />` unconditionally (it may be
// hidden) so the stream can attach as soon as it is ready.
//
// Privacy: the stream goes only into the <video> element. Nothing is recorded.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export type CameraErrorKind =
  | 'permission-denied'
  | 'no-camera'
  | 'camera-busy'
  | 'unsupported'
  | 'disconnected'
  | 'unknown';

export interface CameraError {
  kind: CameraErrorKind;
  /** Short message safe to show to the student. */
  message: string;
}

export interface UseCameraOptions {
  /** Open the camera on mount (default true). */
  autoStart?: boolean;
}

export interface UseCamera {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** True once the video is playing and has frame dimensions. */
  ready: boolean;
  error: CameraError | null;
  /** Video inputs (labels appear after permission is granted). */
  devices: MediaDeviceInfo[];
  /** The chosen deviceId, or null for the default (environment-facing) camera. */
  deviceId: string | null;
  selectDevice(deviceId: string | null): void;
  /** (Re)open the camera, e.g. after the student fixes a permission problem. */
  start(): void;
  /** Stop all tracks and release the camera. */
  stop(): void;
}

const DEVICE_KEY = 'roughwork.capture.deviceId.v1';

function loadDeviceId(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

function saveDeviceId(id: string | null) {
  try {
    if (id) localStorage.setItem(DEVICE_KEY, id);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    // storage blocked: not remembered
  }
}

export function cameraConstraints(deviceId: string | null): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };
  if (deviceId) video.deviceId = { exact: deviceId };
  else video.facingMode = { ideal: 'environment' };
  return { video, audio: false };
}

export function toCameraError(err: unknown): CameraError {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return {
        kind: 'permission-denied',
        message: 'Camera permission was denied. Allow camera access in the address bar, then try again.',
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return { kind: 'no-camera', message: 'No camera was found. Connect a webcam and try again.' };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return {
        kind: 'camera-busy',
        message: 'The camera is in use by another app or tab. Close it and try again.',
      };
    default:
      return { kind: 'unknown', message: 'Could not start the camera. Try again.' };
  }
}

export function useCamera(options: UseCameraOptions = {}): UseCamera {
  const { autoStart = true } = options;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestId = useRef(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<CameraError | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(loadDeviceId);

  const detachListeners = useRef<(() => void) | null>(null);

  const releaseStream = useCallback(() => {
    detachListeners.current?.();
    detachListeners.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) v.srcObject = null;
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === 'videoinput'));
    } catch {
      setDevices([]);
    }
  }, []);

  const attach = useCallback((id: number) => {
    const v = videoRef.current;
    const stream = streamRef.current;
    if (!v || !stream || v.srcObject === stream) return;
    detachListeners.current?.();
    v.srcObject = stream;
    v.muted = true;
    v.playsInline = true;
    const check = () => {
      if (id !== requestId.current) return;
      if (v.videoWidth > 0 && v.videoHeight > 0 && v.readyState >= 2) setReady(true);
    };
    const play = () => {
      if (id !== requestId.current) return;
      v.play()
        .then(check)
        .catch(() => {
          // Autoplay of a muted inline video rarely fails; we retry on the
          // next 'canplay', and start() retries on a user gesture.
        });
    };
    // Dimensions can arrive after play() resolves, so also re-check on
    // loadeddata / resize / playing; retry play() on loadedmetadata / canplay.
    const checkEvents = ['loadeddata', 'resize', 'playing'] as const;
    const playEvents = ['loadedmetadata', 'canplay'] as const;
    checkEvents.forEach((e) => v.addEventListener(e, check));
    playEvents.forEach((e) => v.addEventListener(e, play));
    detachListeners.current = () => {
      checkEvents.forEach((e) => v.removeEventListener(e, check));
      playEvents.forEach((e) => v.removeEventListener(e, play));
    };
    if (v.readyState >= 1) play();
  }, []);

  const open = useCallback(
    async (id: string | null) => {
      const my = ++requestId.current;
      releaseStream();
      setReady(false);
      setError(null);
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setError({
          kind: 'unsupported',
          message: 'This browser cannot open the camera here. Use Chrome on https or localhost.',
        });
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(id));
      } catch (err) {
        if (my !== requestId.current) return;
        const e = toCameraError(err);
        if (id && e.kind === 'no-camera') {
          // The saved device is gone (unplugged). Fall back to the default camera.
          saveDeviceId(null);
          setDeviceId(null);
          void open(null);
          return;
        }
        setError(e);
        void refreshDevices();
        return;
      }
      if (my !== requestId.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const [track] = stream.getVideoTracks();
      track?.addEventListener('ended', () => {
        if (my !== requestId.current) return;
        setReady(false);
        setError({ kind: 'disconnected', message: 'The camera was disconnected. Reconnect it and try again.' });
      });
      attach(my);
      void refreshDevices();
    },
    [attach, refreshDevices, releaseStream],
  );

  const stop = useCallback(() => {
    requestId.current++;
    releaseStream();
    setReady(false);
  }, [releaseStream]);

  const deviceIdRef = useRef(deviceId);
  deviceIdRef.current = deviceId;

  const start = useCallback(() => {
    void open(deviceIdRef.current);
  }, [open]);

  const selectDevice = useCallback(
    (id: string | null) => {
      saveDeviceId(id);
      setDeviceId(id);
      void open(id);
    },
    [open],
  );

  // Open on mount, release on unmount (StrictMode-safe via requestId).
  useEffect(() => {
    if (autoStart) void open(deviceIdRef.current);
    return () => {
      // Intentionally bumps the live counter so in-flight opens are discarded.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestId.current++;
      releaseStream();
    };
  }, [autoStart, open, releaseStream]);

  // Re-attach if the <video> element mounts or changes after the stream is ready.
  useEffect(() => {
    if (streamRef.current) attach(requestId.current);
  });

  useEffect(() => {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md?.addEventListener) return;
    const onChange = () => void refreshDevices();
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [refreshDevices]);

  return { videoRef, ready, error, devices, deviceId, selectDevice, start, stop };
}
