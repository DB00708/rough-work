// Pure helpers for the data layer. No Firebase imports here, so tests stay fast.

/** Field limits. Keep in sync with firestore.rules. */
export const LIMITS = {
  typeSlug: 80,
  label: 120,
  sessionId: 128,
  line: 500,
  explanation: 1000,
  problemText: 500,
} as const;

/** Number of recent mistakes shown on the page. */
export const RECENT_LIMIT = 20;
/** Number of mistake docs read to build per-type counts. */
export const MISTAKE_SCAN_LIMIT = 200;
/** Number of global types in "Common mistakes". */
export const COMMON_LIMIT = 10;

/**
 * Make any value safe to store as short plain text.
 * Returns '' for non-strings and for anything that looks like a data URL
 * (we never store images or frames). Trims and cuts to `max` chars.
 */
export function sanitizeText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  if (/^data:/i.test(s)) return '';
  // Also drop an embedded data URL anywhere in the string.
  const cleaned = s.replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '').trim();
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

/** Make a Firestore-safe doc id slug: [a-z0-9_], 1..80 chars, 'unknown' if empty. */
export function sanitizeTypeSlug(value: unknown): string {
  const raw = typeof value === 'string' ? value.toLowerCase().trim() : '';
  const slug = raw
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, LIMITS.typeSlug);
  return slug || 'unknown';
}

/** "dropped_minus_sign" -> "Dropped minus sign". Fallback label when none is stored. */
export function humanizeSlug(slug: string): string {
  const s = slug.replace(/_+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Unknown';
}

/** Session counters, written as absolute values (idempotent). */
export interface SessionCounts {
  deviceReads: number;
  cloudCalls: number;
  linesTotal: number;
}

/** Clamp counters to non-negative integers. */
export function sanitizeCounts(c: Partial<SessionCounts>): SessionCounts {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return { deviceReads: n(c.deviceReads), cloudCalls: n(c.cloudCalls), linesTotal: n(c.linesTotal) };
}

/** One stored mistake, as read back for the page. */
export interface MistakeItem {
  id: string;
  sessionId: string;
  type: string;
  lineBefore: string;
  lineAfter: string;
  explanation: string;
  /** Epoch ms, or null while the server timestamp is pending. */
  createdAt: number | null;
}

/** Count of one mistake type, with labels. */
export interface MistakeTypeCount {
  type: string;
  label: string;
  labelHinglish: string;
  count: number;
}

export interface MyMistakes {
  byType: MistakeTypeCount[];
  recent: MistakeItem[];
}

export interface TypeLabels {
  label: string;
  labelHinglish: string;
}

/** Sort by count desc, then label asc, so the order is stable. */
export function sortByCount(list: MistakeTypeCount[]): MistakeTypeCount[] {
  return [...list].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Group mistakes by type and attach labels.
 * Missing labels fall back to a humanized slug.
 */
export function groupMistakes(
  items: Pick<MistakeItem, 'type'>[],
  labels: Record<string, Partial<TypeLabels> | undefined> = {},
): MistakeTypeCount[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const t = it.type || 'unknown';
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const out: MistakeTypeCount[] = [];
  for (const [type, count] of counts) {
    const l = labels[type];
    const label = l?.label || humanizeSlug(type);
    out.push({ type, count, label, labelHinglish: l?.labelHinglish || label });
  }
  return sortByCount(out);
}

/** Turn a raw Firestore mistake doc into a MistakeItem. Bad fields become ''. */
export function toMistakeItem(id: string, data: Record<string, unknown>): MistakeItem {
  const ts = data.createdAt as { toMillis?: () => number } | null | undefined;
  return {
    id,
    sessionId: sanitizeText(data.sessionId, LIMITS.sessionId),
    type: typeof data.type === 'string' && data.type ? data.type : 'unknown',
    lineBefore: sanitizeText(data.lineBefore, LIMITS.line),
    lineAfter: sanitizeText(data.lineAfter, LIMITS.line),
    explanation: sanitizeText(data.explanation, LIMITS.explanation),
    createdAt: ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null,
  };
}

/** Turn a raw mistakeTypes doc into a MistakeTypeCount. */
export function toTypeCount(type: string, data: Record<string, unknown>): MistakeTypeCount {
  const label = sanitizeText(data.label, LIMITS.label) || humanizeSlug(type);
  const labelHinglish = sanitizeText(data.labelHinglish, LIMITS.label) || label;
  const count = typeof data.count === 'number' && data.count > 0 ? Math.floor(data.count) : 0;
  return { type, label, labelHinglish, count };
}

/**
 * Coalesce rapid counter updates into one write per `waitMs`.
 * `write` gets the latest counts only. `flush()` writes now (e.g. on page hide).
 */
export function createDebouncedWriter<T>(write: (value: T) => unknown, waitMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    write(value);
  };
  const push = (value: T) => {
    pending = { value };
    if (!timer) timer = setTimeout(flush, waitMs);
  };
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return { push, flush, cancel };
}

/** Resolve to `fallback` if `p` takes longer than `ms` (e.g. offline writes that never ack). */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
