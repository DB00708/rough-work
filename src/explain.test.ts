import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContent, getGenerativeModel } = vi.hoisted(() => {
  const generateContent = vi.fn();
  return { generateContent, getGenerativeModel: vi.fn(() => ({ generateContent })) };
});

vi.mock('firebase/app', () => ({ getApp: vi.fn(() => ({})) }));
vi.mock('firebase/ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('firebase/ai')>();
  return { ...real, getAI: vi.fn(() => ({})), getGenerativeModel };
});

import { ThinkingLevel } from 'firebase/ai';
import {
  _resetExplainModels,
  buildParts,
  buildSystemPrompt,
  coerceExplanation,
  dataUrlToInline,
  EXPLAIN_MAX_OUTPUT_TOKENS,
  EXPLAIN_TIMEOUT_MS,
  explainInEnglish,
  explainMistake,
  GENERIC_EXPLANATION,
  isExplainError,
  isLocalFallback,
  NO_THINKING_TOKEN_MULTIPLIER,
  localFallbackExplanation,
  looksPureEnglish,
  parseExplanation,
  thinkingConfigFor,
} from './explain';
import { DEFAULT_CONFIG } from './config';

const good = {
  hinglish: 'Is step mein bracket kholte waqt -3 ka sign galat ho gaya.',
  hints: ['Bracket ke andar ka har sign dekho.', '2*(x-3) = 2*x - 2*3 hota hai.', '2*x - 6 = 10'],
  mistakeType: 'sign_error_expanding_brackets',
};

const reply = (obj: unknown) => ({ response: { text: () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) } });

type ModelParams = {
  mode: string;
  inCloudParams: {
    model: string;
    systemInstruction?: string;
    generationConfig: {
      responseMimeType?: string;
      responseSchema?: { properties?: Record<string, unknown> };
      maxOutputTokens?: number;
      thinkingConfig?: unknown;
    };
  };
};
const lastModelParams = () => (getGenerativeModel.mock.lastCall as unknown as unknown[])[1] as ModelParams;

