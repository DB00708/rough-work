// Public surface of the capture module (T3). Other tasks import from here.
//
// Typical use (T7):
//   const cam = useCamera();
//   const { roi, committedRoi, setRoi, commitRoi } = usePersistentRoi();
//   const detector = useMemo(() => createLineDetector({ roi: committedRoi }), []);
//   useEffect(() => detector.setRoi(committedRoi), [committedRoi]);   // resets the baseline
//   useEffect(() => detector.onLine((l) => pipeline.addLine(l)), []);  // returns unsubscribe
//   useEffect(() => {
//     if (cam.ready && cam.videoRef.current) detector.start(cam.videoRef.current);
//     return () => detector.stop();   // REQUIRED: stop the sampling timer on unmount
//   }, [cam.ready]);
//   <video ref={cam.videoRef} style={{ width: '100%', height: 'auto' }} />  (no CSS mirroring)
//   <FrameGuide roi={roi} onChange={setRoi} onChangeEnd={commitRoi} />
//   Spacebar fallback: detector.forceLineDone(). New page: detector.reset().

export { useCamera, cameraConstraints, toCameraError } from './useCamera';
export type { UseCamera, UseCameraOptions, CameraError, CameraErrorKind } from './useCamera';
export { createLineDetector } from './lineDetector';
export type { LineDetector, LineDetectorOptions, CapturedLine, BBox, LineListener, DetectorDebug } from './lineDetector';
export { FrameGuide } from './FrameGuide';
export { usePersistentRoi } from './usePersistentRoi';
export type { PersistentRoi } from './usePersistentRoi';
export type { FrameGuideProps } from './FrameGuide';
export { CaptureDebug } from './CaptureDebug';
export type { CaptureDebugProps } from './CaptureDebug';
export { DEFAULT_ROI, clampRoi, loadRoi, saveRoi } from './roi';
export type { Roi } from './roi';
export { createDetectorCore, defaultCoreOptions } from './detectorCore';
export type { CoreOptions, CoreEvent, CoreStatus, DetectorCore, LineEvent, ObstructionReason } from './detectorCore';
