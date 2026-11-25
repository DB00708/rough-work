// Cloud explanation of a wrong step (ONLY_IN_CLOUD). Owned by T4.
// Called only when checkStep() says `not_equivalent`. Crops are sent inline (only when
// cfg.explainWithImages is true) and never stored.
//
// Latency budget (PRD: < 5 s): short system prompt, Hinglish-only JSON (no `english`),
// capped output tokens, minimal thinking, text-only by default. English is fetched on
// demand with explainInEnglish(). After EXPLAIN_TIMEOUT_MS the caller gets an instant
// local explanation built from the taxonomy (see isLocalFallback()).
import { getApp } from 'firebase/app';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  Schema,
  ThinkingLevel,
  type GenerativeModel,
  type Part,
  type ThinkingConfig,
} from 'firebase/ai';
import type { AppConfig, Explanation } from './types';
import { getMistakeType, guessMistakeType, MISTAKE_SLUGS } from './mistakeTypes';

export interface ExplainInput {
  /** Previous line (N-1), plain ASCII maths. */
  prev: string;
  /** New line (N), plain ASCII maths. */
  next: string;
  /** JPEG data URL of line N-1. */
  prevCrop?: string;
  /** JPEG data URL of line N. */
  nextCrop?: string;
}

/**
 * AppConfig plus explain-only flags. `explainWithImages` is not in AppConfig yet
 * (orchestrator request); until then it is absent, which means text only.
 */
export type ExplainConfig = AppConfig & { explainWithImages?: boolean };

export interface ExplainOptions {
  /** Default EXPLAIN_TIMEOUT_MS. */
  timeoutMs?: number;
  /**
   * When set, a call that misses timeoutMs is not aborted: the caller gets the local
   * fallback at once, and the real model answer, if it arrives before lateMs, here.
   */
  onLate?: (e: Explanation) => void;
  /** Total wait for a late answer, from the start of the call. Default EXPLAIN_LATE_MS. */
  lateMs?: number;
}

export const EXPLAIN_TIMEOUT_MS = 5000;
export const EXPLAIN_LATE_MS = 20000;
export const EXPLAIN_MAX_OUTPUT_TOKENS = 320;
export const ENGLISH_MAX_OUTPUT_TOKENS = 160;

/** Thrown when the cloud call fails. Timeouts and bad model output do NOT throw. */
export class ExplainError extends Error {
  readonly kind: 'timeout' | 'network';
  readonly cause?: unknown;
  constructor(kind: 'timeout' | 'network', message: string, cause?: unknown) {
    super(message);
    this.name = 'ExplainError';
    this.kind = kind;
    this.cause = cause;
  }
}

/** True for errors thrown by this module (name check, so it survives duplicated module instances). */
export function isExplainError(e: unknown): e is ExplainError {
  return e instanceof Error && e.name === 'ExplainError' && 'kind' in e;
}

/** Output format rules. cfg.explainPrompt (tone, audience) is prepended to this. */
export const EXPLAIN_PROMPT = `LINE B does not follow from LINE A. Find the one mistake in that step.
Write ALL text in Roman-script Hinglish: Hindi words in English letters mixed with English maths words. No Devanagari. No pure-English sentences.
hinglish: 1-3 short, kind sentences. Start with "Is step mein" and name the exact term, sign or rule. Never write "Line A", "Line B" or "student".
hints: 3 Hinglish strings: [0] nudge where to look, [1] the rule or method, [2] the corrected LINE B.
Example hint: "Bracket ke bahar minus hai, andar ke signs dekho."
mistakeType: best slug, "other" if none fits. Plain-text maths (x^2, sqrt(x)); no LaTeX, no markdown.`;

export const explanationSchema = Schema.object({
  properties: {
    hinglish: Schema.string(),
    hints: Schema.array({ items: Schema.string(), minItems: 3, maxItems: 3 }),
    mistakeType: Schema.enumString({ enum: [...MISTAKE_SLUGS] }),
  },
});

export const ENGLISH_PROMPT = `Translate this maths tutor note from Hinglish into simple English, 1-3 sentences.
Keep the maths exactly as written. Output only the translation, no quotes or markdown.`;

/** Shown when the model returns something we cannot use. Generic but still helpful. */
export const GENERIC_EXPLANATION: Omit<Explanation, 'ms'> = {
  hinglish: 'Is line mein kuch gadbad lag rahi hai. Pichli line se compare karo aur har term ka sign aur value dhyan se check karo.',
  english: 'Something looks off in this line. Compare it with the previous line and check the sign and value of every term.',
  hints: [
    'Pichli line aur is line ko term-by-term milao.',
    'Jo bhi operation kiya, woh dono taraf aur har term par barabar lagao.',
    'Pichli line se yeh step dobara karke dekho.',
  ],
  mistakeType: 'other',
  mistakeLabel: getMistakeType('other').label,
  mistakeLabelHinglish: getMistakeType('other').labelHinglish,
};

