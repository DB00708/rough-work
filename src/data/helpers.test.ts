import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LIMITS,
  createDebouncedWriter,
  groupMistakes,
  humanizeSlug,
  sanitizeCounts,
  sanitizeText,
  sanitizeTypeSlug,
  toMistakeItem,
  toTypeCount,
  withTimeout,
} from './helpers';
import { buildMistakeDocs } from './mistakes';
import type { Explanation, Line } from '../types';

describe('sanitizeText', () => {
  it('drops data URLs', () => {
    expect(sanitizeText('data:image/jpeg;base64,AAAA', 500)).toBe('');
    expect(sanitizeText('  DATA:text/plain,hi', 500)).toBe('');
  });
  it('strips embedded base64 data URLs', () => {
    expect(sanitizeText('x = 2 data:image/png;base64,iVBORw0KGgo= end', 500)).toBe('x = 2  end');
  });
  it('trims and cuts to max', () => {
    expect(sanitizeText('  2x+3  ', 500)).toBe('2x+3');
    expect(sanitizeText('abcdef', 3)).toBe('abc');
  });
  it('returns empty for non-strings', () => {
    expect(sanitizeText(undefined, 10)).toBe('');
    expect(sanitizeText(42, 10)).toBe('');
    expect(sanitizeText(null, 10)).toBe('');
  });
});

describe('sanitizeTypeSlug', () => {
  it('makes a safe slug', () => {
    expect(sanitizeTypeSlug('Dropped Minus / Brackets!')).toBe('dropped_minus_brackets');
    expect(sanitizeTypeSlug('sign_error')).toBe('sign_error');
  });
  it('falls back to unknown', () => {
    expect(sanitizeTypeSlug('')).toBe('unknown');
    expect(sanitizeTypeSlug('***')).toBe('unknown');
    expect(sanitizeTypeSlug(undefined)).toBe('unknown');
  });
  it('caps length', () => {
    expect(sanitizeTypeSlug('a'.repeat(200)).length).toBe(LIMITS.typeSlug);
  });
});

describe('humanizeSlug', () => {
  it('formats slugs', () => {
    expect(humanizeSlug('dropped_minus_sign')).toBe('Dropped minus sign');
    expect(humanizeSlug('')).toBe('Unknown');
  });
});

describe('sanitizeCounts', () => {
  it('clamps to non-negative ints', () => {
    expect(sanitizeCounts({ deviceReads: 3.7, cloudCalls: -1, linesTotal: NaN })).toEqual({
      deviceReads: 3,
      cloudCalls: 0,
      linesTotal: 0,
    });
    expect(sanitizeCounts({})).toEqual({ deviceReads: 0, cloudCalls: 0, linesTotal: 0 });
  });
});

describe('groupMistakes', () => {
  it('counts per type, sorted desc, with labels and fallbacks', () => {
    const items = [{ type: 'a' }, { type: 'b_c' }, { type: 'a' }, { type: 'a' }, { type: 'b_c' }, { type: 'z' }];
    const out = groupMistakes(items, {
      a: { label: 'Sign slip', labelHinglish: 'Sign galat' },
      z: { label: 'Zed' },
    });
    expect(out).toEqual([
      { type: 'a', count: 3, label: 'Sign slip', labelHinglish: 'Sign galat' },
      { type: 'b_c', count: 2, label: 'B c', labelHinglish: 'B c' },
      { type: 'z', count: 1, label: 'Zed', labelHinglish: 'Zed' },
    ]);
  });
  it('breaks count ties by label', () => {
    const out = groupMistakes([{ type: 'y' }, { type: 'x' }]);
    expect(out.map((t) => t.type)).toEqual(['x', 'y']);
  });
  it('handles empty input', () => {
    expect(groupMistakes([])).toEqual([]);
  });
});

