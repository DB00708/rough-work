// Per-user, per-day cap on cloud calls. Owned by T4.
// Client-side only: it protects the demo budget from runaway loops, it is not a security boundary.
// A server-side cap (e.g. App Check + Functions) is out of scope.
import type { AppConfig } from './types';

const KEY_PREFIX = 'rw.cloudCalls';

/** Counts kept when localStorage is unavailable (private mode, quota full, SSR). */
const memoryCounts = new Map<string, number>();

/** Local calendar date as YYYY-MM-DD (the cap resets at local midnight). */
export function localDateKey(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function storageKey(uid: string, date: string): string {
  return `${KEY_PREFIX}.${uid}.${date}`;
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readStored(key: string): number | null {
  const s = getStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (raw === null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return null;
  }
}

/** Calls used today by this user (max of storage and in-memory count). */
export function getCloudCallsToday(uid: string, now: Date = new Date()): number {
  const key = storageKey(uid, localDateKey(now));
  const stored = readStored(key) ?? 0;
  return Math.max(stored, memoryCounts.get(key) ?? 0);
}

/** True while this user is under `cfg.dailyCloudCap` for today. */
export async function canCallCloud(uid: string, cfg: Pick<AppConfig, 'dailyCloudCap'>, now: Date = new Date()): Promise<boolean> {
  const cap = Number.isFinite(cfg.dailyCloudCap) ? Math.max(0, Math.floor(cfg.dailyCloudCap)) : 0;
  return getCloudCallsToday(uid, now) < cap;
}

/** Count one cloud call for this user today. Never throws. */
export function recordCloudCall(uid: string, now: Date = new Date()): void {
  const date = localDateKey(now);
  const key = storageKey(uid, date);
  const next = getCloudCallsToday(uid, now) + 1;
  memoryCounts.set(key, next);
  const s = getStorage();
  if (!s) return;
  try {
    s.setItem(key, String(next));
    pruneOldDays(s, uid, date);
  } catch {
    // Storage full or blocked: the in-memory count still applies for this tab.
  }
}

/** Remove this user's counters from earlier days so storage does not grow. */
function pruneOldDays(s: Storage, uid: string, today: string): void {
  const prefix = `${KEY_PREFIX}.${uid}.`;
  const stale: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith(prefix) && k !== storageKey(uid, today)) stale.push(k);
  }
  for (const k of stale) s.removeItem(k);
}

/** Test helper: clear the in-memory fallback counts. */
export function _resetQuotaMemory(): void {
  memoryCounts.clear();
}
