import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContent, getGenerativeModel } = vi.hoisted(() => {
  const generateContent = vi.fn();
  return { generateContent, getGenerativeModel: vi.fn(() => ({ generateContent })) };
});

vi.mock('firebase/app', () => ({ getApp: vi.fn(() => ({})) }));
vi.mock('firebase/ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('firebase/ai')>();
  return { ...real, getAI: vi.fn(() => ({})), getGenerativeModel };
});

import {
  buildParts,
  coerceExplanation,
  dataUrlToInline,
  explainMistake,
  EXPLAIN_TIMEOUT_MS,
  isExplainError,
  GENERIC_EXPLANATION,
  parseExplanation,
} from './explain';
import { DEFAULT_CONFIG } from './config';

const good = {
  hinglish: 'Line 2 mein bracket kholte waqt -3 ka sign galat ho gaya.',
  english: 'In line 2 the sign of -3 went wrong when opening the bracket.',
  hints: ['Bracket ke andar ka har sign dekho.', '2*(x-3) = 2*x - 2*3 hota hai.', '2*x - 6 = 10'],
  mistakeType: 'sign_error_expanding_brackets',
};

describe('coerceExplanation', () => {
  it('accepts valid output and fills labels from the taxonomy', () => {
    const e = coerceExplanation(good, 812.6);
    expect(e).toMatchObject({ ...good, mistakeLabel: 'Sign error while expanding brackets', ms: 813 });
    expect(e.mistakeLabelHinglish).toMatch(/Bracket/);
  });

  it('maps unknown mistakeType to other', () => {
    const e = coerceExplanation({ ...good, mistakeType: 'made_up' }, 1);
    expect(e.mistakeType).toBe('other');
    expect(e.mistakeLabel).toBe('Other mistake');
  });

  it('pads missing hints, drops extras, and ignores non-strings', () => {
    const g = GENERIC_EXPLANATION.hints;
    expect(coerceExplanation({ ...good, hints: ['only one'] }, 1).hints).toEqual(['only one', g[1], g[2]]);
    expect(coerceExplanation({ ...good, hints: ['a', 'b', 'c', 'd'] }, 1).hints).toEqual(['a', 'b', 'c']);
    expect(coerceExplanation({ ...good, hints: [1, null, ' c '] }, 1).hints).toEqual([g[0], g[1], 'c']);
    expect(coerceExplanation({ ...good, hints: 'x' }, 1).hints).toEqual(g);
  });

  it('omits english when missing or blank', () => {
    expect('english' in coerceExplanation({ ...good, english: '  ' }, 1)).toBe(false);
    expect('english' in coerceExplanation({ ...good, english: undefined }, 1)).toBe(false);
  });

  it('returns the generic explanation when hinglish is missing or input is not an object', () => {
    for (const raw of [null, 'text', [good], { ...good, hinglish: '' }, { ...good, hinglish: 5 }]) {
      expect(coerceExplanation(raw, 5)).toEqual({ ...GENERIC_EXPLANATION, ms: 5 });
    }
  });

  it('collapses whitespace and caps very long text', () => {
    const e = coerceExplanation({ ...good, hinglish: `a  \n b${'x'.repeat(2000)}` }, 1);
    expect(e.hinglish.startsWith('a b')).toBe(true);
    expect(e.hinglish.length).toBeLessThanOrEqual(600);
  });

  it('sanitises bad ms', () => {
    expect(coerceExplanation(good, Number.NaN).ms).toBe(0);
    expect(coerceExplanation(good, -4).ms).toBe(0);
  });
});

describe('parseExplanation', () => {
  it('parses JSON, including inside markdown fences', () => {
    expect(parseExplanation(JSON.stringify(good), 1).mistakeType).toBe('sign_error_expanding_brackets');
    expect(parseExplanation('```json\n' + JSON.stringify(good) + '\n```', 1).hinglish).toBe(good.hinglish);
  });

  it('returns the generic explanation on bad JSON', () => {
    expect(parseExplanation('{not json', 3)).toEqual({ ...GENERIC_EXPLANATION, ms: 3 });
    expect(parseExplanation('', 3)).toEqual({ ...GENERIC_EXPLANATION, ms: 3 });
  });
});