describe('coerceExplanation', () => {
  it('accepts valid output and fills labels from the taxonomy', () => {
    const e = coerceExplanation(good, 812.6);
    expect(e).toMatchObject({ ...good, mistakeLabel: 'Sign error while expanding brackets', ms: 813 });
    expect(e.mistakeLabelHinglish).toMatch(/Bracket/);
    expect('english' in e).toBe(false);
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

  it('keeps english only when the model sends a non-blank one', () => {
    expect(coerceExplanation({ ...good, english: 'Sign error.' }, 1).english).toBe('Sign error.');
    expect('english' in coerceExplanation({ ...good, english: '  ' }, 1)).toBe(false);
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

  it('returns the generic explanation on bad or truncated JSON', () => {
    expect(parseExplanation('{not json', 3)).toEqual({ ...GENERIC_EXPLANATION, ms: 3 });
    expect(parseExplanation(JSON.stringify(good).slice(0, 40), 3)).toEqual({ ...GENERIC_EXPLANATION, ms: 3 });
    expect(parseExplanation('', 3)).toEqual({ ...GENERIC_EXPLANATION, ms: 3 });
  });
});

describe('looksPureEnglish', () => {
  it('flags English sentences and passes Hinglish ones', () => {
    expect(looksPureEnglish('Check the sign of every term inside the bracket.')).toBe(true);
    expect(looksPureEnglish('Bracket ke andar ka har sign dekho.')).toBe(false);
    expect(looksPureEnglish(good.hinglish)).toBe(false);
  });

  it('ignores short or maths-only text', () => {
    expect(looksPureEnglish('2*x - 6 = 10')).toBe(false);
    expect(looksPureEnglish('Sign error')).toBe(false);
  });

  it('GENERIC hints and every taxonomy tip read as Hinglish', async () => {
    const { MISTAKE_TYPES } = await import('./mistakeTypes');
    for (const h of [GENERIC_EXPLANATION.hinglish, ...GENERIC_EXPLANATION.hints]) expect(looksPureEnglish(h)).toBe(false);
    for (const t of MISTAKE_TYPES) expect(looksPureEnglish(t.tipHinglish), t.slug).toBe(false);
  });
});

describe('local fallback', () => {
  it('builds a taxonomy explanation when the step has a clear signal', () => {
    const e = localFallbackExplanation({ prev: '-(x-3) = 5', next: '-x-3 = 5' }, 5000);
    expect(e.mistakeType).toBe('sign_error_expanding_brackets');
    expect(e.hinglish).toMatch(/^Is step mein/);
    expect(e.hints[1]).toMatch(/sign badlo/);
    expect(e.english).toBeTruthy();
    expect(isLocalFallback(e)).toBe(true);
  });

  it('uses the generic explanation otherwise', () => {
    const e = localFallbackExplanation({ prev: 'x + 1 = 3', next: 'x = 4' }, 5000);
    expect(e).toEqual({ ...GENERIC_EXPLANATION, ms: 5000 });
    expect(isLocalFallback(e)).toBe(true);
    expect(isLocalFallback({ ...e })).toBe(false);
  });
});

describe('request building', () => {
  it('strips the data URL prefix', () => {
    expect(dataUrlToInline('data:image/jpeg;base64,QUJD')).toEqual({ mimeType: 'image/jpeg', data: 'QUJD' });
    expect(dataUrlToInline('QUJD')).toEqual({ mimeType: 'image/jpeg', data: 'QUJD' });
    expect(dataUrlToInline('data:image/jpeg,not-base64')).toBeNull();
  });

  const input = {
    prev: '2*(x-3) = 10',
    next: '2*x - 3 = 10',
    prevCrop: 'data:image/jpeg;base64,AAA',
    nextCrop: 'data:image/jpeg;base64,BBB',
  };

  it('is text only by default, even when crops are given', () => {
    expect(buildParts(input)).toEqual([{ type: 'text', text: 'LINE A: 2*(x-3) = 10\nLINE B: 2*x - 3 = 10' }]);
  });

  it('adds labelled crops when asked', () => {
    expect(buildParts(input, true).slice(1)).toEqual([
      { type: 'text', text: 'Image of LINE A:' },
      { type: 'inlineData', inlineData: { mimeType: 'image/jpeg', data: 'AAA' } },
      { type: 'text', text: 'Image of LINE B:' },
      { type: 'inlineData', inlineData: { mimeType: 'image/jpeg', data: 'BBB' } },
    ]);
  });

  it('puts the config prefix before the format rules, and asks for Hinglish hints', () => {
    const s = buildSystemPrompt({ explainPrompt: 'PREFIX' });
    expect(s.startsWith('PREFIX\n')).toBe(true);
    expect(s).toMatch(/hints: 3 Hinglish strings/);
    expect(buildSystemPrompt({ explainPrompt: '  ' }).startsWith('LINE B')).toBe(true);
  });

  it('keeps the system prompt short', () => {
    expect(buildSystemPrompt(DEFAULT_CONFIG).length).toBeLessThan(1000);
  });

  it('picks the smallest thinking setting per model family', () => {
    expect(thinkingConfigFor('gemini-3.5-flash-lite')).toEqual({ thinkingLevel: ThinkingLevel.MINIMAL });
    expect(thinkingConfigFor('gemini-2.5-flash')).toEqual({ thinkingBudget: 0 });
    expect(thinkingConfigFor('gemini-2.5-pro')).toEqual({ thinkingBudget: 128 });
    expect(thinkingConfigFor('gemini-2.0-flash')).toBeUndefined();
  });
});

describe('explainMistake', () => {
  beforeEach(() => {
    generateContent.mockReset();
    getGenerativeModel.mockClear();
    _resetExplainModels();
  });
  afterEach(() => vi.restoreAllMocks());

  it('defaults to a 5 s timeout', () => expect(EXPLAIN_TIMEOUT_MS).toBe(5000));

  it('uses a fast ONLY_IN_CLOUD JSON model and returns a coerced explanation', async () => {
    generateContent.mockResolvedValue(reply(good));
    const e = await explainMistake({ prev: '2*(x-3)=10', next: '2*x-3=10', prevCrop: 'data:image/jpeg;base64,AAA' }, DEFAULT_CONFIG);
    expect(e.mistakeType).toBe('sign_error_expanding_brackets');
    expect(e.ms).toBeGreaterThanOrEqual(0);
    expect(isLocalFallback(e)).toBe(false);

    const p = lastModelParams();
    expect(p.mode).toBe('only_in_cloud');
    expect(p.inCloudParams.model).toBe(DEFAULT_CONFIG.cloudModel);
    expect(p.inCloudParams.systemInstruction).toBe(buildSystemPrompt(DEFAULT_CONFIG));
    const g = p.inCloudParams.generationConfig;
    expect(g.responseMimeType).toBe('application/json');
    expect(Object.keys(g.responseSchema?.properties ?? {}).sort()).toEqual(['hinglish', 'hints', 'mistakeType']);
    expect(g.maxOutputTokens).toBe(EXPLAIN_MAX_OUTPUT_TOKENS);
    expect(g.thinkingConfig).toEqual({ thinkingLevel: ThinkingLevel.MINIMAL });

    const [parts, opts] = generateContent.mock.calls[0];
    expect(parts).toHaveLength(1); // crops not sent by default
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends crops when cfg.explainWithImages is true', async () => {
    generateContent.mockResolvedValue(reply(good));
    await explainMistake(
      { prev: 'a', next: 'b', prevCrop: 'data:image/jpeg;base64,AAA', nextCrop: 'data:image/jpeg;base64,BBB' },
      { ...DEFAULT_CONFIG, explainWithImages: true },
    );
    expect(generateContent.mock.calls[0][0]).toHaveLength(5);
  });

  it('reuses the model for the same config', async () => {
    generateContent.mockResolvedValue(reply(good));
    await explainMistake({ prev: 'a', next: 'b' }, DEFAULT_CONFIG);
    await explainMistake({ prev: 'a', next: 'c' }, DEFAULT_CONFIG);
    expect(getGenerativeModel).toHaveBeenCalledTimes(1);
  });

  it('logs when the output looks like pure English', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    generateContent.mockResolvedValue(
      reply({ ...good, hints: ['Look at the sign inside the bracket.', good.hints[1], good.hints[2]] }),
    );
    await explainMistake({ prev: 'a', next: 'b' }, DEFAULT_CONFIG);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/pure English/), ['Look at the sign inside the bracket.']);
  });

  it('does not log for Hinglish output', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    generateContent.mockResolvedValue(reply(good));
    await explainMistake({ prev: 'a', next: 'b' }, DEFAULT_CONFIG);
    expect(warn).not.toHaveBeenCalled();
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

  it('retries once without thinkingConfig when the model rejects it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    generateContent.mockRejectedValueOnce(new Error('thinking_level is not supported')).mockResolvedValue(reply(good));
    const e = await explainMistake({ prev: 'a', next: 'b' }, DEFAULT_CONFIG);
    expect(e.mistakeType).toBe('sign_error_expanding_brackets');
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(lastModelParams().inCloudParams.generationConfig.thinkingConfig).toBeUndefined();    expect(lastModelParams().inCloudParams.generationConfig.maxOutputTokens).toBe(
      EXPLAIN_MAX_OUTPUT_TOKENS * NO_THINKING_TOKEN_MULTIPLIER,
    );
  });

  it('retries both concurrent calls that were sent with thinkingConfig', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let rejectA!: (e: Error) => void;
    let rejectB!: (e: Error) => void;
    generateContent
      .mockImplementationOnce(() => new Promise((_, r) => (rejectA = r)))
      .mockImplementationOnce(() => new Promise((_, r) => (rejectB = r)))
      .mockResolvedValue(reply(good));
    const a = explainMistake({ prev: 'a', next: 'b' }, DEFAULT_CONFIG);
    const b = explainMistake({ prev: 'a', next: 'c' }, DEFAULT_CONFIG);
    await Promise.resolve();
    rejectA(new Error('thinking_level is not supported'));
    await Promise.resolve();
    rejectB(new Error('thinking_level is not supported'));
    const [ea, eb] = await Promise.all([a, b]);
    expect(ea.mistakeType).toBe('sign_error_expanding_brackets');
    expect(eb.mistakeType).toBe('sign_error_expanding_brackets');
    expect(generateContent).toHaveBeenCalledTimes(4);
  });

  it('does not retry a thinking error from a call sent without thinkingConfig', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    generateContent.mockRejectedValue(new Error('thinking something'));
    const err = await explainMistake({ prev: 'a', next: 'b' }, { ...DEFAULT_CONFIG, cloudModel: 'gemini-2.0-flash' }).catch(
      (e: unknown) => e,
    );
    expect(isExplainError(err) && err.kind).toBe('network');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('times out, aborts the request and resolves with the local fallback', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let signal: AbortSignal | undefined;
    generateContent.mockImplementation((_p: unknown, opts?: { signal: AbortSignal }) => {
      signal = opts?.signal;
      return new Promise(() => {});
    });
    const e = await explainMistake({ prev: '-(x-3) = 5', next: '-x-3 = 5' }, DEFAULT_CONFIG, { timeoutMs: 20 });
    expect(isLocalFallback(e)).toBe(true);
    expect(e.mistakeType).toBe('sign_error_expanding_brackets');
    expect(signal?.aborted).toBe(true);
  });
});

