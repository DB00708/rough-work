import { useEffect, useState, type CSSProperties } from 'react';
import { isDataConfigured } from '../data/db';
import { listCommonMistakes, listMyMistakes } from '../data/mistakes';
import type { MistakeTypeCount, MyMistakes } from '../data/helpers';

type State =
  | { kind: 'loading' }
  | { kind: 'not_configured' }
  | { kind: 'ready'; mine: MyMistakes; common: MistakeTypeCount[] };

/** Resolve a uid without a hard dependency on firebase.ts. Returns '' on any failure. */
async function resolveUid(uid?: string): Promise<string> {
  if (uid) return uid;
  try {
    const mod = await import('../firebase');
    return (await mod.ensureSignedIn()) || '';
  } catch (e) {
    console.warn('[mistakes] sign-in not available', e);
    return '';
  }
}

export default function Mistakes({ uid }: { uid?: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ kind: 'loading' });
    (async () => {
      const id = await resolveUid(uid);
      if (!id || !(await isDataConfigured())) {
        if (alive) setState({ kind: 'not_configured' });
        return;
      }
      const [mine, common] = await Promise.all([listMyMistakes(id), listCommonMistakes()]);
      if (alive) setState({ kind: 'ready', mine, common });
    })();
    return () => {
      alive = false;
    };
  }, [uid]);

  return (
    <main style={s.page}>
      <h1 style={s.h1}>My mistakes</h1>
      {state.kind === 'loading' && <p style={s.muted}>Loading…</p>}
      {state.kind === 'not_configured' && (
        <p style={s.muted}>
          Mistake log is offline. Firebase is not set up here, so nothing is saved. Practice still works.
        </p>
      )}
      {state.kind === 'ready' && (
        <>
          {state.mine.byType.length === 0 ? (
            <p style={s.muted}>Abhi tak koi mistake nahi. No mistakes logged yet. Keep practising!</p>
          ) : (
            <BarList items={state.mine.byType} />
          )}

          {state.mine.recent.length > 0 && (
            <section>
              <h2 style={s.h2}>Recent</h2>
              <ul style={s.list}>
                {state.mine.recent.map((m) => (
                  <li key={m.id} style={s.card}>
                    <div style={s.mono}>
                      {m.lineBefore || '?'} <span style={s.arrow}>→</span> {m.lineAfter || '?'}
                    </div>
                    {m.explanation && <p style={s.expl}>{m.explanation}</p>}
                    {m.createdAt && (
                      <small style={s.muted}>{new Date(m.createdAt).toLocaleString()}</small>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 style={s.h2}>Common mistakes</h2>
            {state.common.length === 0 ? (
              <p style={s.muted}>No shared data yet.</p>
            ) : (
              <BarList items={state.common} />
            )}
          </section>
        </>
      )}
    </main>
  );
}

function BarList({ items }: { items: MistakeTypeCount[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul style={s.list}>
      {items.map((t) => (
        <li key={t.type} style={s.row}>
          <div style={s.rowHead}>
            <span>
              <strong>{t.labelHinglish}</strong>
              {t.label !== t.labelHinglish && <span style={s.sub}>{t.label}</span>}
            </span>
            <span style={s.count}>{t.count}</span>
          </div>
          <div style={s.track} aria-hidden>
            <div style={{ ...s.bar, width: `${(t.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const s: Record<string, CSSProperties> = {
  page: { maxWidth: 720, margin: '0 auto', padding: '16px', textAlign: 'left' },
  h1: { fontSize: '1.6rem', margin: '8px 0 16px' },
  h2: { fontSize: '1.15rem', margin: '24px 0 8px' },
  muted: { opacity: 0.7 },
  list: { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 },
  row: { display: 'grid', gap: 4 },
  rowHead: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' },
  sub: { display: 'block', fontSize: '0.85em', opacity: 0.7 },
  count: { fontVariantNumeric: 'tabular-nums', fontWeight: 600 },
  track: { height: 8, borderRadius: 4, background: 'rgba(127,127,127,0.2)', overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4, background: '#e8743b' },
  card: { padding: 12, borderRadius: 8, border: '1px solid rgba(127,127,127,0.3)' },
  mono: { fontFamily: 'ui-monospace, monospace', overflowWrap: 'anywhere' },
  arrow: { opacity: 0.6, padding: '0 4px' },
  expl: { margin: '6px 0 4px' },
};
