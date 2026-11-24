// Handwriting read: one line image -> {latex, plain, confidence}. Owned by T1.
import type { GenerateContentResult, GenerativeModel } from 'firebase/ai';
import {
  assertFirebaseConfigured,
  getCloudModel,
  getReadModel,
  onDeviceCreateOptions,
  readResponseSchema,
} from './firebase';
import { DEFAULT_CONFIG } from './config';
import type { AppConfig, LineRead, RunSource } from './types';

/** Format rules appended to cfg.readPrompt (Remote Config can change the base prompt only). */
export const READ_FORMAT_RULES = [
  'Return only JSON with keys "latex", "plain" and "confidence".',
  '"latex": the line in LaTeX.',
  '"plain": the same line as plain ASCII maths that a computer algebra system can parse.',
  'In "plain" use * for multiply, ^ for powers, / for divide, = for equals, and ( ) for grouping.',
  'Write multiplication explicitly, for example 2*x and 3*(x+1). Use sqrt(x) for roots.',
  'No LaTeX, no words, no units and no unicode symbols in "plain".',
  '"confidence": a number from 0 to 1 for how sure you are that the transcription is exact.',
  'Copy exactly what is written, even if it is mathematically wrong. Do not solve or correct it.',
  'If the image has no readable maths, return empty strings and confidence 0.',
].join('\n');

export function buildReadPrompt(cfg: AppConfig): string {
  return `${cfg.readPrompt.trim()}\n\n${READ_FORMAT_RULES}`;
}

/** Splits a data URL into mime type and base64 payload. */
export function parseDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const m = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s.exec(dataUrl.trim());
  if (!m) throw new Error('Expected a base64 image data URL (data:image/jpeg;base64,...).');
  return { mimeType: m[1].toLowerCase(), data: m[2] };
}

/** Clamps to 0..1. Accepts 0..100 percentages. NaN and non-numbers become 0. */
export function clampConfidence(v: unknown): number {
  let n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return 0;
  if (n > 1 && n <= 100) n = n / 100;
  return Math.min(1, Math.max(0, n));
}

/** Maps common unicode maths symbols and spacing to the ASCII the checker expects. */
export function toAsciiMaths(s: string): string {
  return s
    .replace(/[×·∙⋅]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/√/g, 'sqrt')
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Loose form for scoring reads against expected text: ASCII, no spaces, no '*', lower case. */
export function normalizeForCompare(s: string): string {
  return toAsciiMaths(s).replace(/\s+/g, '').replace(/\*/g, '').toLowerCase();
}

function stripCodeFences(text: string): string {
  const fenced = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

/** Returns the first balanced {...} block, or null. */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

export interface ParsedRead {
  latex: string;
  plain: string;
  confidence: number;
}

/**
 * Parses the model's text into a read. Never throws: unreadable output gives
 * confidence 0, so the pipeline re-reads in the cloud or marks the line unsure.
 */
export function parseReadResponse(text: string): ParsedRead {
  const body = stripCodeFences(text ?? '');
  let obj: unknown = null;
  for (const candidate of [body, firstJsonObject(body)]) {
    if (!candidate) continue;
    try {
      obj = JSON.parse(candidate);
      break;
    } catch {
      /* try the next candidate */
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { latex: '', plain: '', confidence: 0 };
  }
  const o = obj as Record<string, unknown>;
  const latex = typeof o.latex === 'string' ? o.latex.trim() : '';
  const plain = typeof o.plain === 'string' ? toAsciiMaths(o.plain) : '';
  const confidence = plain ? clampConfidence(o.confidence) : 0;
  return { latex, plain, confidence };
}

export function sourceOf(result: GenerateContentResult): RunSource {
  return result.response.inferenceSource === 'on_device' ? 'device' : 'cloud';
}

async function runRead(model: GenerativeModel, jpegDataUrl: string, cfg: AppConfig): Promise<LineRead> {
  assertFirebaseConfigured();
  const image = parseDataUrl(jpegDataUrl);
  const t0 = performance.now();
  const result = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          { type: 'text', text: buildReadPrompt(cfg) },
          { type: 'inlineData', inlineData: image },
        ],
      },
    ],
  });
  const ms = Math.round(performance.now() - t0);
  let text = '';
  try {
    text = result.response.text();
  } catch {
    text = ''; // blocked or empty candidate
  }
  return { ...parseReadResponse(text), source: sourceOf(result), ms };
}

/** Reads one line, on device when Nano is ready, else in the cloud. `source` says which ran. */
export async function readLine(jpegDataUrl: string, cfg: AppConfig): Promise<LineRead> {
  return runRead(getReadModel(cfg), jpegDataUrl, cfg);
}

/** Reads one line in the cloud only (low-confidence re-read, or cloud mode). */
export async function readLineInCloud(jpegDataUrl: string, cfg: AppConfig): Promise<LineRead> {
  const model = getCloudModel(cfg, {
    generationConfig: { responseMimeType: 'application/json', responseSchema: readResponseSchema, temperature: 0 },
  });
  return runRead(model, jpegDataUrl, cfg);
}

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
interface LanguageModelStatic {
  availability(options?: object): Promise<Availability>;
}

/** Chrome's Prompt API state for our create options, or 'unavailable' when the API is missing. */
export async function deviceModelAvailability(): Promise<Availability> {
  const lm = (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel;
  if (!lm) return 'unavailable';
  try {
    return await lm.availability(onDeviceCreateOptions);
  } catch {
    return 'unavailable';
  }
}

/** True when Nano is downloaded and ready, so readLine will run on device. */
export async function isOnDeviceAvailable(): Promise<boolean> {
  return (await deviceModelAvailability()) === 'available';
}

/**
 * Downloads Gemini Nano if needed. Must run from a user gesture (button click).
 * onProgress gets 0..100. Resolves when the model is ready; rejects if the
 * browser has no on-device model (wrong Chrome version or flag off).
 */
export async function initDeviceModel(onProgress: (pct: number) => void): Promise<void> {
  const before = await deviceModelAvailability();
  if (before === 'unavailable') {
    throw new Error(
      'Gemini Nano is not available in this browser. Use Chrome desktop 139+ with chrome://flags/#prompt-api-for-gemini-nano-multimodal-input enabled.',
    );
  }
  onProgress(before === 'available' ? 100 : 0);
  await getReadModel(DEFAULT_CONFIG).initializeDeviceModel((v) =>
    onProgress(Math.round(Math.min(1, Math.max(0, v)) * 100)),
  );
  onProgress(100);
}
