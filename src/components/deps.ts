// Real module wiring for the pipeline. Tests use fakes instead of this file.
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
  explainMistake,
  canCallCloud,
  recordCloudCall,
  startSession,
  logMistake,
  updateSessionCounts,
};
