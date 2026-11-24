import { describe, expect, it, vi } from 'vitest';

// read.ts imports firebase.ts, which starts the Firebase SDK. The helpers under test are pure.
vi.mock('./firebase', () => ({
  assertFirebaseConfigured: () => {},
  getCloudModel: () => ({}),
  getReadModel: () => ({}),
  onDeviceCreateOptions: {},
  readResponseSchema: {},
}));

import { DEFAULT_CONFIG } from './config';
import {
  buildReadPrompt,
  clampConfidence,
  deviceModelAvailability,
  normalizeForCompare,
  parseDataUrl,
  parseReadResponse,
  sourceOf,
  toAsciiMaths,
} from './read';
import type { GenerateContentResult } from 'firebase/ai';

describe('parseReadResponse', () => {
  it('parses plain JSON', () => {
    expect(parseReadResponse('{"latex":"2x+3=7","plain":"2*x+3=7","confidence":0.9}')).toEqual({
      latex: '2x+3=7',
      plain: '2*x+3=7',
      confidence: 0.9,
    });
  });

  it('strips code fences', () => {
    const text = '```json\n{"latex":"x^2","plain":"x^2 = 4","confidence":0.8}\n```';
    expect(parseReadResponse(text)).toEqual({ latex: 'x^2', plain: 'x^2 = 4', confidence: 0.8 });
  });

  it('finds JSON inside extra prose, with braces inside strings', () => {
    const text = 'Here you go: {"latex":"\\\\frac{1}{2}","plain":"1/2","confidence":0.7} hope this helps';
    expect(parseReadResponse(text)).toEqual({ latex: '\\frac{1}{2}', plain: '1/2', confidence: 0.7 });
  });

  it('returns confidence 0 for garbage, arrays and empty text', () => {
    for (const t of ['not json', '[1,2]', '', '{"latex":']) {
      expect(parseReadResponse(t)).toEqual({ latex: '', plain: '', confidence: 0 });
    }
  });

  it('forces confidence 0 when plain is empty', () => {
    expect(parseReadResponse('{"latex":"x","plain":"","confidence":0.99}').confidence).toBe(0);
  });

  it('handles wrong types', () => {
    expect(parseReadResponse('{"latex":5,"plain":"x=1","confidence":"0.5"}')).toEqual({
      latex: '',
      plain: 'x=1',
      confidence: 0.5,
    });
  });

  it('converts unicode maths in plain to ASCII', () => {
    expect(parseReadResponse('{"latex":"","plain":"2×x − 3 ÷ 4 = x²","confidence":1}').plain).toBe('2*x - 3 / 4 = x^2');
  });
});

describe('clampConfidence', () => {
  it('clamps into 0..1', () => {
    expect(clampConfidence(-0.2)).toBe(0);
    expect(clampConfidence(0.42)).toBe(0.42);
    expect(clampConfidence(1)).toBe(1);
    expect(clampConfidence(250)).toBe(1);
  });
  it('treats 1..100 as a percentage', () => {
    expect(clampConfidence(85)).toBe(0.85);
  });
  it('maps junk to 0', () => {
    expect(clampConfidence(NaN)).toBe(0);
    expect(clampConfidence(undefined)).toBe(0);
    expect(clampConfidence('abc')).toBe(0);
    expect(clampConfidence(Infinity)).toBe(0);
  });
});

describe('toAsciiMaths', () => {
  it('collapses whitespace and maps symbols', () => {
    expect(toAsciiMaths('  3·x   ⋅ y  ')).toBe('3*x * y');
    expect(toAsciiMaths('√(x) – 1')).toBe('sqrt(x) - 1');
    expect(toAsciiMaths('a³')).toBe('a^3');
  });
});

describe('normalizeForCompare', () => {
  it('ignores spacing, case and explicit multiply', () => {
    expect(normalizeForCompare('2*x + 3 = 7')).toBe(normalizeForCompare('2x+3=7'));
    expect(normalizeForCompare('X² − 1')).toBe('x^2-1');
    expect(normalizeForCompare('2x+3=7')).not.toBe(normalizeForCompare('2x-3=7'));
  });
});

describe('parseDataUrl', () => {
  it('splits jpeg and png data URLs', () => {
    expect(parseDataUrl('data:image/jpeg;base64,AAAA')).toEqual({ mimeType: 'image/jpeg', data: 'AAAA' });
    expect(parseDataUrl('data:image/PNG;base64,QQ==')).toEqual({ mimeType: 'image/png', data: 'QQ==' });
  });
  it('rejects non-data URLs', () => {
    expect(() => parseDataUrl('https://example.com/a.jpg')).toThrow();
    expect(() => parseDataUrl('data:image/jpeg,raw')).toThrow();
  });
});

describe('buildReadPrompt', () => {
  it('keeps the Remote Config prompt and asks for ASCII plain maths', () => {
    const p = buildReadPrompt(DEFAULT_CONFIG);
    expect(p.startsWith(DEFAULT_CONFIG.readPrompt)).toBe(true);
    expect(p).toContain('"plain"');
    expect(p).toContain('* for multiply');
    expect(p).toContain('^ for powers');
  });
});

describe('sourceOf', () => {
  const res = (inferenceSource?: string) => ({ response: { inferenceSource } }) as unknown as GenerateContentResult;
  it('maps inferenceSource', () => {
    expect(sourceOf(res('on_device'))).toBe('device');
    expect(sourceOf(res('in_cloud'))).toBe('cloud');
    expect(sourceOf(res(undefined))).toBe('cloud');
  });
});

describe('deviceModelAvailability', () => {
  it('is unavailable without the Prompt API', async () => {
    expect(await deviceModelAvailability()).toBe('unavailable');
  });
  it('reads LanguageModel.availability', async () => {
    vi.stubGlobal('LanguageModel', { availability: async () => 'downloadable' });
    expect(await deviceModelAvailability()).toBe('downloadable');
    vi.unstubAllGlobals();
  });
});
