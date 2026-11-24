// Remote Config with safe local defaults. Owned by T6.
//
// loadConfig() never throws. It returns DEFAULT_CONFIG when Firebase is not
// configured, when Remote Config is not supported, when the fetch fails or
// takes longer than FETCH_TIMEOUT_MS, or when a value is missing or out of
// bounds (per key).
import { getApp, getApps } from 'firebase/app';
import type { AppConfig } from './types';

// These are base prompts. read.ts appends READ_FORMAT_RULES and explain.ts
// appends EXPLAIN_PROMPT (JSON fields, allowed mistake slugs). Keep output
// format rules out of these, so a Remote Config edit cannot break parsing.
const READ_PROMPT = `You see a photo of ONE handwritten line of maths from a student's notebook.
Transcribe that line exactly as written. Do not solve it, correct it or finish it. If the student made a mistake, copy the mistake.
If the photo shows more than one line, transcribe only the lowest complete line.
Give "latex" for display, "plain" as plain ASCII maths for a computer algebra system, and an honest "confidence".
Use a confidence below 0.6 if any symbol is unclear, crossed out, smudged or cut off at the edge. Do not guess high.`;

const EXPLAIN_PROMPT = `Student: Class 10-12 or JEE/NEET, India. Tutor tone: short, kind, like a friendly older sibling; do not call the student bhaiya or didi. Blame the step, not the student.
Explain only the step from LINE A to LINE B, in Roman-script Hinglish.`;

export const DEFAULT_CONFIG: AppConfig = {
  frameIntervalMs: 8000,
  cloudFrameIntervalMs: 20000,
  confidenceThreshold: 0.6,
  dailyCloudCap: 50,
  readPrompt: READ_PROMPT,
  explainPrompt: EXPLAIN_PROMPT,
  cloudModel: 'gemini-3.5-flash-lite',
};

/** Remote Config parameter names (snake_case), mapped to AppConfig fields. */
export const RC_KEYS = {
  frameIntervalMs: 'frame_interval_ms',
  cloudFrameIntervalMs: 'cloud_frame_interval_ms',
  confidenceThreshold: 'confidence_threshold',
  dailyCloudCap: 'daily_cloud_cap',
  readPrompt: 'read_prompt',
  explainPrompt: 'explain_prompt',
  cloudModel: 'cloud_model',
} as const satisfies Record<keyof AppConfig, string>;

export type RawConfig = Partial<Record<string, string | undefined>>;

export const FETCH_TIMEOUT_MS = 3000;
const FETCH_INTERVAL_PROD_MS = 60 * 60 * 1000;
const FETCH_INTERVAL_DEV_MS = 60 * 1000;
const MAX_PROMPT_CHARS = 8000;

/**
 * Parses a numeric string. Returns `fallback` when the value is missing, not a
 * finite number, outside [min, max], or not an integer when `integer` is set.
 */
export function parseBoundedNumber(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number {
  if (raw === undefined) return fallback;
  const s = raw.trim();
  if (s === '') return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  if (n < min || n > max) return fallback;
  if (integer && !Number.isInteger(n)) return fallback;
  return n;
}

/** Returns the trimmed string, or `fallback` when it is empty or too long. */
export function parseText(raw: string | undefined, fallback: string, maxLen = MAX_PROMPT_CHARS): string {
  const s = raw?.trim();
  if (!s || s.length > maxLen) return fallback;
  return s;
}

/** Model names look like "gemini-3.5-flash-lite". Anything else falls back. */
export function parseModelName(raw: string | undefined, fallback: string): string {
  const s = raw?.trim();
  if (!s || !/^[a-z0-9][a-z0-9.\-_]{0,63}$/i.test(s)) return fallback;
  return s;
}

/** Converts raw Remote Config strings (snake_case keys) into a safe AppConfig. */
export function parseConfig(raw: RawConfig, defaults: AppConfig = DEFAULT_CONFIG): AppConfig {
  const frameIntervalMs = parseBoundedNumber(raw[RC_KEYS.frameIntervalMs], defaults.frameIntervalMs, 2000, 120_000, true);
  const cloudFrameIntervalMs = parseBoundedNumber(
    raw[RC_KEYS.cloudFrameIntervalMs],
    defaults.cloudFrameIntervalMs,
    2000,
    600_000,
    true,
  );
  return {
    frameIntervalMs,
    // Cloud mode must never poll faster than device mode.
    cloudFrameIntervalMs: Math.max(cloudFrameIntervalMs, frameIntervalMs),
    confidenceThreshold: parseBoundedNumber(raw[RC_KEYS.confidenceThreshold], defaults.confidenceThreshold, 0, 1),
    dailyCloudCap: parseBoundedNumber(raw[RC_KEYS.dailyCloudCap], defaults.dailyCloudCap, 0, 10_000, true),
    readPrompt: parseText(raw[RC_KEYS.readPrompt], defaults.readPrompt),
    explainPrompt: parseText(raw[RC_KEYS.explainPrompt], defaults.explainPrompt),
    cloudModel: parseModelName(raw[RC_KEYS.cloudModel], defaults.cloudModel),
  };
}

/** DEFAULT_CONFIG as Remote Config in-app defaults (snake_case keys, string values). */
export function toRemoteDefaults(cfg: AppConfig = DEFAULT_CONFIG): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of Object.keys(RC_KEYS) as (keyof AppConfig)[]) {
    out[RC_KEYS[field]] = String(cfg[field]);
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

let cached: Promise<AppConfig> | null = null;

async function fetchConfig(): Promise<AppConfig | null> {
  // No initialized Firebase app (no .env.local, or firebase.ts not imported yet).
  if (getApps().length === 0) return null;

  const rcModule = await import('firebase/remote-config');
  if (!(await rcModule.isSupported())) return null;

  const rc = rcModule.getRemoteConfig(getApp());
  rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? FETCH_INTERVAL_DEV_MS : FETCH_INTERVAL_PROD_MS;
  rc.settings.fetchTimeoutMillis = FETCH_TIMEOUT_MS;
  rc.defaultConfig = toRemoteDefaults();

  try {
    await withTimeout(rcModule.fetchAndActivate(rc), FETCH_TIMEOUT_MS);
  } catch (e) {
    // Slow or offline: keep going with the last activated values or the defaults.
    console.warn('[config] Remote Config fetch failed, using cached or default values:', e);
  }

  const raw: RawConfig = {};
  for (const key of Object.values(RC_KEYS)) {
    raw[key] = rcModule.getValue(rc, key).asString();
  }
  return parseConfig(raw);
}

/**
 * Loads the app config once per page load. Never throws.
 * If no Firebase app is initialized yet, it returns DEFAULT_CONFIG and does
 * not cache, so a later call (after firebase.ts runs) can still fetch.
 */
export function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;
  const attempt = fetchConfig().then(
    (cfg) => {
      if (cfg === null) cached = null;
      return cfg ?? DEFAULT_CONFIG;
    },
    (e: unknown) => {
      // Unexpected SDK error (not a slow or failed fetch, which fetchConfig
      // handles). Defaults stay cached for the rest of this page load.
      console.warn('[config] Remote Config unavailable, using defaults:', e);
      return DEFAULT_CONFIG;
    },
  );
  cached = attempt;
  return attempt;
}

/** Test helper: clears the cached config. */
export function resetConfigCache(): void {
  cached = null;
}