// ---- Hinglish check -------------------------------------------------------

/** Common Hindi function words in Roman script. One is enough to call a text Hinglish. */
const HINGLISH_MARKERS = new Set(
  (
    'hai hain ho hota hoti hote tha thi ka ki ke ko se mein par pe aur ya bhi nahi nahin na mat ' +
    'karo karna kiya kar lagao lagaya likho dekho socho milao badlo yeh ye woh wo isko usko jab ' +
    'toh kya kyun kaise kahan wala wali wale pehle phir baad sirf dono har galat sahi yaad rakho chahiye ' +
    'jaata jaati jaate hua hui gaya gayi diya liya raha rahi apna apni andar bahar taraf barabar'
  ).split(' '),
);

/** True when a text of 4+ words has no Hindi function word at all (likely pure English). */
export function looksPureEnglish(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length < 4) return false;
  return !words.some((w) => HINGLISH_MARKERS.has(w));
}

/** Logs when the explanation or the first two hints look like pure English. Hint 3 is maths. */
function warnIfEnglish(e: Explanation): void {
  const bad = [e.hinglish, e.hints[0], e.hints[1]].filter(looksPureEnglish);
  if (bad.length) console.warn('[explain] output looks like pure English, expected Hinglish:', bad);
}

// ---- Output coercion ------------------------------------------------------

const MAX_TEXT = 600;

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
}

function stripFences(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : text.trim();
}

const safeMs = (ms: number) => (Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : 0);

/**
 * Validate and coerce raw model output into an Explanation.
 * Missing hinglish → generic explanation. Missing hints are filled from the generic ladder.
 * Unknown mistakeType → "other". Labels always come from the taxonomy.
 */
export function coerceExplanation(raw: unknown, ms: number): Explanation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...GENERIC_EXPLANATION, ms: safeMs(ms) };
  const o = raw as Record<string, unknown>;

  const hinglish = cleanText(o.hinglish);
  if (!hinglish) return { ...GENERIC_EXPLANATION, ms: safeMs(ms) };

  const rawHints = Array.isArray(o.hints) ? o.hints.map(cleanText) : [];
  const hints: [string, string, string] = [0, 1, 2].map(
    (i) => rawHints[i] ?? GENERIC_EXPLANATION.hints[i],
  ) as [string, string, string];

  const type = getMistakeType(o.mistakeType);
  const english = cleanText(o.english) ?? undefined;

  return {
    hinglish,
    ...(english ? { english } : {}),
    hints,
    mistakeType: type.slug,
    mistakeLabel: type.label,
    mistakeLabelHinglish: type.labelHinglish,
    ms: safeMs(ms),
  };
}

/** Parse the model's JSON text. Never throws: bad JSON gives the generic explanation. */
export function parseExplanation(text: string, ms: number): Explanation {
  try {
    return coerceExplanation(JSON.parse(stripFences(text)), ms);
  } catch {
    return coerceExplanation(null, ms);
  }
}

// ---- Local fallback -------------------------------------------------------

const localFallbacks = new WeakSet<Explanation>();

/** True when `e` was built locally (timeout), not by the model. Callers may skip logging it. */
export function isLocalFallback(e: Explanation): boolean {
  return localFallbacks.has(e);
}

/** Instant explanation from the taxonomy, used when the cloud call times out. */
export function localFallbackExplanation(input: Pick<ExplainInput, 'prev' | 'next'>, ms: number): Explanation {
  const type = getMistakeType(guessMistakeType(input.prev, input.next));
  const e: Explanation =
    type.slug === 'other'
      ? { ...GENERIC_EXPLANATION, ms: safeMs(ms) }
      : {
          hinglish: `Is step mein shayad yeh galti hai: ${type.labelHinglish}. ${type.tipHinglish}`,
          english: `This step may have a mistake: ${type.label.toLowerCase()}.`,
          hints: [GENERIC_EXPLANATION.hints[0], type.tipHinglish, GENERIC_EXPLANATION.hints[2]],
          mistakeType: type.slug,
          mistakeLabel: type.label,
          mistakeLabelHinglish: type.labelHinglish,
          ms: safeMs(ms),
        };
  localFallbacks.add(e);
  return e;
}

// ---- Request building -----------------------------------------------------

