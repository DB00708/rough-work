// Cloud explanation of a wrong step (ONLY_IN_CLOUD). Owned by T4.
// Called only when checkStep() says `not_equivalent`. Crops are sent inline and never stored.
import { getApp } from 'firebase/app';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  Schema,
  type GenerativeModel,
  type Part,
} from 'firebase/ai';
import type { AppConfig, Explanation } from './types';
import { getMistakeType, MISTAKE_SLUGS } from './mistakeTypes';

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

export const EXPLAIN_TIMEOUT_MS = 8000;

/** Thrown when the cloud call fails or times out. Bad model output does NOT throw (see GENERIC_EXPLANATION). */
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

/** True for errors thrown by explainMistake (name check, so it survives duplicated module instances). */
export function isExplainError(e: unknown): e is ExplainError {
  return e instanceof Error && e.name === 'ExplainError' && 'kind' in e;
}

export const EXPLAIN_PROMPT = `You are a friendly Indian maths tutor ("didi/bhaiya" tone) checking a student's handwritten working.
The student went from LINE A to LINE B, and LINE B is NOT mathematically equivalent to LINE A. Find the single mistake made in going from A to B.

Rules:
- "hinglish": 1 to 3 short sentences in Roman-script Hinglish (Hindi + English mixed, written in English letters, NO Devanagari). Warm, encouraging, never scolding. Name the exact line ("Line B mein ...") and the exact error (which term, which sign, which rule).
- "english": the same explanation in simple English, 1 to 3 sentences.
- "hints": exactly 3 strings, a hint ladder: [0] a gentle nudge that points where to look without giving the method, [1] the method or rule to apply, [2] the corrected LINE B.
- "mistakeType": one slug from the allowed list. Use "other" only if none fits.
- Use plain text maths (x^2, sqrt(x), *, /). No LaTeX, no markdown.
- If the images disagree with the text transcription, trust the text but mention the line as written.
Allowed mistakeType slugs: ${MISTAKE_SLUGS.join(', ')}.`;

export const explanationSchema = Schema.object({
  properties: {
    hinglish: Schema.string({ description: 'Roman-script Hinglish, 1-3 sentences, names the exact line and error.' }),
    english: Schema.string({ description: 'Same explanation in simple English.' }),
    hints: Schema.array({
      items: Schema.string(),
      minItems: 3,
      maxItems: 3,
      description: '[nudge, method, corrected line]',
    }),
    mistakeType: Schema.enumString({ enum: [...MISTAKE_SLUGS] }),
  },
});

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

/**
 * Validate and coerce raw model output into an Explanation.
 * Missing hinglish → generic explanation. Missing hints are filled from the generic ladder.
 * Unknown mistakeType → "other". Labels always come from the taxonomy.
 */
export function coerceExplanation(raw: unknown, ms: number): Explanation {
  const safeMs = Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : 0;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...GENERIC_EXPLANATION, ms: safeMs };
  const o = raw as Record<string, unknown>;

  const hinglish = cleanText(o.hinglish);
  if (!hinglish) return { ...GENERIC_EXPLANATION, ms: safeMs };

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
    ms: safeMs,
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

/** Build the prompt text for one wrong step. */
export function buildPrompt(input: ExplainInput, cfg: Pick<AppConfig, 'explainPrompt'>): string {
  const prefix = cfg.explainPrompt?.trim();
  const lines = [
    prefix ? `${prefix}\n\n${EXPLAIN_PROMPT}` : EXPLAIN_PROMPT,
    '',
    `LINE A (previous, correct so far): ${input.prev}`,
    `LINE B (new, has the mistake): ${input.next}`,
  ];
  if (input.prevCrop || input.nextCrop) lines.push('Images of the handwritten lines follow, labelled A and B.');
  return lines.join('\n');
}

/** "data:image/jpeg;base64,AAAA" → { mimeType, data }. Returns null if it is not a base64 data URL. */
export function dataUrlToInline(dataUrl: string): { mimeType: string; data: string } | null {
  const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/s);
  if (m) return { mimeType: m[1], data: m[2] };
  // Already raw base64 (no prefix): assume JPEG.
  if (/^[A-Za-z0-9+/=\s]+$/.test(dataUrl) && dataUrl.length > 0) return { mimeType: 'image/jpeg', data: dataUrl.replace(/\s/g, '') };
  return null;
}

/** Request parts: prompt text, then the labelled crops (when given). */
export function buildParts(input: ExplainInput, cfg: Pick<AppConfig, 'explainPrompt'>): Part[] {
  const parts: Part[] = [{ type: 'text', text: buildPrompt(input, cfg) }];
  for (const [label, crop] of [['A', input.prevCrop], ['B', input.nextCrop]] as const) {
    const inline = crop ? dataUrlToInline(crop) : null;
    if (!inline) continue;
    parts.push({ type: 'text', text: `Image of LINE ${label}:` });
    parts.push({ type: 'inlineData', inlineData: inline });
  }
  return parts;
}

const models = new Map<string, GenerativeModel>();

function getExplainModel(cloudModel: string): GenerativeModel {
  let m = models.get(cloudModel);
  if (!m) {
    const ai = getAI(getApp(), { backend: new GoogleAIBackend() });
    m = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: explanationSchema,
          temperature: 0.3,
        },
      },
    });
    models.set(cloudModel, m);
  }
  return m;
}

/**
 * Explain why `next` does not follow from `prev`, in Hinglish, using the cloud model.
 * - Resolves with a generic explanation if the model returns unusable JSON.
 * - Rejects with ExplainError('timeout') after 8 s (opts.timeoutMs), or ExplainError('network') on a failed call.
 * The caller is responsible for canCallCloud()/recordCloudCall().
 */
export async function explainMistake(
  input: ExplainInput,
  cfg: AppConfig,
  opts: { timeoutMs?: number } = {},
): Promise<Explanation> {
  const timeoutMs = opts.timeoutMs ?? EXPLAIN_TIMEOUT_MS;
  const t0 = performance.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ExplainError('timeout', `Explanation timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });

  try {
    const model = getExplainModel(cfg.cloudModel);
    const result = await Promise.race([
      model.generateContent(buildParts(input, cfg), { signal: controller.signal }),
      timeout,
    ]);
    let text = '';
    try {
      text = result.response.text();
    } catch {
      // Blocked or empty candidate: fall through to the generic explanation.
    }
    return parseExplanation(text, performance.now() - t0);
  } catch (err) {
    if (isExplainError(err)) throw err;
    if (controller.signal.aborted) throw new ExplainError('timeout', `Explanation timed out after ${timeoutMs} ms`, err);
    throw new ExplainError('network', err instanceof Error ? err.message : 'Explanation request failed', err);
  } finally {
    clearTimeout(timer);
  }
}
