import { useCallback, useState } from 'react';
import { loadRoi, saveRoi, type Roi } from './roi';

/** ROI state persisted in localStorage (falls back to the default if storage is blocked). */
export function usePersistentRoi(): [Roi, (roi: Roi) => void] {
  const [roi, setRoi] = useState<Roi>(() => loadRoi());
  const update = useCallback((next: Roi) => {
    setRoi(next);
    saveRoi(next);
  }, []);
  return [roi, update];
}
