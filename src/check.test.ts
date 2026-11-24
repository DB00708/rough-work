import { describe, expect, it } from 'vitest';
import { checkStep, normalizePlain } from './check';

const ok = (a: string, b: string) => expect(checkStep(a, b).verdict, `${a}  ->  ${b}`).toBe('equivalent');
const bad = (a: string, b: string) => expect(checkStep(a, b).verdict, `${a}  ->  ${b}`).toBe('not_equivalent');
const unsure = (a: string, b: string) => expect(checkStep(a, b).verdict, `${a}  ->  ${b}`).toBe('unparseable');

describe('normalizePlain', () => {
  it.each([
    ['2x+3=7', '2*x+3=7'],
    ['3(x+1)', '3*(x+1)'],
    ['(x+1)(x-1)', '(x+1)*(x-1)'],
    ['x(x+2)', 'x*(x+2)'],
    ['2xy', '2*x*y'],
    ['x² − 4 = 0', 'x^(2)-4=0'],
    ['6 × 2 ÷ 3', '6*2/3'],
    ['a · b', 'a*b'],
    ['x**2', 'x^2'],
    ['∴ x = 2.', 'x=2'],
    ['=> 2x = 4', '2*x=4'],
    ['therefore x = 5', 'x=5'],
    ['= x^2 + 2x + 1', 'x^2+2*x+1'],
    ['\\frac{x+1}{2} = 3', '((x+1)/(2))=3'],
    ['\\frac{\\frac{1}{x}}{2}', '((((1)/(x)))/(2))'],
    ['2 \\cdot \\left( x + 1 \\right)', '2*(x+1)'],
    ['$x^{2}$', 'x^(2)'],
    ['\\sqrt{x+1}', 'sqrt(x+1)'],
    ['√x', 'sqrt(x)'],
    ['sin x + 2sin(x)', 'sin(x)+2*sin(x)'],
    ['ln x', 'log(x)'],
    ['x = ±2', 'x=+/-2'],
    ['x = 2 or x = -2', 'x=2,x=-2'],
    ['2πr', '2*pi*r'],
    ['  2 x  +  1 ', '2*x+1'],
    ['', ''],
  ])('%s -> %s', (input, out) => {
    expect(normalizePlain(input)).toBe(out);
  });

  it('is idempotent', () => {
    for (const s of ['2x(x+1)=4', '\\frac{a}{b}', 'x² + 3x', 'sin x']) {
      const once = normalizePlain(s);
      expect(normalizePlain(once)).toBe(once);
    }
  });
});

describe('checkStep: expressions', () => {
  it('accepts correct expansion and factorisation', () => {
    ok('(x+1)^2', 'x^2+2x+1');
    ok('x^2-9', '(x-3)(x+3)');
    ok('2(x+3)', '2x+6');
    ok('x^2+5x+6', '(x+2)(x+3)');
    ok('3+4*2', '11');
  });

  it('accepts fraction simplification (removable division by zero skipped)', () => {
    ok('(x^2-1)/(x-1)', 'x+1');
    ok('1/2 + 1/3', '5/6');
    ok('1/x + 1/y', '(x+y)/(x*y)');
  });

  it('flags dropped minus when expanding brackets', () => {
    const r = checkStep('5 - (x - 3)', '5 - x - 3');
    expect(r.verdict).toBe('not_equivalent');
    expect(r.reason).toMatch(/^differs at x=/);
  });

  it('flags squaring errors', () => {
    bad('(x+3)^2', 'x^2+9');
    bad('(a-b)^2', 'a^2-b^2');
  });

  it('flags factorisation errors', () => {
    bad('x^2-5x+6', '(x-1)(x-6)');
    bad('x^2+5x+6', '(x+1)(x+6)');
  });

  it('flags fraction errors', () => {
    bad('1/2 + 1/3', '2/5');
    bad('1/x + 1/y', '1/(x+y)');
    bad('(x+2)/2', 'x');
  });

  it('gives a numeric reason for constants', () => {
    expect(checkStep('3+4', '8').reason).toBe('values differ: 7 vs 8');
  });

  it('handles sqrt domains by skipping negative points', () => {
    ok('sqrt(x)*sqrt(x)', 'x');
    ok('sqrt(4x)', '2sqrt(x)');
  });
});

