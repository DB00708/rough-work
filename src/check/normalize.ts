// Turns model output (plain maths, sometimes with LaTeX or unicode leftovers)
// into ASCII that nerdamer can parse, e.g. "∴ 2x(x+1) = 4÷2." -> "2*x*(x+1)=4/2".
// Never throws. Unknown characters are kept, so the checker can report them
// as unparseable instead of guessing.

/** Function names we accept, mapped to nerdamer names. */
const FUNCS: Record<string, string> = {
  sqrt: 'sqrt',
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  cot: 'cot',
  sec: 'sec',
  csc: 'csc',
  abs: 'abs',
  exp: 'exp',
  ln: 'log', // nerdamer log = natural log
  log: 'log10', // school maths in India: log means base 10
};
const CONSTS: Record<string, string> = { pi: 'pi' };
/**
 * Names we recognise but do not check. They become "?" so the checker says
 * "unparseable" instead of reading "cbrt" as c*b*r*t.
 */
const UNSUPPORTED = [
  'cbrt', 'arcsin', 'arccos', 'arctan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
  'floor', 'ceil', 'max', 'min', 'lim', 'int', 'sum', 'mod', 'gcd', 'lcm', 'det', 'hcf',
];
// Longest first, so "sqrt" wins over "s", "sinh" over "sin", and "sec" over "e".
const NAMES = [...Object.keys(FUNCS), ...Object.keys(CONSTS), ...UNSUPPORTED].sort((a, b) => b.length - a.length);

/** Marker for notation we refuse to guess at. Not valid maths, so the checker rejects it. */
export const AMBIGUOUS = '?';

const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-',
};

/** Read a {...} group starting at s[i] === '{'. Returns content and index after '}'. */
function readBraceGroup(s: string, i: number): { body: string; end: number } | null {
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}') {
      depth--;
      if (depth === 0) return { body: s.slice(i + 1, j), end: j + 1 };
    }
  }
  return null;
}

function skipSpaces(s: string, i: number): number {
  while (i < s.length && s[i] === ' ') i++;
  return i;
}

/** Replace \frac{a}{b} and \sqrt[n]{a} / \sqrt{a}, innermost structure handled by recursion. */
function expandLatexCommands(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const frac = /^\\[dt]?frac/.exec(s.slice(i));
    if (frac) {
      const a = readBraceGroup(s, skipSpaces(s, i + frac[0].length));
      const b = a && readBraceGroup(s, skipSpaces(s, a.end));
      if (a && b) {
        out += `((${expandLatexCommands(a.body)})/(${expandLatexCommands(b.body)}))`;
        i = b.end;
        continue;
      }
    }
    if (s.startsWith('\\sqrt', i)) {
      let j = skipSpaces(s, i + 5);
      let index: string | null = null;
      if (s[j] === '[') {
        const close = s.indexOf(']', j);
        if (close > j) {
          index = s.slice(j + 1, close);
          j = skipSpaces(s, close + 1);
        }
      }
      const a = readBraceGroup(s, j);
      if (a) {
        const body = expandLatexCommands(a.body);
        out += index ? `((${body})^(1/(${index})))` : `sqrt(${body})`;
        i = a.end;
        continue;
      }
    }
    out += s[i];
    i++;
  }
  return out;
}

function stripLatex(s: string): string {
  s = s.replace(/\$/g, '');
  s = expandLatexCommands(s);
  s = s
    .replace(/\\left|\\right/g, '')
    .replace(/\\(cdot|times|ast)/g, '*')
    .replace(/\\div/g, '/')
    .replace(/\\pm/g, '±')
    .replace(/\\(,|;|:|!|quad|qquad)/g, ' ')
    .replace(/\\(sin|cos|tan|cot|sec|csc|ln|log|exp|pi|sqrt)/g, ' $1 ')
    .replace(/\\(therefore|implies|Rightarrow|to)/g, ' => ');
  return s;
}

