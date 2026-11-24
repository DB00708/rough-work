// T2: deterministic step checker. Compares line N with line N-1.
//
// Rules (PRD sections 3-4 and the risks table: a false red flag is worse than
// "unsure", so anything we cannot judge is 'unparseable', never 'not_equivalent'):
//
// Expressions (no "="):
//   Equivalent when they take the same value at test points (several fixed,
//   "untidy" points; points with division by zero or sqrt/log of a negative are
//   skipped). nerdamer's expand(prev - next) == 0 is a backup when too few
//   points can be evaluated. Any differing point -> not_equivalent.
//
// Equations (a = b), with f = a1 - b1 and g = a2 - b2:
//   0. If the two lines use different variables ("2x + y = 5" -> "y = 3"),
//      the student probably used another equation of a system: unparseable.
//   1. If both are identities (true for every value) -> equivalent. If exactly
//      one is, the step is wrong.
//   2. If g = k*f for a nonzero constant k -> equivalent (terms moved, both
//      sides multiplied or divided by a number, sides swapped).
//   3. Otherwise compare real solution sets S_prev, S_next (for several
//      variables: in one variable, with the others fixed at test values):
//      - S_next ⊆ S_prev (not empty): equivalent. This covers bare value lines
//        and PARTIAL solutions: "x^2 = 4" -> "x = 2" is accepted, with a reason
//        that names the missing root (x=-2). We accept this on purpose: students
//        often write one root first, and a red flag here would be a false alarm.
//        The same rule accepts "x^2 = 2x" -> "x = 2" (lost x=0); the reason
//        still names the lost root so the UI can hint at it.
//      - S_prev ⊆ S_next: equivalent. The step is a valid implication that may
//        add extra roots, e.g. squaring both sides of a sqrt equation. The
//        reason names the extra roots.
//      - otherwise (a new root that the previous line does not have, or no
//        roots left): not_equivalent.
//      - no real roots on either side: unparseable (cannot judge).
//   4. Two or more variables: "x + y = 5" -> "x - y = 1" is how students write
//      the second equation of a system. So with several variables a failed
//      check is 'unparseable', unless the new line isolates one variable
//      ("y = 5 - 2x"), which is a rewrite we can judge.
//   Answer lists "x = 2, -2", "x = ±2", "x = 2 or x = -2", "x + 1 = ±3" are
//   checked the same way: every listed value must solve the previous line.
//
// Rounding: if the new line has decimals ("x = 0.33", "3.14"), a difference
//   within the precision written is accepted ("matches after rounding"). A
//   slightly bigger difference (with 2+ decimals) is 'unparseable', not wrong.
//
// Mixed lines:
//   equation -> expression: equivalent if the expression equals the left
//   side, the right side, or left minus right. Otherwise unparseable.
//   expression -> equation: one side must equal the expression; the other side
//   is then checked against it. If neither side matches -> unparseable.
//
// Unparseable on purpose: derivatives (d/dx), unknown functions (cbrt, log2),
//   inverse trig, mixing log (base 10) with ln, ambiguous "1/2x" or "a/bc",
//   inequalities, parse errors. Never throws.

import nerdamer from 'nerdamer';
import type { StepCheck } from './types';
import { AMBIGUOUS, normalizePlain } from './check/normalize';
import {
  close,
  describePoint,
  fmt,
  roots1D,
  sampleValue,
  samplePoints,
  type Fn,
} from './check/numeric';

export { normalizePlain };

interface Side {
  src: string;
  expr: nerdamer.Expression;
}

type Parsed =
  | { kind: 'expr'; e: Side }
  | { kind: 'eq'; l: Side; r: Side }
  | { kind: 'list'; lhs: Side; values: number[] }
  | { kind: 'bad'; reason: string };

/** Relative tolerance allowed for rounded decimals in the new line, or null. */
type RoundTol = number | null;

const unparseable = (reason: string): StepCheck => ({ verdict: 'unparseable', reason });
const equivalent = (reason: string): StepCheck => ({ verdict: 'equivalent', reason });
const wrong = (reason: string): StepCheck => ({ verdict: 'not_equivalent', reason });

const ALLOWED = /^[0-9a-zA-Z+\-*/^().,=]*$/;
const DERIVATIVE = /d\s*[a-zA-Z]?\s*\/\s*d\s*[a-zA-Z]/;

