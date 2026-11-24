import { useCallback, useState } from 'react';
import { loadRoi, saveRoi, type Roi } from './roi';

export interface PersistentRoi {
  /** Live ROI: updates on every pointer move while dragging. Use it for drawing. */
  roi: Roi;
  /** ROI as of the last finished drag. Pass this to detector.setRoi(). */
  committedRoi: Roi;
  /** Live update (no save). Wire to FrameGuide onChange. */
  setRoi: (roi: Roi) => void;
  /** Final update: saves to localStorage. Wire to FrameGuide onChangeEnd. */
  commitRoi: (roi: Roi) => void;
}

/** ROI state persisted in localStorage (falls back to the default if storage is blocked). */
export function usePersistentRoi(): PersistentRoi {
  const [roi, setRoi] = useState<Roi>(() => loadRoi());
  const [committedRoi, setCommitted] = useState<Roi>(roi);
  const commitRoi = useCallback((next: Roi) => {
    setRoi(next);
    setCommitted(next);
    saveRoi(next);
  }, []);
  return { roi, committedRoi, setRoi, commitRoi };
}
