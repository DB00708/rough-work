// Single import point for T3's capture module, so Practice.tsx has one place
// to change if the capture API moves.
export {
  CaptureDebug,
  createLineDetector,
  FrameGuide,
  useCamera,
  usePersistentRoi,
} from '../capture';
export type { CapturedLine, LineDetector, UseCamera } from '../capture';