describe('request building', () => {
  it('strips the data URL prefix', () => {
    expect(dataUrlToInline('data:image/jpeg;base64,QUJD')).toEqual({ mimeType: 'image/jpeg', data: 'QUJD' });
    expect(dataUrlToInline('QUJD')).toEqual({ mimeType: 'image/jpeg', data: 'QUJD' });
    expect(dataUrlToInline('data:image/jpeg,not-base64')).toBeNull();
  });

  it('sends both transcriptions, the config prefix, and labelled crops', () => {
    const parts = buildParts(
      {
        prev: '2*(x-3) = 10',
        next: '2*x - 3 = 10',
        prevCrop: 'data:image/jpeg;base64,AAA',
        nextCrop: 'data:image/jpeg;base64,BBB',
      },
      { explainPrompt: 'PREFIX' },
    );
    const first = parts[0] as { type: string; text: string };
    expect(first.text.startsWith('PREFIX')).toBe(true);
    expect(first.text).toContain('LINE A (previous, correct so far): 2*(x-3) = 10');
    expect(first.text).toContain('LINE B (new, has the mistake): 2*x - 3 = 10');
    expect(parts.slice(1)).toEqual([
      { type: 'text', text: 'Image of LINE A:' },
      { type: 'inlineData', inlineData: { mimeType: 'image/jpeg', data: 'AAA' } },
      { type: 'text', text: 'Image of LINE B:' },
      { type: 'inlineData', inlineData: { mimeType: 'image/jpeg', data: 'BBB' } },
    ]);
  });

  it('sends text only when there are no crops', () => {
    const parts = buildParts({ prev: 'a', next: 'b' }, { explainPrompt: '' });
    expect(parts).toHaveLength(1);
    expect((parts[0] as { text: string }).text).not.toContain('Images of');
  });
});

describe('explainMistake', () => {
  it('defaults to an 8 s timeout', () => expect(EXPLAIN_TIMEOUT_MS).toBe(8000));

  beforeEach(() => {
    generateContent.mockReset();
  });

  it('uses an ONLY_IN_CLOUD JSON model and returns a coerced explanation', async () => {
    generateContent.mockResolvedValue({ response: { text: () => JSON.stringify(good) } });
    const e = await explainMistake({ prev: '2*(x-3)=10', next: '2*x-3=10' }, DEFAULT_CONFIG);
    expect(e.mistakeType).toBe('sign_error_expanding_brackets');
    expect(e.ms).toBeGreaterThanOrEqual(0);
    const params = (getGenerativeModel.mock.calls[0] as unknown[])[1] as {
      mode: string;
      inCloudParams: { model: string; generationConfig: { responseMimeType: string; responseSchema: unknown } };
    };
    expect(params.mode).toBe('only_in_cloud');
    expect(params.inCloudParams.model).toBe(DEFAULT_CONFIG.cloudModel);
    expect(params.inCloudParams.generationConfig.responseMimeType).toBe('application/json');
    expect(params.inCloudParams.generationConfig.responseSchema).toBeDefined();
    expect(generateContent.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('returns the generic explanation when the response is blocked', async () => {
    generateContent.mockResolvedValue({
      response: {
        text: () => {
          throw new Error('blocked');
        },
      },
    });
    const e = await explainMistake({ prev: 'a', next: 'b' }, DEFAULT_CONFIG);
    expect(e.mistakeType).toBe('other');
    expect(e.hinglish).toBe(GENERIC_EXPLANATION.hinglish);
  });

  it('rejects with a network ExplainError when the call fails', async () => {
    generateContent.mockRejectedValue(new Error('500'));
    const err = await explainMistake({ prev: 'a', next: 'b' }, DEFAULT_CONFIG).catch((e: unknown) => e);
    expect(isExplainError(err) && err.kind).toBe('network');
  });

  it('times out and aborts the request', async () => {
    let signal: AbortSignal | undefined;
    generateContent.mockImplementation((_p: unknown, opts?: { signal: AbortSignal }) => {
      signal = opts?.signal;
      return new Promise(() => {});
    });
    const err = await explainMistake({ prev: 'a', next: 'b' }, DEFAULT_CONFIG, { timeoutMs: 20 }).catch((e: unknown) => e);
    expect(isExplainError(err) && err.kind).toBe('timeout');
    expect(signal?.aborted).toBe(true);
  });
});
