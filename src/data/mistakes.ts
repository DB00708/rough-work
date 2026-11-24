import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import type { Explanation, Line } from '../types';
import { DB_TIMEOUT_MS, getDb } from './db';
import {
  COMMON_LIMIT,
  LIMITS,
  MISTAKE_SCAN_LIMIT,
  RECENT_LIMIT,
  groupMistakes,
  sanitizeText,
  sanitizeTypeSlug,
  sortByCount,
  toMistakeItem,
  toTypeCount,
  withTimeout,
  type MistakeTypeCount,
  type MyMistakes,
  type TypeLabels,
} from './helpers';

export type { MistakeItem, MistakeTypeCount, MyMistakes } from './helpers';

const EMPTY: MyMistakes = { byType: [], recent: [] };

/** Plain text of a line. Never the crop: images are not stored. */
function linePlain(line: Line | undefined): string {
  return sanitizeText(line?.read?.plain ?? '', LIMITS.line);
}

/** Build the two docs logMistake writes. Exported for tests. */
export function buildMistakeDocs(sid: string, line: Line, prev: Line, explanation: Explanation) {
  const type = sanitizeTypeSlug(explanation.mistakeType);
  const label = sanitizeText(explanation.mistakeLabel, LIMITS.label) || type;
  const labelHinglish = sanitizeText(explanation.mistakeLabelHinglish, LIMITS.label) || label;
  return {
    type,
    mistake: {
      sessionId: sanitizeText(sid, LIMITS.sessionId),
      type,
      lineBefore: linePlain(prev),
      lineAfter: linePlain(line),
      explanation: sanitizeText(explanation.hinglish, LIMITS.explanation),
    },
    typeLabels: { label, labelHinglish },
  };
}

/**
 * Write users/{uid}/mistakes/{mid} and bump mistakeTypes/{type}.count by 1,
 * in one batch. Fails soft (warns, returns '' ) when not configured.
 * Returns the new mistake id.
 */
export async function logMistake(
  uid: string,
  sid: string,
  line: Line,
  prev: Line,
  explanation: Explanation,
): Promise<string> {
  try {
    const db = await getDb();
    if (!db || !uid) return '';
    const { type, mistake, typeLabels } = buildMistakeDocs(sid, line, prev, explanation);
    const mref = doc(collection(db, 'users', uid, 'mistakes'));
    const batch = writeBatch(db);
    batch.set(mref, { ...mistake, createdAt: serverTimestamp() });
    batch.set(
      doc(db, 'mistakeTypes', type),
      { ...typeLabels, count: increment(1) },
      { merge: true },
    );
    await withTimeout(batch.commit(), DB_TIMEOUT_MS, undefined);
    return mref.id;
  } catch (e) {
    console.warn('[data] logMistake failed', e);
    return '';
  }
}

/** Labels for the given types from mistakeTypes/{type}. Missing ones are skipped. */
async function fetchLabels(types: string[]): Promise<Record<string, TypeLabels>> {
  const db = await getDb();
  if (!db) return {};
  const out: Record<string, TypeLabels> = {};
  await Promise.all(
    types.map(async (t) => {
      try {
        const snap = await getDoc(doc(db, 'mistakeTypes', t));
        if (snap.exists()) {
          const { label, labelHinglish } = toTypeCount(t, snap.data());
          out[t] = { label, labelHinglish };
        }
      } catch {
        // Label is optional; groupMistakes falls back to the slug.
      }
    }),
  );
  return out;
}

/**
 * The user's mistakes: counts per type (from the latest MISTAKE_SCAN_LIMIT docs)
 * and the RECENT_LIMIT most recent items. Empty when not configured.
 */
export async function listMyMistakes(uid: string): Promise<MyMistakes> {
  try {
    const db = await getDb();
    if (!db || !uid) return EMPTY;
    const q = query(
      collection(db, 'users', uid, 'mistakes'),
      orderBy('createdAt', 'desc'),
      limit(MISTAKE_SCAN_LIMIT),
    );
    const snap = await withTimeout(getDocs(q), DB_TIMEOUT_MS, null);
    if (!snap) return EMPTY;
    const items = snap.docs.map((d) => toMistakeItem(d.id, d.data()));
    const labels = await fetchLabels([...new Set(items.map((i) => i.type))]);
    return { byType: groupMistakes(items, labels), recent: items.slice(0, RECENT_LIMIT) };
  } catch (e) {
    console.warn('[data] listMyMistakes failed', e);
    return EMPTY;
  }
}

/** Top COMMON_LIMIT global mistake types by count. Empty when not configured. */
export async function listCommonMistakes(): Promise<MistakeTypeCount[]> {
  try {
    const db = await getDb();
    if (!db) return [];
    const q = query(collection(db, 'mistakeTypes'), orderBy('count', 'desc'), limit(COMMON_LIMIT));
    const snap = await withTimeout(getDocs(q), DB_TIMEOUT_MS, null);
    if (!snap) return [];
    return sortByCount(snap.docs.map((d) => toTypeCount(d.id, d.data())).filter((t) => t.count > 0));
  } catch (e) {
    console.warn('[data] listCommonMistakes failed', e);
    return [];
  }
}
