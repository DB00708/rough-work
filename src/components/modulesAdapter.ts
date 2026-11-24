// ADAPTER (orchestrator fixes at merge). Single import point for modules that
// are not on main yet: T4 quota + speech, T5 data. Until they merge, these are
// safe no-op stand-ins. At merge, replace the body with:
//
//   export { canCallCloud, recordCloudCall } from '../quota';
//   export { speak } from '../speech';
//   export { startSession, updateSessionCounts, logMistake } from '../data';
//
import type { AppConfig, Explanation, Line } from '../types';

export async function canCallCloud(_uid: string, _cfg: Pick<AppConfig, 'dailyCloudCap'>): Promise<boolean> {
  return true;
}

export function recordCloudCall(_uid: string): void {}

export function speak(text: string, lang: string = 'hi-IN'): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  window.speechSynthesis.speak(u);
}

export async function startSession(_uid: string, _problemText: string): Promise<string> {
  return '';
}

export async function updateSessionCounts(
  _uid: string,
  _sid: string,
  _counts: { deviceReads: number; cloudCalls: number; linesTotal: number },
): Promise<void> {}

export async function logMistake(
  _uid: string,
  _sid: string,
  _line: Line,
  _prev: Line,
  _explanation: Explanation,
): Promise<string> {
  return '';
}