function stripLeadersAndTrailers(s: string): string {
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.trim();
    s = s.replace(/^(=+>|->|∴|(therefore|hence|so|then|thus)\b)\s*/i, '');
    s = s.replace(/[.,;:]+$/, '');
  }
  // A line that starts with "=" continues a chain: "= x^2 + 2x + 1".
  s = s.replace(/^=(?!=)\s*/, '');
  return s.trim();
}

type Tok =
  | { t: 'num'; v: string }
  | { t: 'var'; v: string }
  | { t: 'const'; v: string }
  | { t: 'func'; v: string }
  | { t: 'op'; v: string }
  | { t: '('; v: '(' }
  | { t: ')'; v: ')' }
  | { t: 'other'; v: string };

function tokenize(s: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    // Scientific notation "1e6", "2.5E-3" (no spaces). "2e" alone stays 2*e.
    const num = /^(\d+\.?\d*|\.\d+)(?:[eE]([+-]?\d+))?/.exec(s.slice(i));
    if (num) {
      const mant = num[1].replace(/\.$/, '');
      toks.push({ t: 'num', v: num[2] ? `(${mant}*10^(${num[2]}))` : mant });
      i += num[0].length;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      const run = /^[a-zA-Z]+/.exec(s.slice(i))![0];
      let k = 0;
      while (k < run.length) {
        const rest = run.slice(k).toLowerCase();
        const name = NAMES.find((n) => rest.startsWith(n));
        if (name) {
          if (name in FUNCS) {
            // "log2(8)": a log with a base we do not read.
            const atEnd = k + name.length === run.length;
            if (name === 'log' && atEnd && /[\d_]/.test(s[i + run.length] ?? '')) toks.push({ t: 'other', v: AMBIGUOUS });
            else toks.push({ t: 'func', v: FUNCS[name] });
          } else if (name in CONSTS) toks.push({ t: 'const', v: CONSTS[name] });
          else toks.push({ t: 'other', v: AMBIGUOUS });
          k += name.length;
        } else {
          toks.push({ t: 'var', v: run[k] }); // "xy" means x*y in handwriting
          k++;
        }
      }
      i += run.length;
      continue;
    }
    if (c === '(') { toks.push({ t: '(', v: '(' }); i++; continue; }
    if (c === ')') { toks.push({ t: ')', v: ')' }); i++; continue; }
    if ('+-*/^=,'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    toks.push({ t: 'other', v: c });
    i++;
  }
  return toks;
}

/** Index of the ")" matching the "(" at toks[j], or -1. */
function matchParen(toks: Tok[], j: number): number {
  let depth = 0;
  for (let k = j; k < toks.length; k++) {
    if (toks[k].t === '(') depth++;
    else if (toks[k].t === ')' && --depth === 0) return k;
  }
  return -1;
}

const OPEN: Tok = { t: '(', v: '(' };
const CLOSE: Tok = { t: ')', v: ')' };

/**
 * Function arguments and powers:
 *   "sin x" / "sqrt2x"        -> sin(x) / sqrt(2*x)
 *   "sin^2(x)" / "cos^2 x"    -> (sin(x))^2 / (cos(x))^2
 *   "sin^-1 x" (inverse trig) -> "?" (not supported)
 */
