// ADAPTER (orchestrator fixes at merge). Lazy pages owned by other tasks.
// T5 creates src/pages/Mistakes.tsx and T1 creates src/pages/Spike.tsx. Until
// they merge, placeholders keep the build green. At merge, replace with:
//
//   export const MistakesPage = lazy(() => import('../pages/Mistakes'));
//   export const SpikePage = lazy(() => import('../pages/Spike'));
//
import { lazy } from 'react';
import { Link } from 'react-router-dom';

function Placeholder({ title }: { title: string }) {
  return (
    <main className="page narrow">
      <h1>{title}</h1>
      <p className="muted">This page is not built yet.</p>
      <Link to="/">Back home</Link>
    </main>
  );
}

export const MistakesPage = lazy(async () => ({ default: () => <Placeholder title="My mistakes" /> }));
export const SpikePage = lazy(async () => ({ default: () => <Placeholder title="Nano spike" /> }));