function parseSide(src: string): Side {
  if (!src) throw new Error('empty side');
  if (/^[*/^]|[+\-*/^]$/.test(src)) throw new Error('dangling operator');
  const expr = nerdamer(src);
  // Our tokenizer only makes one-letter variables; anything longer is a name
  // we do not understand.
  if (expr.variables().some((v) => v.length > 1)) throw new Error('unknown name');
  return { src, expr };
}

function constantValue(src: string): number {
  const e = nerdamer(src);
  if (e.variables().length) throw new Error('not a number');
  const v = e.buildFunction([])();
  if (!Number.isFinite(v)) throw new Error('not finite');
  return v;
}

/** "x=2,-2", "x=+/-2", "x=2,x=-2", "x+1=+/-3" -> left side and its values. */
function parseList(s: string): Parsed {
  const parts = s.split(',');
  const eq = parts[0].indexOf('=');
  if (eq <= 0) return { kind: 'bad', reason: 'cannot read the answer list' };
  const lhsSrc = parts[0].slice(0, eq);
  const lhs = parseSide(lhsSrc);
  if (!lhs.expr.variables().length) return { kind: 'bad', reason: 'cannot read the answer list' };
  const exprs = [parts[0].slice(eq + 1), ...parts.slice(1).map((p) => (p.startsWith(lhsSrc + '=') ? p.slice(lhsSrc.length + 1) : p))];
  const values: number[] = [];
  for (const e of exprs) {
    if (!e || e.includes('=')) return { kind: 'bad', reason: 'cannot read the answer list' };
    const pm = e.split('+/-');
    if (pm.length > 2) return { kind: 'bad', reason: 'cannot read ± here' };
    const variants = pm.length === 2 ? [`${pm[0]}+(${pm[1]})`, `${pm[0]}-(${pm[1]})`] : [e];
    for (const vs of variants) values.push(constantValue(vs.replace(/^\+/, '')));
  }
  return { kind: 'list', lhs, values };
}

function parseLine(raw: string, s: string): Parsed {
  if (!s) return { kind: 'bad', reason: 'empty line' };
  if (DERIVATIVE.test(String(raw))) return { kind: 'bad', reason: 'derivatives are not checked' };
  if (/[<>≤≥≠]/.test(s)) return { kind: 'bad', reason: 'inequalities are not checked' };
  if (s.includes(AMBIGUOUS)) return { kind: 'bad', reason: `unsupported or ambiguous notation in "${s}" (write 1/(2x) or (1/2)x)` };
  if (!ALLOWED.test(s.replace(/\+\/-/g, ''))) return { kind: 'bad', reason: `unknown symbol in "${s}"` };
  if (s.includes(',') || s.includes('+/-')) {
    try {
      return parseList(s);
    } catch {
      return { kind: 'bad', reason: 'cannot read the answer list' };
    }
  }
  const sides = s.split('=');
  try {
    if (sides.length === 1) return { kind: 'expr', e: parseSide(s) };
    if (sides.length === 2) return { kind: 'eq', l: parseSide(sides[0]), r: parseSide(sides[1]) };
  } catch {
    return { kind: 'bad', reason: `cannot parse "${s}"` };
  }
  return { kind: 'bad', reason: 'more than one "=" in the line' };
}

/** Coarsest decimal precision written in a line: "x=0.33" -> 0.505e-2. */
function roundTolOf(s: string): RoundTol {
  const ds = [...s.matchAll(/\d\.(\d+)/g)].map((m) => m[1].length);
  if (!ds.length) return null;
  return 0.505 * 10 ** -Math.min(...ds);
}

function varsOf(...sides: Side[]): string[] {
  const set = new Set<string>();
  for (const s of sides) for (const v of s.expr.variables()) set.add(v);
  return [...set].sort();
}

function compile(side: Side, vars: string[]): Fn {
  const f = side.expr.buildFunction(vars);
  return (...p: number[]) => {
    try {
      const v = f(...p);
      return typeof v === 'number' ? v : NaN;
    } catch {
      return NaN;
    }
  };
}

type NumResult =
  | { kind: 'same'; n: number }
  | { kind: 'diff'; p: number[]; a: number; b: number }
  | { kind: 'unknown' };

