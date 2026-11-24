import { describe, expect, it } from 'vitest';
import { getMistakeType, MISTAKE_SLUGS, MISTAKE_TYPES, toMistakeSlug } from './mistakeTypes';

describe('mistake taxonomy', () => {
  it('has unique snake_case slugs including the required ones and other', () => {
    expect(MISTAKE_TYPES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(MISTAKE_SLUGS).size).toBe(MISTAKE_SLUGS.length);
    for (const s of MISTAKE_SLUGS) expect(s).toMatch(/^[a-z]+(_[a-z]+)*$/);
    for (const s of [
      'sign_error_expanding_brackets', 'wrong_sign_moving_term', 'distribution_error', 'exponent_rule_error',
      'fraction_addition_error', 'division_by_variable', 'square_root_missing_negative', 'derivative_power_rule',
      'chain_rule_missing', 'arithmetic_slip', 'copying_error', 'other',
    ]) expect(MISTAKE_SLUGS).toContain(s);
  });

  it('every entry has non-empty English and Hinglish labels, no Devanagari', () => {
    for (const t of MISTAKE_TYPES) {
      expect(t.label.trim()).not.toBe('');
      expect(t.labelHinglish.trim()).not.toBe('');
      expect(t.labelHinglish).not.toMatch(/[ऀ-ॿ]/);
    }
  });

  it('maps known slugs, tolerating case, spaces and hyphens', () => {
    expect(toMistakeSlug('chain_rule_missing')).toBe('chain_rule_missing');
    expect(toMistakeSlug('  Chain-Rule Missing ')).toBe('chain_rule_missing');
  });

  it('maps unknown or non-string values to other', () => {
    expect(toMistakeSlug('dropped_minus')).toBe('other');
    expect(toMistakeSlug('')).toBe('other');
    expect(toMistakeSlug(undefined)).toBe('other');
    expect(toMistakeSlug(42)).toBe('other');
    expect(getMistakeType('nope').slug).toBe('other');
    expect(getMistakeType('arithmetic_slip').label).toBe('Arithmetic slip');
  });
});