describe('toMistakeItem / toTypeCount', () => {
  it('reads a doc and converts the timestamp', () => {
    const item = toMistakeItem('m1', {
      sessionId: 's1',
      type: 't',
      lineBefore: '2(x+3)=10',
      lineAfter: '2x+3=10',
      explanation: 'Bracket ke andar sab ko multiply karo.',
      createdAt: { toMillis: () => 1000 },
    });
    expect(item).toEqual({
      id: 'm1',
      sessionId: 's1',
      type: 't',
      lineBefore: '2(x+3)=10',
      lineAfter: '2x+3=10',
      explanation: 'Bracket ke andar sab ko multiply karo.',
      createdAt: 1000,
    });
  });
  it('tolerates bad fields and pending timestamps', () => {
    const item = toMistakeItem('m2', { lineBefore: 'data:image/png;base64,AA', createdAt: null });
    expect(item.lineBefore).toBe('');
    expect(item.type).toBe('unknown');
    expect(item.createdAt).toBeNull();
  });
  it('builds type counts with fallbacks', () => {
    expect(toTypeCount('sign_slip', { count: 4 })).toEqual({
      type: 'sign_slip',
      label: 'Sign slip',
      labelHinglish: 'Sign slip',
      count: 4,
    });
    expect(toTypeCount('x', { count: 'bad' }).count).toBe(0);
  });
});

describe('buildMistakeDocs', () => {
  const line = (plain: string): Line => ({
    id: plain,
    index: 0,
    cropDataUrl: 'data:image/jpeg;base64,/9j/AAAA',
    status: 'wrong',
    read: { latex: plain, plain, confidence: 0.9, source: 'device', ms: 10 },
  });
  const explanation: Explanation = {
    hinglish: 'Minus sign bracket ke andar bhi lagta hai.',
    english: 'The minus applies inside the bracket.',
    hints: ['a', 'b', 'c'],
    mistakeType: 'Dropped_Minus',
    mistakeLabel: 'Dropped minus',
    mistakeLabelHinglish: 'Minus chhoot gaya',
    ms: 5,
  };

  it('writes only plain text fields and never the crop', () => {
    const { type, mistake, typeLabels } = buildMistakeDocs('s1', line('x-3=5'), line('x-(3)=5'), explanation);
    expect(type).toBe('dropped_minus');
    expect(mistake).toEqual({
      sessionId: 's1',
      type: 'dropped_minus',
      lineBefore: 'x-(3)=5',
      lineAfter: 'x-3=5',
      explanation: 'Minus sign bracket ke andar bhi lagta hai.',
    });
    expect(typeLabels).toEqual({ label: 'Dropped minus', labelHinglish: 'Minus chhoot gaya' });
    expect(JSON.stringify(mistake)).not.toContain('data:');
  });

  it('strips a data URL that leaked into the plain text', () => {
    const bad = line('data:image/jpeg;base64,/9j/AAAA');
    const { mistake } = buildMistakeDocs('s1', bad, line('x=1'), { ...explanation, hinglish: 'data:text/plain,hi' });
    expect(mistake.lineAfter).toBe('');
    expect(mistake.explanation).toBe('');
  });
});

describe('createDebouncedWriter', () => {
  afterEach(() => vi.useRealTimers());

  it('writes only the latest value once per window, and flushes on demand', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const w = createDebouncedWriter<number>(write, 1000);
    w.push(1);
    w.push(2);
    w.push(3);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenLastCalledWith(3);
    w.push(4);
    w.flush();
    expect(write).toHaveBeenLastCalledWith(4);
    vi.advanceTimersByTime(5000);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('cancel drops the pending value', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const w = createDebouncedWriter<number>(write, 1000);
    w.push(1);
    w.cancel();
    vi.advanceTimersByTime(2000);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('withTimeout', () => {
  it('resolves to fallback when slow', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise<number>(() => {}), 100, -1);
    vi.advanceTimersByTime(100);
    await expect(p).resolves.toBe(-1);
    vi.useRealTimers();
  });
  it('passes through fast values and errors', async () => {
    await expect(withTimeout(Promise.resolve(5), 100, -1)).resolves.toBe(5);
    await expect(withTimeout(Promise.reject(new Error('x')), 100, -1)).rejects.toThrow('x');
  });
});
