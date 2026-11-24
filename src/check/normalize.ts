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
// Longest first, so "sqrt" wins over "s", and "sec" over "e".
const NAMES = [...Object.keys(FUNCS), ...Object.keys(CONSTS)].sort((a, b) => b.length - a.length);

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
    const num = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (num) { toks.push({ t: 'num', v: num[0].replace(/\.$/, '') }); i += num[0].length; continue; }
    if (/[a-zA-Z]/.test(c)) {
      const run = /^[a-zA-Z]+/.exec(s.slice(i))![0];
      let k = 0;
      while (k < run.length) {
        const rest = run.slice(k).toLowerCase();
        const name = NAMES.find((n) => rest.startsWith(n));
        if (name) {
          if (name in FUNCS) toks.push({ t: 'func', v: FUNCS[name] });
          else toks.push({ t: 'const', v: CONSTS[name] });
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

/** "sin x" / "sqrt2x" -> wrap the following simple term in brackets. */
function wrapBareFunctionArgs(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    out.push(tok);
    if (tok.t !== 'func') continue;
    const next = toks[i + 1];
    if (!next || next.t === '(' || next.t === 'op' || next.t === ')' || next.t === 'other') continue;
    // Take an optional number then any run of variables/constants: "2x", "x", "pi".
    let j = i + 1;
    if (toks[j]?.t === 'num') j++;
    while (toks[j] && (toks[j].t === 'var' || toks[j].t === 'const')) j++;
    if (j === i + 1) continue;
    out.push({ t: '(', v: '(' }, ...toks.slice(i + 1, j), { t: ')', v: ')' });
    i = j - 1;
  }
  return out;
}

function insertImplicitTimes(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (const tok of toks) {
    const prev = out[out.length - 1];
    if (prev) {
      const leftOk = prev.t === 'num' || prev.t === 'var' || prev.t === 'const' || prev.t === ')';
      const rightOk =
        tok.t === 'var' || tok.t === 'const' || tok.t === 'func' || tok.t === '(' ||
        (tok.t === 'num' && prev.t !== 'num'); // "2 3" stays ambiguous -> parse error
      if (leftOk && rightOk) out.push({ t: 'op', v: '*' });
    }
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
    toks = wrapBareFunctionArgs(toks);
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
