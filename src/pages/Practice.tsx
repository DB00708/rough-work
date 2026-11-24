import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_CONFIG, loadConfig } from '../config';
import { ensureSignedIn } from '../firebase';
import { isOnDeviceAvailable } from '../read';
import { usePipeline } from '../pipeline';
import { createLineDetector, FrameGuide, useCamera, type LineDetector } from '../components/captureAdapter';
import { realDeps } from '../components/deps';
import { DEMO_LINES, DEMO_PROBLEM } from '../components/demoLines';
import { LineItem } from '../components/LineItem';
import { TopBar } from '../components/TopBar';

/** How often a video frame goes to the line detector (pixel diff is cheap). */
const FRAME_TICK_MS = 500;
const DEMO_STEP_MS = 900;

type Boot = 'loading' | 'ready';

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName);
}

export default function Practice() {
  const { pipeline, state } = usePipeline(realDeps);
  const camera = useCamera();
  const [boot, setBoot] = useState<Boot>('loading');
  const [signedIn, setSignedIn] = useState(false);
  const [problem, setProblem] = useState('');
  const [demoRunning, setDemoRunning] = useState(false);
  const detectorRef = useRef<LineDetector | null>(null);
  const listEndRef = useRef<HTMLLIElement>(null);
  const unmounted = useRef(false);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  // Boot: config, anonymous sign-in, Nano check. Each step fails soft.
  useEffect(() => {
    let alive = true;
    (async () => {
      const cfg = await loadConfig().catch(() => DEFAULT_CONFIG);
      const uid = await ensureSignedIn().catch((e) => {
        console.warn('[practice] sign-in failed, running without an account', e);
        return null;
      });
      const onDevice = await isOnDeviceAvailable().catch(() => false);
      if (!alive) return;
      pipeline.init({ cfg, uid, cloudMode: !onDevice });
      setSignedIn(!!uid);
      setBoot('ready');
    })();
    return () => {
      alive = false;
    };
  }, [pipeline]);

  useEffect(() => {
    pipeline.setProblemText(problem);
  }, [pipeline, problem]);

  // Line detector: one per page; crops go straight into the pipeline queue.
  if (!detectorRef.current) {
    detectorRef.current = createLineDetector({ onLine: (e) => pipeline.addCrop(e.cropDataUrl) });
  }

  // Feed frames while the camera is live.
  useEffect(() => {
    if (camera.status !== 'live') return;
    const id = window.setInterval(() => {
      const v = camera.videoRef.current;
      if (v && v.readyState >= 2) detectorRef.current?.onFrame(v);
    }, FRAME_TICK_MS);
    return () => window.clearInterval(id);
  }, [camera.status, camera.videoRef]);

  // Spacebar = "line done".
  const lineDone = useCallback(() => {
    if (camera.status === 'live') detectorRef.current?.forceLineDone();
  }, [camera.status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTypingTarget(e.target)) return;
      e.preventDefault();
      lineDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lineDone]);

  // Keep the newest line in view.
  const lineCount = state.lines.length;
  useEffect(() => {
    if (lineCount) listEndRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [lineCount]);

  const runDemo = useCallback(async () => {
    if (demoRunning) return;
    setDemoRunning(true);
    pipeline.reset();
    setProblem(DEMO_PROBLEM);
    for (const l of DEMO_LINES) {
      if (unmounted.current) return;
      pipeline.addDemoLine(l.plain, { explanation: l.explanation });
      await new Promise((r) => setTimeout(r, DEMO_STEP_MS));
    }
    if (!unmounted.current) setDemoRunning(false);
  }, [demoRunning, pipeline]);

  const newProblem = () => {
    pipeline.reset();
    setProblem('');
  };

  return (
    <div className="practice">
      <TopBar counts={state.counts} cloudMode={state.cloudMode} />

      <main className="practice-main">
        <section className="pane pane-camera" aria-label="Camera">
          <div className="video-wrap">
            <video ref={camera.videoRef} className="video" playsInline muted aria-label="Live view of your paper" />
            {camera.status === 'live' && <FrameGuide />}
            {camera.status !== 'live' && (
              <div className="video-empty">
                <p>Point the camera down at your paper. Frames stay on this device.</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void camera.start()}
                  disabled={camera.status === 'starting'}
                >
                  {camera.status === 'starting' ? 'Starting…' : 'Start camera'}
                </button>
                {camera.error && <p className="error">{camera.error}</p>}
              </div>
            )}
          </div>
          <div className="camera-actions">
            <button type="button" className="btn" onClick={lineDone} disabled={camera.status !== 'live'}>
              Line done <kbd>Space</kbd>
            </button>
            {camera.status === 'live' && (
              <button type="button" className="btn btn-quiet" onClick={camera.stop}>
                Stop camera
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => void runDemo()} disabled={demoRunning || boot !== 'ready'}>
              {demoRunning ? 'Demo running…' : 'Demo mode'}
            </button>
          </div>
          <p className="muted small">
            Write one line, then press <kbd>Space</kbd>. Click any line on the right to fix what was read.
          </p>
        </section>

        <section className="pane pane-lines" aria-label="Your lines">
          <div className="problem">
            <label htmlFor="problem">Problem</label>
            <div className="problem-row">
              <input
                id="problem"
                type="text"
                placeholder="e.g. Solve 3(x - 2) = 2x + 4"
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                autoComplete="off"
              />
              <button type="button" className="btn btn-quiet" onClick={newProblem} disabled={!state.lines.length}>
                New
              </button>
            </div>
          </div>

          {state.notice && <p className="notice">{state.notice}</p>}
          {boot === 'loading' && <p className="muted">Getting ready…</p>}
          {boot === 'ready' && !signedIn && (
            <p className="muted small">Not signed in: mistakes will not be saved this time.</p>
          )}

          {state.lines.length === 0 ? (
            <div className="empty">
              <p>No lines yet.</p>
              <p className="muted small">Start the camera and write, or try Demo mode.</p>
            </div>
          ) : (
            <ol className="lines" aria-live="polite">
              {state.lines.map((l) => (
                <LineItem key={l.id} line={l} onEdit={(id, plain) => pipeline.editLine(id, plain)} />
              ))}
              <li ref={listEndRef} className="lines-end" aria-hidden="true" />
            </ol>
          )}
          {state.pending > 0 && <p className="muted small">Checking {state.pending} line{state.pending > 1 ? 's' : ''}…</p>}
        </section>
      </main>
    </div>
  );
}
