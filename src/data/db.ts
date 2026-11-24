// Firestore access that fails soft. If Firebase is not configured, getDb() returns null
// and every data function returns an empty result, so the app still works offline / in demo.
import { getApp, getApps } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';

/** Max wait for a Firestore call. Offline writes are queued locally and sync later. */
export const DB_TIMEOUT_MS = 8000;

let triedInit = false;

/** Firestore instance, or null when Firebase is not configured. Never throws. */
export async function getDb(): Promise<Firestore | null> {
  try {
    if (getApps().length === 0 && !triedInit) {
      triedInit = true;
      // firebase.ts (T1) initializes the app on import. Load it lazily, ignore failure.
      try {
        await import('../firebase');
      } catch (e) {
        console.warn('[data] firebase module failed to load', e);
      }
    }
    if (getApps().length === 0) return null;
    return getFirestore(getApp());
  } catch (e) {
    console.warn('[data] Firestore not available', e);
    return null;
  }
}

/** True when a Firestore instance is available. */
export async function isDataConfigured(): Promise<boolean> {
  return (await getDb()) !== null;
}