describe('checkStep: equations', () => {
  it('accepts moving terms and dividing through', () => {
    ok('2x+3=7', '2x=4');
    ok('2x=4', 'x=2');
    ok('2x+3=7', 'x=2');
    ok('7=2x+3', '2x=4');
    ok('3x - 5 = x + 7', '2x = 12');
    ok('x/2 = 3', 'x = 6');
  });

  it('accepts multi-variable rearranging', () => {
    ok('2x + y = 5', 'y = 5 - 2x');
    ok('x*y = 6', 'y = 6/x');
  });

  it('flags wrong sign when moving terms', () => {
    const r = checkStep('2x+3=7', '2x=10');
    expect(r.verdict).toBe('not_equivalent');
    expect(r.reason).toContain('x=5');
    bad('3x - 5 = x + 7', '2x = 2');
  });

  it('flags a wrong final value', () => {
    bad('2x=4', 'x=3');
    bad('x/2 = 3', 'x = 1.5');
  });

  it('quadratics: full solution, partial solution, wrong root', () => {
    ok('x^2=4', 'x^2-4=0');
    ok('x^2-4=0', '(x-2)(x+2)=0');
    // Partial solution is accepted (subset rule), reason names the missing root.
    const partial = checkStep('x^2=4', 'x=2');
    expect(partial.verdict).toBe('equivalent');
    expect(partial.reason).toContain('x=-2');
    ok('x^2 = 4', 'x = ±2');
    ok('x^2 = 4', 'x = 2, -2');
    ok('x^2 - 5x + 6 = 0', 'x = 2 or x = 3');
    bad('x^2 = 4', 'x = 4');
    bad('x^2 - 5x + 6 = 0', 'x = 2, 4');
    bad('x^2 - 5x + 6 = 0', '(x-1)(x-6) = 0');
  });

  it('accepts squaring both sides (adds an extra root, reason says so)', () => {
    const r = checkStep('sqrt(x+2) = x', 'x+2 = x^2');
    expect(r.verdict).toBe('equivalent');
    expect(r.reason).toContain('x=-1');
  });

  it('accepts clearing a fraction even though the ratio is not constant', () => {
    ok('1/x = 2', '1 = 2x');
  });

  it('identities', () => {
    ok('(x+1)^2 = x^2+2x+1', 'x^2+2x+1 = x^2+2x+1');
    bad('(x+1)^2 = x^2+2x+1', 'x^2+2x+1 = x^2+1');
    bad('2x+3=7', '2x+3=2x+3');
  });

  it('does not flag a system step that drops a variable (no false red flag)', () => {
    unsure('2x + y = 5', 'y = 3');
  });

  it('uses plural wording for several bad roots', () => {
    expect(checkStep('x^2 - 5x + 6 = 0', '(x-1)(x-6) = 0').reason).toBe('x=1, x=6 do not satisfy the previous line');
  });

  it('cannot judge equations with no real roots and different shapes', () => {
    unsure('x^2 = -4', 'x^4 = -16');
  });
});

describe('checkStep: mixed lines', () => {
  it('equation -> one side', () => {
    ok('x^2 - 4 = (x-2)(x+2)', 'x^2 - 4');
    unsure('x^2 - 4 = 0', 'x^2 + 4');
  });

  it('expression -> equation that continues it', () => {
    ok('(x+1)^2', '(x+1)^2 = x^2+2x+1');
    bad('(x+1)^2', '(x+1)^2 = x^2+1');
    unsure('(x+1)^2', 'y = 3');
  });
});

describe('checkStep: unparseable input', () => {
  it.each([
    ['2x+3=7', ''],
    ['2x+3=7', '2x+=4'],
    ['2x+3=7', '2x = 4 = 4'],
    ['2x+3=7', 'x > 2'],
    ['2x+3=7', '2x @ 4'],
    ['2x+3=7', '((x+1)'],
    ['', 'x = 2'],
    ['2x+3=7', '\\unknown{x}'],
  ])('%s -> %s', (a, b) => {
    unsure(a, b);
  });

  it('never throws on junk', () => {
    for (const junk of [undefined as unknown as string, null as unknown as string, '=', '==', '()', '^^', 'x^', '1/0', '0/0=x']) {
      expect(() => checkStep(junk, 'x=1')).not.toThrow();
      expect(() => checkStep('x=1', junk)).not.toThrow();
    }
  });
});

describe('checkStep: speed', () => {
  it('each check takes under 50 ms (after warm-up)', () => {
    checkStep('x^2=4', 'x=2'); // warm-up: nerdamer parser init
    const cases: [string, string][] = [
      ['x^2 - 5x + 6 = 0', '(x-2)(x-3) = 0'],
      ['x*y = 6', 'y = 6/x'],
      ['(x+1)^2', 'x^2+2x+1'],
      ['sqrt(x+2) = x', 'x+2 = x^2'],
      ['x^2 = -4', 'x^4 = -16'],
    ];
    for (const [a, b] of cases) {
      const t0 = performance.now();
      checkStep(a, b);
      expect(performance.now() - t0, `${a} -> ${b}`).toBeLessThan(50);
    }
  });
});