const MIN_POINTS = 4;

/** Compare two compiled functions at the sample points. */
function numericCompare(fa: Fn, fb: Fn, nVars: number, rel = 1e-7): NumResult {
  let n = 0;
  for (const p of samplePoints(nVars)) {
    const a = fa(...p);
    const b = fb(...p);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (!close(a, b, rel)) return { kind: 'diff', p, a, b };
    n++;
    if (n >= 8) break;
  }
  return n >= MIN_POINTS ? { kind: 'same', n } : { kind: 'unknown' };
}

function symbolicZero(a: Side, b: Side): boolean {
  if (a.src.length + b.src.length > 300) return false;
  try {
    return nerdamer(`expand((${a.src})-(${b.src}))`).toString() === '0';
  } catch {
    return false;
  }
}

function diffReason(vars: string[], r: { p: number[]; a: number; b: number }): string {
  if (!vars.length) return `values differ: ${fmt(r.a)} vs ${fmt(r.b)}`;
  return `differs at ${describePoint(vars, r.p)}`;
}

function compareExpr(a: Side, b: Side, rt: RoundTol): StepCheck {
  const vars = varsOf(a, b);
  const fa = compile(a, vars);
  const fb = compile(b, vars);
  const res = numericCompare(fa, fb, vars.length);
  if (res.kind === 'diff') {
    if (rt !== null) {
      if (numericCompare(fa, fb, vars.length, rt).kind === 'same') return equivalent('matches after rounding');
      // 2+ decimals, with variables, and close ("0.33x" vs "x/3"): rounding
      // grows when multiplied by a variable, so say unsure rather than wrong.
      if (rt < 0.01 && vars.length > 0 && numericCompare(fa, fb, vars.length, 4 * rt).kind === 'same') {
        return unparseable('close, but rounding makes it hard to tell');
      }
    }
    return wrong(diffReason(vars, res));
  }
  if (res.kind === 'same') return equivalent(`same value at ${res.n} test points`);
  if (symbolicZero(a, b)) return equivalent('simplifies to the same expression');
  return unparseable('could not evaluate these expressions');
}

/** If one side is a bare variable not used on the other side, return it. */
function isolatedVar(l: Side, r: Side): string | null {
  for (const [x, y] of [[l, r], [r, l]] as const) {
    if (/^[a-zA-Z]$/.test(x.src) && !y.expr.variables().includes(x.src)) return x.src;
  }
  return null;
}

function rootList(v: string, rs: number[]): string {
  return rs.map((r) => `${v}=${fmt(r)}`).join(', ');
}

function notSatisfy(v: string, rs: number[]): string {
  return `${rootList(v, rs)} ${rs.length > 1 ? 'do' : 'does'} not satisfy the previous line`;
}

/**
 * Judge two real solution sets of one variable. `inF(r)` / `inG(r)` say whether
 * r solves the previous / new line. Returns null when neither has roots.
 */
function judgeRoots(
  v: string,
  rf: number[],
  rg: number[],
  inF: (r: number) => boolean,
  inG: (r: number) => boolean,
  rt: RoundTol,
  where = '',
): StepCheck | null {
  if (!rf.length && !rg.length) return null;
  const classify = (isF: (r: number) => boolean, isG: (r: number) => boolean, tag: string): StepCheck => {
    if (!rg.length) return wrong(`previous line gives ${rootList(v, rf)}, this line has no real solution${where}`);
    const newRoots = rg.filter((r) => !isF(r));
    const missing = rf.filter((r) => !isG(r));
    if (newRoots.length && (missing.length || !rf.length)) return wrong(`${notSatisfy(v, newRoots)}${where}`);
    if (!newRoots.length && !missing.length) return equivalent(`same solutions${tag}`);
    if (!newRoots.length) return equivalent(`partial: ${rootList(v, missing)} also solves the previous line${tag}`);
    return equivalent(`valid step, but check the extra root ${rootList(v, newRoots)}${tag}`);
  };
  const strict = classify(inF, inG, '');
  if (strict.verdict !== 'not_equivalent' || rt === null) return strict;
  const near = (list: number[]) => (r: number) => list.some((x) => Math.abs(x - r) <= rt * Math.max(1, Math.abs(x)));
  const loose = classify((r) => inF(r) || near(rf)(r), (r) => inG(r) || near(rg)(r), ' (after rounding)');
  return loose.verdict === 'not_equivalent' ? strict : loose;
}