describe('explainMistake late answers', () => {
  beforeEach(() => {
    generateContent.mockReset();
  });

  it('with onLate: returns the fallback at the timeout, then delivers the real answer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let resolve!: (v: unknown) => void;
    let signal: AbortSignal | undefined;
    generateContent.mockImplementation((_p: unknown, opts?: { signal: AbortSignal }) => {
      signal = opts?.signal;
      return new Promise((r) => (resolve = r));
    });
    const onLate = vi.fn();
    const e = await explainMistake({ prev: '-(x-3) = 5', next: '-x-3 = 5' }, DEFAULT_CONFIG, { timeoutMs: 20, lateMs: 1000, onLate });
    expect(isLocalFallback(e)).toBe(true);
    expect(signal?.aborted).toBe(false); // still waiting
    resolve(reply(good));
    await new Promise((r) => setTimeout(r, 0));
    expect(onLate).toHaveBeenCalledTimes(1);
    const late = onLate.mock.calls[0][0];
    expect(isLocalFallback(late)).toBe(false);
    expect(late.hinglish).toBe(good.hinglish);
  });

  it('with onLate: aborts after lateMs and never calls onLate', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let signal: AbortSignal | undefined;
    generateContent.mockImplementation((_p: unknown, opts?: { signal: AbortSignal }) => {
      signal = opts?.signal;
      return new Promise((_r, rej) => opts?.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    });
    const onLate = vi.fn();
    const e = await explainMistake({ prev: '-(x-3) = 5', next: '-x-3 = 5' }, DEFAULT_CONFIG, { timeoutMs: 10, lateMs: 40, onLate });
    expect(isLocalFallback(e)).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(signal?.aborted).toBe(true);
    expect(onLate).not.toHaveBeenCalled();
  });

  it('with onLate: a late answer without usable hinglish is not delivered', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let resolve!: (v: unknown) => void;
    generateContent.mockImplementation(() => new Promise((r) => (resolve = r)));
    const onLate = vi.fn();
    await explainMistake({ prev: '-(x-3) = 5', next: '-x-3 = 5' }, DEFAULT_CONFIG, { timeoutMs: 10, lateMs: 1000, onLate });
    resolve(reply('not json'));
    await new Promise((r) => setTimeout(r, 0));
    expect(onLate).not.toHaveBeenCalled();
  });

  it('a fast answer never calls onLate', async () => {
    generateContent.mockResolvedValue(reply(good));
    const onLate = vi.fn();
    const e = await explainMistake({ prev: 'a', next: 'b' }, DEFAULT_CONFIG, { timeoutMs: 1000, onLate });
    expect(isLocalFallback(e)).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(onLate).not.toHaveBeenCalled();
  });
});