function wrapFunctions(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok.t !== 'func') { out.push(tok); continue; }
    let j = i + 1;
    // Optional power right after the name: ^2 or ^(2).
    let power: Tok[] | null = null;
    if (toks[j]?.t === 'op' && toks[j].v === '^') {
      const p = toks[j + 1];
      if (p?.t === 'num') { power = [p]; j += 2; }
      else if (p?.t === '(') {
        const end = matchParen(toks, j + 1);
        if (end < 0) { out.push(tok); continue; }
        power = toks.slice(j + 1, end + 1);
        j = end + 1;
      } else { out.push({ t: 'other', v: AMBIGUOUS }); i = j; continue; } // sin^-1 etc.
    }
    // Argument: a bracket group, or a simple term "2x" / "x" / "pi".
    let arg: Tok[] | null = null;
    if (toks[j]?.t === '(') {
      const end = matchParen(toks, j);
      if (end > j) { arg = wrapFunctions(toks.slice(j + 1, end)); j = end + 1; }
    } else {
      const k0 = j;
      if (toks[j]?.t === 'num') j++;
      while (toks[j] && (toks[j].t === 'var' || toks[j].t === 'const')) j++;
      if (j > k0) arg = toks.slice(k0, j);
    }
    if (!arg) {
      // Nothing we can read as an argument: keep the original tokens.
      out.push(tok);
      continue;
    }
    const call = [tok, OPEN, ...arg, CLOSE];
    if (power) out.push(OPEN, ...call, CLOSE, { t: 'op', v: '^' }, ...power);
    else out.push(...call);
    i = j - 1;
  }
  return out;
}

/**
 * Insert "*" for implicit products: 2x, 3(x+1), )(, x(…).
 * A division followed by an implicit product ("1/2x", "a/bc") is ambiguous in
 * handwriting (1/(2x) or (1/2)x?), so it becomes "?" and the line is "unsure".
 */
function insertImplicitTimes(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  // Last binary operator seen at each bracket depth.
  const lastOp: string[] = [''];
  for (const tok of toks) {
    const prev = out[out.length - 1];
    if (prev) {
      const leftOk = prev.t === 'num' || prev.t === 'var' || prev.t === 'const' || prev.t === ')';
      const rightOk =
        tok.t === 'var' || tok.t === 'const' || tok.t === 'func' || tok.t === '(' ||
        (tok.t === 'num' && prev.t !== 'num'); // "2 3" stays ambiguous -> parse error
      if (leftOk && rightOk) {
        out.push(lastOp[lastOp.length - 1] === '/' ? { t: 'other', v: AMBIGUOUS } : { t: 'op', v: '*' });
      }
    }
    if (tok.t === '(') lastOp.push('');
    else if (tok.t === ')') { if (lastOp.length > 1) lastOp.pop(); }
    else if (tok.t === 'op') lastOp[lastOp.length - 1] = tok.v;
    out.push(tok);
  }
  return out;
}

export function normalizePlain(input: string): string {
  try {
    // NFKC (fullwidth chars, ligatures) maps superscript digits to plain
    // digits ("x²" -> "x2"), so convert superscripts first.
    let s = String(input ?? '').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => '^(' + [...m].map((c) => SUPERSCRIPTS[c]).join('') + ')');
    s = s.normalize('NFKC');
    s = s
      .replace(/[−–—‐‑]/g, '-')
      .replace(/[×·⋅∙✕]/g, '*')
      .replace(/÷/g, '/')
      .replace(/π/g, 'pi')
      .replace(/√/g, ' sqrt ')
      .replace(/[⇒→⟹]/g, '=>')
      .replace(/\*\*/g, '^')
      .replace(/±|\+\/-|\+-/g, '±')
      .replace(/\s+/g, ' ');
    s = stripLatex(s);
    s = s.replace(/[[{]/g, '(').replace(/[\]}]/g, ')');
    s = s.replace(/\b(or|and)\b/gi, ',');
    s = stripLeadersAndTrailers(s);
    if (!s) return '';
    let toks = tokenize(s);
    toks = wrapFunctions(toks);
    toks = insertImplicitTimes(toks);
    let out = toks.map((t) => t.v).join('');
    // "±" is not maths nerdamer knows; keep it as "+/-" so the checker can
    // treat "x = +/-2" as a list of roots and nerdamer rejects it elsewhere.
    out = out.replace(/±/g, '+/-');
    return out;
  } catch {
    return String(input ?? '').trim();
  }
}
