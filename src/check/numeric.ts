// Numeric helpers for the step checker: sample points, closeness, 1-D roots.

export type Fn = (...args: number[]) => number;

/** Relative closeness test used for "same value". */
export function close(a: number, b: number, rel = 1e-7): boolean {
  return Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Short display of a number: 2.0000000001 -> "2", 1.41421356 -> "1.4142". */
export function fmt(v: number): string {
  const r = Number(v.toFixed(4));
  return Object.is(r, -0) ? '0' : String(r);
}

// Fixed, "untidy" sample values: deterministic (tests are stable) but unlikely
// to hit special points such as 0, 1 or simple poles. Readable in a reason.
const BASE = [
  1.7, -0.6, 2.3, 0.4, -1.3, 3.1, -2.2, 0.9, 1.35, -0.85, 2.75, 0.15,
  -3.4, 4.6, 0.65, -1.9, 5.3, 1.05, -0.35, 2.05, 6.7, -4.1, 0.27, 3.85,
  7.9, 0.83, -5.6, 1.55, 9.2, 0.07,
];

/** Candidate value number `i` for variable number `k` (different per variable). */
export function sampleValue(i: number, k: number): number {
  return BASE[(i + 7 * k) % BASE.length] * (1 + 0.013 * k);
}

export const MAX_CANDIDATES = BASE.length;

/** Points for the given variables. Each point is an array aligned with vars. */
export function* samplePoints(nVars: number): Generator<number[]> {
  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const p: number[] = [];
    for (let k = 0; k < nVars; k++) p.push(sampleValue(i, k));
    yield p;
  }
}

export function describePoint(vars: string[], p: number[]): string {
  return vars.map((v, k) => `${v}=${fmt(p[k])}`).join(', ');
}

const GRID_N = 3000;
const GRID_T = 10; // sinh(10) ~ 11013: dense near 0, still reaches large roots

/**
 * Real roots of h(t) = 0 on roughly [-11000, 11000].
 * Sign changes are refined by bisection (poles are rejected by size), touching
 * roots like (t-2)^2 by minimising |h|. `scale(t)` is the size of the two sides
 * at t, so "h is zero" is judged relative to the numbers involved.
 */
export function roots1D(h: (t: number) => number, scale: (t: number) => number): number[] {
  const xs: number[] = [];
  const hs: number[] = [];
  for (let i = 0; i <= GRID_N; i++) {
    const x = Math.sinh(-GRID_T + (2 * GRID_T * i) / GRID_N);
    xs.push(x);
    hs.push(h(x));
  }
  const isZero = (t: number, tol: number) => {
    const v = h(t);
    return Number.isFinite(v) && Math.abs(v) <= tol * scale(t);
  };
  const found: number[] = [];
  for (let i = 0; i < GRID_N; i++) {
    const a = hs[i];
    const b = hs[i + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a === 0) { found.push(xs[i]); continue; }
    if (a * b < 0) {
      let lo = xs[i];
      let hi = xs[i + 1];
      let flo = a;
      for (let it = 0; it < 80; it++) {
        const mid = (lo + hi) / 2;
        const fm = h(mid);
        if (!Number.isFinite(fm)) break;
        if (fm === 0) { lo = hi = mid; break; }
        if (fm * flo < 0) hi = mid;
        else { lo = mid; flo = fm; }
      }
      const r = (lo + hi) / 2;
      if (isZero(r, 1e-6)) found.push(r);
      continue;
    }
    // Touching root: |h| has a local minimum at grid point i+1 with no sign change.
    if (i + 2 <= GRID_N) {
      const c = hs[i + 2];
      if (Number.isFinite(c) && Math.abs(b) < Math.abs(a) && Math.abs(b) <= Math.abs(c) && b * c > 0) {
        let lo = xs[i];
        let hi = xs[i + 2];
        const g = (Math.sqrt(5) - 1) / 2;
        for (let it = 0; it < 100; it++) {
          const m1 = hi - g * (hi - lo);
          const m2 = lo + g * (hi - lo);
          if (Math.abs(h(m1)) < Math.abs(h(m2))) hi = m2;
          else lo = m1;
        }
        const r = (lo + hi) / 2;
        if (isZero(r, 1e-9)) found.push(r);
      }
    }
  }
  if (hs[GRID_N] === 0) found.push(xs[GRID_N]);
  found.sort((p, q) => p - q);
  const out: number[] = [];
  for (const r of found) {
    if (!out.length || !close(out[out.length - 1], r, 1e-6)) out.push(r);
  }
  return out;
}
