// Public surface of the capture module (T3). Other tasks import from here.
//
// Typical use (T7):
//   const cam = useCamera();
//   const [roi, setRoi] = usePersistentRoi();
//   const detector = useMemo(() => createLineDetector({ roi }), []);
//   useEffect(() => detector.setRoi(roi), [roi]);
//   useEffect(() => detector.onLine((l) => pipeline.addLine(l)), []);
//   useEffect(() => { if (cam.ready && cam.videoRef.current) detector.start(cam.videoRef.current);
//                     return () => detector.stop(); }, [cam.ready]);
//   // spacebar fallback: detector.forceLineDone()

export { useCamera, cameraConstraints, toCameraError } from './useCamera';
export type { UseCamera, UseCameraOptions, CameraError, CameraErrorKind } from './useCamera';
export { createLineDetector } from './lineDetector';
export type { LineDetector, LineDetectorOptions, CapturedLine, BBox, LineListener, DetectorDebug } from './lineDetector';
export { FrameGuide } from './FrameGuide';
export { usePersistentRoi } from './usePersistentRoi';
export type { FrameGuideProps } from './FrameGuide';
export { CaptureDebug } from './CaptureDebug';
export type { CaptureDebugProps } from './CaptureDebug';
export { DEFAULT_ROI, clampRoi, loadRoi, saveRoi } from './roi';
export type { Roi } from './roi';
export { createDetectorCore, defaultCoreOptions } from './detectorCore';
export type { CoreOptions, CoreEvent, CoreStatus, DetectorCore } from './detectorCore';
