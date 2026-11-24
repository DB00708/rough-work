import { addDoc, collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { DB_TIMEOUT_MS, getDb } from './db';
import {
  LIMITS,
  createDebouncedWriter,
  sanitizeCounts,
  sanitizeText,
  withTimeout,
  type SessionCounts,
} from './helpers';

export type { SessionCounts } from './helpers';

/**
 * Create users/{uid}/sessions/{sid}. Returns the new sid, or '' if Firestore
 * is not configured or the write fails (fail soft).
 */
export async function startSession(uid: string, problemText: string): Promise<string> {
  try {
    const db = await getDb();
    if (!db || !uid) return '';
    const ref = await withTimeout(
      addDoc(collection(db, 'users', uid, 'sessions'), {
        startedAt: serverTimestamp(),
        problemText: sanitizeText(problemText, LIMITS.problemText),
        linesTotal: 0,
        deviceReads: 0,
        cloudCalls: 0,
      }),
      DB_TIMEOUT_MS,
      null,
    );
    return ref?.id ?? '';
  } catch (e) {
    console.warn('[data] startSession failed', e);
    return '';
  }
}

/**
 * Write the current counters as absolute values (merge). Idempotent, so it is
 * safe to call often or from a debouncer. No-op without uid/sid.
 */
export async function updateSessionCounts(
  uid: string,
  sid: string,
  counts: Partial<SessionCounts>,
): Promise<void> {
  try {
    const db = await getDb();
    if (!db || !uid || !sid) return;
    await withTimeout(
      setDoc(doc(db, 'users', uid, 'sessions', sid), sanitizeCounts(counts), { merge: true }),
      DB_TIMEOUT_MS,
      undefined,
    );
  } catch (e) {
    console.warn('[data] updateSessionCounts failed', e);
  }
}

/**
 * Convenience for the pipeline: `push(counts)` on every change, at most one
 * write per `waitMs`. Call `flush()` on session end / page hide.
 */
export function createSessionCountsWriter(uid: string, sid: string, waitMs = 3000) {
  return createDebouncedWriter<Partial<SessionCounts>>((c) => {
    void updateSessionCounts(uid, sid, c);
  }, waitMs);
}