function compareEq(pl: Side, pr: Side, nl: Side, nr: Side, rt: RoundTol): StepCheck {
  // Different variables (e.g. "2x + y = 5" -> "y = 3") usually means the
  // student used another equation of a system. We cannot judge that alone.
  if (varsOf(pl, pr).join() !== varsOf(nl, nr).join()) {
    return unparseable('the variables changed; this may use another equation');
  }
  const vars = varsOf(pl, pr, nl, nr);
  const n = vars.length;
  const [fpl, fpr, fnl, fnr] = [pl, pr, nl, nr].map((s) => compile(s, vars));

  // 1. identities
  const prevId = numericCompare(fpl, fpr, n);
  const nextId = numericCompare(fnl, fnr, n);
  if (prevId.kind === 'same' && nextId.kind === 'same') return equivalent('both lines are true for every value');
  if (prevId.kind === 'same' && nextId.kind === 'diff') {
    return wrong(`previous line holds for every value, this one fails at ${describePoint(vars, nextId.p)}`);
  }
  if (prevId.kind === 'diff' && nextId.kind === 'same') {
    return wrong('this line is true for every value, so the equation was lost');
  }

  const F: Fn = (...p) => fpl(...p) - fpr(...p);
  const G: Fn = (...p) => fnl(...p) - fnr(...p);
  const SF: Fn = (...p) => Math.max(1, Math.abs(fpl(...p)), Math.abs(fpr(...p)));
  const SG: Fn = (...p) => Math.max(1, Math.abs(fnl(...p)), Math.abs(fnr(...p)));

  // 2. g = k * f for a nonzero constant k
  let k: number | null = null;
  let proportional = true;
  let used = 0;
  for (const p of samplePoints(n)) {
    const f = F(...p);
    const g = G(...p);
    if (!Number.isFinite(f) || !Number.isFinite(g)) continue;
    used++;
    const fz = Math.abs(f) <= 1e-9 * SF(...p);
    const gz = Math.abs(g) <= 1e-9 * SG(...p);
    if (fz || gz) {
      if (fz !== gz) { proportional = false; break; }
      continue;
    }
    const ratio = g / f;
    if (k === null) k = ratio;
    else if (!close(k, ratio, 1e-6)) { proportional = false; break; }
    if (used >= 10) break;
  }
  if (proportional && k !== null && used >= MIN_POINTS && Math.abs(k) > 1e-12) {
    return equivalent(close(k, 1) || close(k, -1) ? 'same equation, rearranged' : `same equation, scaled by ${fmt(k)}`);
  }

  // 3. solution sets, sliced along one variable
  if (n === 0) return unparseable('could not compare these equations');
  const isolated = isolatedVar(nl, nr) ?? isolatedVar(pl, pr);
  const v = isolated ?? vars[0];
  const vi = vars.indexOf(v);
  const others = vars.filter((x) => x !== v);
  const trials = others.length ? 3 : 1;
  let decided: StepCheck | null = null;
  for (let t = 0; t < trials; t++) {
    const fixed = vars.map((_, idx) => sampleValue(t + 3, idx));
    const at = (fn: Fn) => (x: number) => {
      const p = fixed.slice();
      p[vi] = x;
      return fn(...p);
    };
    const hF = at(F);
    const hG = at(G);
    const sF = at(SF);
    const sG = at(SG);
    const rf = roots1D(hF, sF);
    const rg = roots1D(hG, sG);
    const inF = (r: number) => rf.some((x) => close(x, r, 1e-5)) || Math.abs(hF(r)) <= 1e-9 * sF(r);
    const inG = (r: number) => rg.some((x) => close(x, r, 1e-5)) || Math.abs(hG(r)) <= 1e-9 * sG(r);
    const where = others.length ? ` (with ${describePoint(others, others.map((o) => fixed[vars.indexOf(o)]))})` : '';
    const res = judgeRoots(v, rf, rg, inF, inG, rt, where);
    if (!res) continue; // cannot judge this slice
    if (res.verdict === 'not_equivalent') {
      // 4. several variables and no isolated variable: maybe a new equation of a system.
      if (n > 1 && !isolated) return unparseable('not a rearrangement; this may be another equation of the system');
      return res;
    }
    decided ??= res;
  }
  return decided ?? unparseable('could not compare these equations');
}

