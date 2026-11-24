import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { MistakesPage, SpikePage } from './components/routesAdapter';
import Home from './pages/Home';
import './App.css';

const Practice = lazy(() => import('./pages/Practice'));

function NotFound() {
  return (
    <main className="page narrow">
      <h1>Page not found</h1>
      <Link to="/">Back home</Link>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<p className="page muted">Loading…</p>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/mistakes" element={<MistakesPage />} />
          <Route path="/spike" element={<SpikePage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
