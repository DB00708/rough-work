# Bench: cloud explain latency

Target (PRD): explanation of a wrong step in under 5 s. `explainMistake()` gives up at 5 s
(`EXPLAIN_TIMEOUT_MS`) and returns a local taxonomy explanation instead.

## Setup
1. `.env.local` with the Firebase web config and `VITE_APPCHECK_DEBUG_TOKEN` (never commit it).
2. `npm run dev -- --port 5180 --strictPort`, then open `http://localhost:5180/` in Chrome.
3. Open DevTools → Console. Each run costs one cloud call per sample (5 by default).

## Snippet
Paste into the console. Vite dev serves the source modules, so `import('/src/...')` works.

```js
await (async () => {
  await import('/src/firebase.ts'); // initializeApp + App Check before any AI call
  const { explainMistake, isLocalFallback } = await import('/src/explain.ts');
  const { loadConfig } = await import('/src/config.ts');
  const cfg = await loadConfig();
  const cases = [
    { prev: '2*(x-3) = 10', next: '2*x - 3 = 10' },
    { prev: 'x + 5 = 12', next: 'x = 12 + 5' },
    { prev: 'x^2 = 16', next: 'x = 4' },
    { prev: '3*x = 12', next: 'x = 9' },
    { prev: '-(x - 2) = 4', next: '-x - 2 = 4' },
  ];
  const rows = [];
  for (const c of cases) {
    const t0 = performance.now();
    const e = await explainMistake(c, cfg).catch((err) => ({ error: String(err) }));
    rows.push({
      wallMs: Math.round(performance.now() - t0),
      ms: e.ms,
      fallback: e.error ? 'error' : isLocalFallback(e),
      type: e.mistakeType,
      hinglish: e.hinglish ?? e.error,
      hint1: e.hints?.[0],
    });
  }
  console.table(rows);
  const ok = rows.filter((r) => r.fallback === false).map((r) => r.wallMs).sort((a, b) => a - b);
  console.log('model:', cfg.cloudModel, '| median ms (non-fallback):', ok[Math.floor(ok.length / 2)] ?? 'n/a',
    '| fallbacks:', rows.length - ok.length);
})();
```

## What to check
- `median ms` under 5000. The first call includes model setup and App Check token fetch;
  run the snippet twice and report the second run.
- `fallback` is `false` on every row. `true` means the call hit the 5 s timeout.
- `hinglish` and `hint1` are Roman-script Hinglish. A console warning
  `[explain] output looks like pure English` means the model ignored the language rule.
- Optional: compare with images by running `explainMistake(c, { ...cfg, explainWithImages: true })`
  with real crops (`prevCrop`/`nextCrop` JPEG data URLs).
