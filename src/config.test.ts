import { describe, expect, it } from 'vitest';
import templateText from '../remoteconfig.template.json?raw';
import {
  DEFAULT_CONFIG,
  RC_KEYS,
  loadConfig,
  parseBoundedNumber,
  parseConfig,
  parseModelName,
  parseText,
  resetConfigCache,
  toRemoteDefaults,
} from './config';

describe('parseBoundedNumber', () => {
  it('parses valid numbers', () => {
    expect(parseBoundedNumber('8000', 1, 0, 10_000)).toBe(8000);
    expect(parseBoundedNumber(' 0.75 ', 1, 0, 1)).toBe(0.75);
  });
  it('accepts the bounds themselves', () => {
    expect(parseBoundedNumber('0', 0.5, 0, 1)).toBe(0);
    expect(parseBoundedNumber('1', 0.5, 0, 1)).toBe(1);
  });
  it('falls back on missing, empty or junk input', () => {
    for (const raw of [undefined, '', '   ', 'abc', 'NaN', 'Infinity', '12px', '1e400']) {
      expect(parseBoundedNumber(raw, 42, 0, 100)).toBe(42);
    }
  });
  it('falls back when out of bounds', () => {
    expect(parseBoundedNumber('-0.1', 0.6, 0, 1)).toBe(0.6);
    expect(parseBoundedNumber('1.5', 0.6, 0, 1)).toBe(0.6);
  });
  it('falls back on fractions when an integer is required', () => {
    expect(parseBoundedNumber('2500.5', 8000, 2000, 10_000, true)).toBe(8000);
    expect(parseBoundedNumber('2500', 8000, 2000, 10_000, true)).toBe(2500);
  });
});

describe('parseText and parseModelName', () => {
  it('trims text and falls back on empty or huge text', () => {
    expect(parseText('  hi  ', 'd')).toBe('hi');
    expect(parseText('   ', 'd')).toBe('d');
    expect(parseText(undefined, 'd')).toBe('d');
    expect(parseText('x'.repeat(9000), 'd')).toBe('d');
  });
  it('accepts model names and rejects junk', () => {
    expect(parseModelName('gemini-2.5-flash', 'd')).toBe('gemini-2.5-flash');
    expect(parseModelName(' gemini-3.5-flash-lite ', 'd')).toBe('gemini-3.5-flash-lite');
    for (const raw of ['', 'models/../x', 'gemini flash', '<script>', undefined]) {
      expect(parseModelName(raw, 'd')).toBe('d');
    }
  });
});

describe('parseConfig', () => {
  it('returns defaults for an empty map', () => {
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it('round-trips the defaults through Remote Config strings', () => {
    expect(parseConfig(toRemoteDefaults())).toEqual(DEFAULT_CONFIG);
  });

  it('reads valid remote values', () => {
    const cfg = parseConfig({
      frame_interval_ms: '5000',
      cloud_frame_interval_ms: '30000',
      confidence_threshold: '0.7',
      daily_cloud_cap: '10',
      read_prompt: 'read',
      explain_prompt: 'explain',
      cloud_model: 'gemini-2.5-flash',
    });
    expect(cfg).toEqual({
      frameIntervalMs: 5000,
      cloudFrameIntervalMs: 30000,
      confidenceThreshold: 0.7,
      dailyCloudCap: 10,
      readPrompt: 'read',
      explainPrompt: 'explain',
      cloudModel: 'gemini-2.5-flash',
    });
  });

  it('replaces each bad value with its own default', () => {
    const cfg = parseConfig({
      frame_interval_ms: '500', // below 2000
      cloud_frame_interval_ms: 'fast',
      confidence_threshold: '60', // percent, not 0..1
      daily_cloud_cap: '-1',
      read_prompt: '',
      cloud_model: 'bad model',
    });
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it('never lets cloud mode poll faster than device mode', () => {
    const cfg = parseConfig({ frame_interval_ms: '15000', cloud_frame_interval_ms: '5000' });
    expect(cfg.frameIntervalMs).toBe(15000);
    expect(cfg.cloudFrameIntervalMs).toBe(15000);
  });

  it('allows a daily cloud cap of 0 (cloud off)', () => {
    expect(parseConfig({ daily_cloud_cap: '0' }).dailyCloudCap).toBe(0);
  });
});

describe('DEFAULT_CONFIG prompts', () => {
  it('read prompt asks for the JSON fields read.ts expects', () => {
    for (const field of ['latex', 'plain', 'confidence']) {
      expect(DEFAULT_CONFIG.readPrompt).toContain(`"${field}"`);
    }
  });
  it('explain prompt asks for every Explanation field', () => {
    for (const field of ['hinglish', 'english', 'hints', 'mistakeType', 'mistakeLabel', 'mistakeLabelHinglish']) {
      expect(DEFAULT_CONFIG.explainPrompt).toContain(`"${field}"`);
    }
  });
});

describe('remoteconfig.template.json', () => {
  const template = JSON.parse(templateText) as {
    parameters: Record<string, { defaultValue: { value: string }; valueType: string }>;
  };

  it('has exactly the RC_KEYS parameters', () => {
    expect(Object.keys(template.parameters).sort()).toEqual(Object.values(RC_KEYS).sort());
  });

  it('matches DEFAULT_CONFIG', () => {
    const values: Record<string, string> = {};
    for (const [k, p] of Object.entries(template.parameters)) values[k] = p.defaultValue.value;
    expect(values).toEqual(toRemoteDefaults());
  });
});

describe('loadConfig', () => {
  it('returns defaults when no Firebase app is initialized', async () => {
    resetConfigCache();
    await expect(loadConfig()).resolves.toEqual(DEFAULT_CONFIG);
  });
});