/** System instruction: cfg.explainPrompt (tone/audience) + EXPLAIN_PROMPT (format). */
export function buildSystemPrompt(cfg: Pick<AppConfig, 'explainPrompt'>): string {
  const prefix = cfg.explainPrompt?.trim();
  return prefix ? `${prefix}\n${EXPLAIN_PROMPT}` : EXPLAIN_PROMPT;
}

/** "data:image/jpeg;base64,AAAA" → { mimeType, data }. Returns null if it is not a base64 data URL. */
export function dataUrlToInline(dataUrl: string): { mimeType: string; data: string } | null {
  const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/s);
  if (m) return { mimeType: m[1], data: m[2] };
  // Already raw base64 (no prefix): assume JPEG.
  if (/^[A-Za-z0-9+/=\s]+$/.test(dataUrl) && dataUrl.length > 0) return { mimeType: 'image/jpeg', data: dataUrl.replace(/\s/g, '') };
  return null;
}

/** User turn: both transcriptions, then the labelled crops when `withImages` is set. */
export function buildParts(input: ExplainInput, withImages = false): Part[] {
  const parts: Part[] = [{ type: 'text', text: `LINE A: ${input.prev}\nLINE B: ${input.next}` }];
  if (!withImages) return parts;
  for (const [label, crop] of [['A', input.prevCrop], ['B', input.nextCrop]] as const) {
    const inline = crop ? dataUrlToInline(crop) : null;
    if (!inline) continue;
    parts.push({ type: 'text', text: `Image of LINE ${label}:` });
    parts.push({ type: 'inlineData', inlineData: inline });
  }
  return parts;
}

/** Smallest thinking setting the model family supports, or undefined to leave the default. */
export function thinkingConfigFor(model: string): ThinkingConfig | undefined {
  const m = model.toLowerCase();
  if (/gemini-2\.5-pro/.test(m)) return { thinkingBudget: 128 };
  if (/gemini-2\.5/.test(m)) return { thinkingBudget: 0 };
  if (/gemini-([3-9]|\d{2,})/.test(m)) return { thinkingLevel: ThinkingLevel.MINIMAL };
  return undefined;
}

// ---- Models ---------------------------------------------------------------

const models = new Map<string, GenerativeModel>();

function cachedModel(key: string, make: () => GenerativeModel): GenerativeModel {
  let m = models.get(key);
  if (!m) {
    m = make();
    models.set(key, m);
  }
  return m;
}

/** Models whose thinkingConfig was rejected once; later calls skip it. */
const noThinking = new Set<string>();

/** A model plus whether it was built with a thinkingConfig. */
interface BuiltModel {
  model: GenerativeModel;
  withThinking: boolean;
}

/**
 * Output cap. With minimal thinking the cap is tight. Without a thinkingConfig the model
 * uses its default thinking, which counts against maxOutputTokens, so the cap is raised
 * to keep the JSON from being truncated.
 */
export const NO_THINKING_TOKEN_MULTIPLIER = 8;

function buildModel(kind: 'explain' | 'english', cfg: AppConfig): BuiltModel {
  const thinking = noThinking.has(cfg.cloudModel) ? undefined : thinkingConfigFor(cfg.cloudModel);
  const system = kind === 'explain' ? buildSystemPrompt(cfg) : ENGLISH_PROMPT;
  const baseCap = kind === 'explain' ? EXPLAIN_MAX_OUTPUT_TOKENS : ENGLISH_MAX_OUTPUT_TOKENS;
  const maxOutputTokens = thinking ? baseCap : baseCap * NO_THINKING_TOKEN_MULTIPLIER;
  const model = cachedModel(`${kind}|${cfg.cloudModel}|${thinking ? 't' : '-'}|${system}`, () =>
    getGenerativeModel(getAI(getApp(), { backend: new GoogleAIBackend() }), {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cfg.cloudModel,
        systemInstruction: system,
        generationConfig: {
          ...(kind === 'explain' ? { responseMimeType: 'application/json', responseSchema: explanationSchema } : {}),
          maxOutputTokens,
          temperature: 0.2,
          ...(thinking ? { thinkingConfig: thinking } : {}),
        },
      },
    }),
  );
  return { model, withThinking: thinking !== undefined };
}

const TIMED_OUT = Symbol('timeout');

async function textOf(p: ReturnType<GenerativeModel['generateContent']>): Promise<string> {
  const result = await p;
  try {
    return result.response.text();
  } catch {
    return ''; // Blocked or empty candidate.
  }
}

/**
 * Run one generateContent with a timeout. Resolves with the response text, or TIMED_OUT.
 * Rejects with ExplainError('network') on a failed call. If the model rejects the
 * thinking setting, retries once without it (inside the same timeout).
 */