function compareEqToList(pl: Side, pr: Side, lhs: Side, values: number[], rt: RoundTol): StepCheck {
  const vars = varsOf(pl, pr, lhs);
  if (vars.length !== 1) return unparseable('cannot check this answer list against the previous line');
  const v = vars[0];
  const [fl, fr, fh] = [pl, pr, lhs].map((s) => compile(s, vars));
  const hF = (x: number) => fl(x) - fr(x);
  const sF = (x: number) => Math.max(1, Math.abs(fl(x)), Math.abs(fr(x)));
  const rf = roots1D(hF, sF);
  // Solutions of the new line: x with lhs(x) equal to one of the values.
  const bare = lhs.src === v;
  const rg = bare
    ? [...values].sort((a, b) => a - b)
    : values.flatMap((c) => roots1D((x) => fh(x) - c, (x) => Math.max(1, Math.abs(fh(x)), Math.abs(c))));
  const inF = (r: number) => rf.some((x) => close(x, r, 1e-5)) || Math.abs(hF(r)) <= 1e-9 * sF(r);
  const inG = (r: number) => values.some((c) => Math.abs(fh(r) - c) <= 1e-9 * Math.max(1, Math.abs(c)));
  return judgeRoots(v, rf, rg, inF, inG, rt) ?? unparseable('could not compare these lines');
}

function compareEqToExpr(l: Side, r: Side, e: Side, rt: RoundTol): StepCheck {
  const candidates: [string, Side][] = [['left side', l], ['right side', r]];
  try {
    candidates.push(['left minus right', parseSide(`(${l.src})-(${r.src})`)]);
  } catch {
    /* ignore */
  }
  for (const [name, side] of candidates) {
    if (compareExpr(side, e, rt).verdict === 'equivalent') return equivalent(`continues the ${name}`);
  }
  return unparseable('cannot tell which part of the previous line this continues');
}

function compareExprToEq(e: Side, l: Side, r: Side, rt: RoundTol): StepCheck {
  const left = compareExpr(e, l, rt);
  const right = compareExpr(e, r, rt);
  if (left.verdict === 'equivalent' && right.verdict === 'equivalent') return equivalent('both sides equal the previous line');
  if (left.verdict === 'equivalent') return right.verdict === 'not_equivalent' ? wrong(`right side: ${right.reason}`) : right;
  if (right.verdict === 'equivalent') return left.verdict === 'not_equivalent' ? wrong(`left side: ${left.reason}`) : left;
  return unparseable('neither side matches the previous line');
}

const hasLn = (s: string) => /log\(/.test(s);
const hasLog10 = (s: string) => /log10\(/.test(s);

/** Is `next` a valid step from `prev`? Never throws. */
export function checkStep(prevPlain: string, nextPlain: string): StepCheck {
  try {
    const sa = normalizePlain(prevPlain);
    const sb = normalizePlain(nextPlain);
    const a = parseLine(prevPlain, sa);
    const b = parseLine(nextPlain, sb);
    if (a.kind === 'bad') return unparseable(`previous line: ${a.reason}`);
    if (b.kind === 'bad') return unparseable(b.reason);
    if ((hasLn(sa) && hasLog10(sb)) || (hasLog10(sa) && hasLn(sb))) {
      return unparseable('log (base 10) and ln are mixed; cannot tell which base is meant');
    }
    const rt = roundTolOf(sb);
    if (a.kind === 'expr' && b.kind === 'expr') return compareExpr(a.e, b.e, rt);
    if (a.kind === 'eq' && b.kind === 'eq') return compareEq(a.l, a.r, b.l, b.r, rt);
    if (a.kind === 'eq' && b.kind === 'list') return compareEqToList(a.l, a.r, b.lhs, b.values, rt);
    if (a.kind === 'eq' && b.kind === 'expr') return compareEqToExpr(a.l, a.r, b.e, rt);
    if (a.kind === 'expr' && b.kind === 'eq') return compareExprToEq(a.e, b.l, b.r, rt);
    return unparseable('cannot compare these two kinds of line');
  } catch (err) {
    return unparseable(`checker error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
