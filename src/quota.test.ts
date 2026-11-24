import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetQuotaMemory, canCallCloud, getCloudCallsToday, localDateKey, recordCloudCall } from './quota';

class MemStorage implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const cfg = { dailyCloudCap: 3 };
const day1 = new Date(2026, 10, 24, 10, 0);
const day1Late = new Date(2026, 10, 24, 23, 59);
const day2 = new Date(2026, 10, 25, 0, 1);

describe('quota', () => {
  let store: MemStorage;
  beforeEach(() => {
    store = new MemStorage();
    vi.stubGlobal('localStorage', store);
    _resetQuotaMemory();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('formats the local date', () => {
    expect(localDateKey(day1)).toBe('2026-11-24');
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('allows calls up to the cap, then blocks', async () => {
    for (let i = 0; i < 3; i++) {
      expect(await canCallCloud('u1', cfg, day1)).toBe(true);
      recordCloudCall('u1', day1);
    }
    expect(await canCallCloud('u1', cfg, day1Late)).toBe(false);
    expect(store.getItem('rw.cloudCalls.u1.2026-11-24')).toBe('3');
  });

  it('counts per user', async () => {
    for (let i = 0; i < 3; i++) recordCloudCall('u1', day1);
    expect(await canCallCloud('u1', cfg, day1)).toBe(false);
    expect(await canCallCloud('u2', cfg, day1)).toBe(true);
  });

  it('resets on a new local day and prunes old keys', async () => {
    for (let i = 0; i < 3; i++) recordCloudCall('u1', day1);
    expect(await canCallCloud('u1', cfg, day2)).toBe(true);
    recordCloudCall('u1', day2);
    expect(getCloudCallsToday('u1', day2)).toBe(1);
    expect(store.getItem('rw.cloudCalls.u1.2026-11-24')).toBeNull();
  });

  it('treats a cap of 0 or NaN as no cloud calls', async () => {
    expect(await canCallCloud('u1', { dailyCloudCap: 0 }, day1)).toBe(false);
    expect(await canCallCloud('u1', { dailyCloudCap: Number.NaN }, day1)).toBe(false);
  });

  it('treats corrupt stored values as 0', () => {
    store.setItem('rw.cloudCalls.u1.2026-11-24', 'garbage');
    expect(getCloudCallsToday('u1', day1)).toBe(0);
  });

  it('falls back to memory when storage throws', async () => {
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      key: () => null,
      removeItem: () => {},
      clear: () => {},
      length: 0,
    } as unknown as Storage;
    vi.stubGlobal('localStorage', broken);
    expect(await canCallCloud('u1', cfg, day1)).toBe(true);
    for (let i = 0; i < 3; i++) expect(() => recordCloudCall('u1', day1)).not.toThrow();
    expect(await canCallCloud('u1', cfg, day1)).toBe(false);
  });

  it('falls back to memory when storage is missing', async () => {
    vi.stubGlobal('localStorage', undefined);
    for (let i = 0; i < 3; i++) recordCloudCall('u1', day1);
    expect(await canCallCloud('u1', cfg, day1)).toBe(false);
  });
});
