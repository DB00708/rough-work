// Shared contracts for Rough Work. Every module codes against these types.
// Change this file only through the main orchestrator session.

/** Where an AI call actually ran. */
export type RunSource = 'device' | 'cloud';

/** Output of one handwriting read (Nano on device, or cloud fallback). */
export interface LineRead {
  latex: string;
  /** Plain ASCII maths for the checker, e.g. "2*(x+3) = 10". */
  plain: string;
  /** 0..1, self-reported by the model. */
  confidence: number;
  source: RunSource;
  /** Wall-clock read time in ms. */
  ms: number;
}

export type LineStatus = 'checking' | 'ok' | 'wrong' | 'unsure';

/** Result of comparing line N with line N-1. */
export type StepVerdict = 'equivalent' | 'not_equivalent' | 'unparseable';

export interface StepCheck {
  verdict: StepVerdict;
  /** Short human reason, e.g. "differs at x=1.7". */
  reason?: string;
}

/** Cloud explanation of a wrong step. */
export interface Explanation {
  /** Hinglish explanation, 1 to 3 sentences. */
  hinglish: string;
  /** Optional English version (toggle). */
  english?: string;
  /** Hint ladder: nudge, method, answer. */
  hints: [string, string, string];
  /** Stable slug, e.g. "dropped_minus_expanding_brackets". */
  mistakeType: string;
  /** Human label in English. */
  mistakeLabel: string;
  /** Human label in Hinglish. */
  mistakeLabelHinglish: string;
  ms: number;
}

/** One handwritten line in the practice session. */
export interface Line {
  id: string;
  index: number;
  /** JPEG data URL of the crop. Kept in memory only, never stored. */
  cropDataUrl: string;
  read?: LineRead;
  /** True when the student fixed the transcription by hand. */
  editedByUser?: boolean;
  status: LineStatus;
  check?: StepCheck;
  explanation?: Explanation;
  /** Set when this line follows from an earlier wrong line (0-based index of that line). No cloud call, no log. */
  carriedFrom?: number;
}

/** Remote Config values (with local defaults). */
export interface AppConfig {
  frameIntervalMs: number; // 8000
  cloudFrameIntervalMs: number; // 20000, used in cloud mode
  confidenceThreshold: number; // 0.6
  dailyCloudCap: number; // 50
  readPrompt: string;
  explainPrompt: string;
  cloudModel: string; // 'gemini-3.5-flash-lite'
}

/** Hybrid meter counters. */
export interface HybridCounts {
  deviceReads: number;
  cloudCalls: number;
}
