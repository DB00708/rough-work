// STUB on main. Owned by T6.
import type { AppConfig } from './types';
export const DEFAULT_CONFIG: AppConfig = {
  frameIntervalMs: 8000,
  cloudFrameIntervalMs: 20000,
  confidenceThreshold: 0.6,
  dailyCloudCap: 50,
  readPrompt: 'Transcribe the single handwritten maths line in this image.',
  explainPrompt: 'Explain the mistake between these two lines in Hinglish.',
  cloudModel: 'gemini-3.5-flash-lite',
};
export async function loadConfig(): Promise<AppConfig> { return DEFAULT_CONFIG; }
