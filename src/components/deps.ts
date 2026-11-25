// Real module wiring for the pipeline. Tests use fakes instead of this file.
//
// Firebase init order: importing ../firebase runs initializeApp (and App
// Check) at module load. It is imported here first, so the default app exists
// before any explain (getApp) or data (getDb) call. Without .env.local the app
// is created with placeholders and every network call fails soft, so demo
// mode still works.
import '../firebase';
import { checkStep, normalizePlain } from '../check';
import { explainMistake } from '../explain';
import { readLine, readLineInCloud } from '../read';
import type { PipelineDeps } from '../pipeline';
import { canCallCloud, logMistake, recordCloudCall, startSession, updateSessionCounts } from './modulesAdapter';

export const realDeps: PipelineDeps = {
  readLine,
  readLineInCloud,
  checkStep,
  normalizePlain,
  explainMistake: (input, cfg, opts) => explainMistake(input, cfg, opts),
  canCallCloud,
  recordCloudCall: (uid) => recordCloudCall(uid),
  startSession,
  logMistake,
  updateSessionCounts,
};