describe('explainInEnglish', () => {
  beforeEach(() => {
    generateContent.mockReset();
    getGenerativeModel.mockClear();
    _resetExplainModels();
  });

  const ex = { hinglish: good.hinglish, mistakeLabel: 'Sign error while expanding brackets' };

  it('translates with a short text-only call', async () => {
    generateContent.mockResolvedValue(reply('  In line B the sign of -3 went wrong.  '));
    expect(await explainInEnglish(ex, DEFAULT_CONFIG)).toBe('In line B the sign of -3 went wrong.');
    const p = lastModelParams();
    expect(p.mode).toBe('only_in_cloud');
    expect(p.inCloudParams.generationConfig.responseMimeType).toBeUndefined();
    expect(generateContent.mock.calls[0][0]).toEqual([{ type: 'text', text: good.hinglish }]);
  });

  it('returns an existing english text without a call', async () => {
    expect(await explainInEnglish({ ...ex, english: 'Already here.' }, DEFAULT_CONFIG)).toBe('Already here.');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('falls back to the label on timeout or empty output', async () => {
    generateContent.mockResolvedValueOnce(reply(''));
    expect(await explainInEnglish(ex, DEFAULT_CONFIG)).toMatch(/^Sign error while expanding brackets\./);
    generateContent.mockImplementation(() => new Promise(() => {}));
    expect(await explainInEnglish(ex, DEFAULT_CONFIG, { timeoutMs: 20 })).toMatch(/^Sign error/);
  });

  it('rejects with a network ExplainError when the call fails', async () => {
    generateContent.mockRejectedValue(new Error('offline'));
    const err = await explainInEnglish(ex, DEFAULT_CONFIG).catch((e: unknown) => e);
    expect(isExplainError(err) && err.kind).toBe('network');
  });
});