async function generateText(
  getModel: () => BuiltModel,
  parts: Part[],
  cloudModel: string,
  timeoutMs: number,
  late?: { ms: number; onText: (text: string) => void },
): Promise<string | typeof TIMED_OUT> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lateTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      // With a late handler, keep the request alive until late.ms; otherwise stop it now.
      if (late) lateTimer = setTimeout(() => controller.abort(), Math.max(0, late.ms - timeoutMs));
      else controller.abort();
      resolve(TIMED_OUT);
    }, timeoutMs);
  });

  const call = async (): Promise<string> => {
    const first = getModel();
    try {
      return await textOf(first.model.generateContent(parts, { signal: controller.signal }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // Retry only if THIS attempt carried a thinkingConfig (safe with concurrent calls).
      if (controller.signal.aborted || !first.withThinking || !/thinking/i.test(msg)) throw err;
      if (!noThinking.has(cloudModel)) console.warn('[explain] model rejected thinkingConfig, retrying without it:', msg);
      noThinking.add(cloudModel);
      return textOf(getModel().model.generateContent(parts, { signal: controller.signal }));
    }
  };

  const pending = call();
  if (late) {
    pending.then(
      (text) => {
        if (!timedOut || controller.signal.aborted) return;
        clearTimeout(lateTimer);
        late.onText(text);
      },
      () => clearTimeout(lateTimer),
    );
  }
  try {
    return await Promise.race([pending, timeout]);
  } catch (err) {
    if (controller.signal.aborted || timedOut) return TIMED_OUT;
    throw new ExplainError('network', err instanceof Error ? err.message : 'Explanation request failed', err);
  } finally {
    clearTimeout(timer);
  }
}

// ---- Public API -----------------------------------------------------------

/**
 * Explain why `next` does not follow from `prev`, in Hinglish, using the cloud model.
 * - Resolves with a generic explanation if the model returns unusable JSON.
 * - Resolves with a local taxonomy explanation after EXPLAIN_TIMEOUT_MS (isLocalFallback() is true).
 * - Rejects with ExplainError('network') on a failed call (including no Firebase app).
 * `english` is not filled by the model; call explainInEnglish() when the user asks for it.
 * The caller is responsible for canCallCloud()/recordCloudCall().
 */
export async function explainMistake(
  input: ExplainInput,
  cfg: ExplainConfig,
  opts: ExplainOptions = {},
): Promise<Explanation> {
  const t0 = performance.now();
  const timeoutMs = opts.timeoutMs ?? EXPLAIN_TIMEOUT_MS;
  const parts = buildParts(input, cfg.explainWithImages === true);
  const onLate = opts.onLate;
  const late = onLate
    ? {
        ms: opts.lateMs ?? EXPLAIN_LATE_MS,
        onText: (t: string) => {
          const e = parseExplanation(t, performance.now() - t0);
          // Blocked, empty or bad JSON: keep the more specific local fallback.
          if (e.hinglish === GENERIC_EXPLANATION.hinglish) return;
          warnIfEnglish(e);
          onLate(e);
        },
      }
    : undefined;
  const text = await generateText(() => buildModel('explain', cfg), parts, cfg.cloudModel, timeoutMs, late);
  const ms = performance.now() - t0;
  if (text === TIMED_OUT) {
    console.warn(`[explain] timed out after ${timeoutMs} ms, using local fallback${late ? '; still waiting for the cloud answer' : ''}`);
    return localFallbackExplanation(input, ms);
  }
  const e = parseExplanation(text, ms);
  warnIfEnglish(e);
  return e;
}

/**
 * On-demand English version of an explanation (one short text-only cloud call).
 * Returns `e.english` without a call when it is already set (fallbacks, demo lines).
 * On timeout or empty output, returns a sentence built from the English label.
 * Rejects with ExplainError('network') on a failed call. Counts as a cloud call for the quota.
 */
export async function explainInEnglish(
  e: Pick<Explanation, 'hinglish' | 'mistakeLabel'> & Partial<Pick<Explanation, 'english'>>,
  cfg: AppConfig,
  opts: ExplainOptions = {},
): Promise<string> {
  if (e.english) return e.english;
  const fallback = `${e.mistakeLabel}. Compare this line with the previous one, term by term.`;
  const text = await generateText(
    () => buildModel('english', cfg),
    [{ type: 'text', text: e.hinglish }],
    cfg.cloudModel,
    opts.timeoutMs ?? EXPLAIN_TIMEOUT_MS,
  );
  if (text === TIMED_OUT) return fallback;
  return cleanText(text) ?? fallback;
}

/** Test helper: forget cached models and the no-thinking list. */
export function _resetExplainModels(): void {
  models.clear();
  noThinking.clear();
}
