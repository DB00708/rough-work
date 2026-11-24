// Lazy pages owned by other tasks: My mistakes (T5) and the Nano spike (T1).
import { lazy } from 'react';

export const MistakesPage = lazy(() => import('../pages/Mistakes'));
export const SpikePage = lazy(() => import('../pages/Spike'));
