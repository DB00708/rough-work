import { useCallback, useEffect, useRef, useState } from 'react';
// firebase first: it initializes the app before config, explain and data use it.
import { ensureSignedIn, isFirebaseConfigured } from '../firebase';
import { DEFAULT_CONFIG, loadConfig } from '../config';
import { isOnDeviceAvailable } from '../read';
import { usePipeline } from '../pipeline';
import {
  CaptureDebug,
  createLineDetector,
  FrameGuide,
  useCamera,
  usePersistentRoi,
} from '../components/captureAdapter';
import { realDeps } from '../components/deps';
import { DEMO_LINES, DEMO_PROBLEM } from '../components/demoLines';
import { LineItem } from '../components/LineItem';
import { TopBar } from '../components/TopBar';

const DEMO_STEP_MS = 900;
const HINT_MS = 3500;

type Boot = 'loading' | 'ready';

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName);
}

/** `?debug` in the URL shows the detector's ink mask (for tuning). */
const SHOW_DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

export default function Practice() {
  const { pipeline, state } = usePipeline(realDeps);
  const cam = useCamera({ autoStart: false });
  const { roi, committedRoi, setRoi, commitRoi } = usePersistentRoi();
  const [detector] = useState(() => createLineDetector({ roi: committedRoi }));
  const [boot, setBoot] = useState<Boot>('loading');
  const [signedIn, setSignedIn] = useState(false);
  const [problem, setProblem] = useState('');
  const [demoRunning, setDemoRunning] = useState(false);
  const [wantCamera, setWantCamera] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
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
      // No .env.local (demo / offline): skip Remote Config so no request goes
      // out with the placeholder key.
      const cfg = isFirebaseConfigured() ? await loadConfig().catch(() => DEFAULT_CONFIG) : DEFAULT_CONFIG;
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

  // Capture -> pipeline. An "amends" crop extends the last line.
  useEffect(
    () =>
      detector.onLine((l) => {
        if (l.amends) pipeline.amendLast(l.cropDataUrl);
        else pipeline.addCrop(l.cropDataUrl);
      }),
    [detector, pipeline],
  );

  // Guide box moved: the detector resets its baseline.
  useEffect(() => {
    detector.setRoi(committedRoi);
  }, [detector, committedRoi]);

  // Sample frames while the camera is live. stop() is required on unmount.
  useEffect(() => {
    const v = cam.videoRef.current;
    if (cam.ready && v) detector.start(v);
    return () => detector.stop();
  }, [cam.ready, cam.videoRef, detector]);

  useEffect(() => {
    if (!hint) return;
    const id = window.setTimeout(() => setHint(null), HINT_MS);
    return () => window.clearTimeout(id);
  }, [hint]);

  // Spacebar = "line done". The line arrives through onLine above.
  const lineDone = useCallback(() => {
    if (!cam.ready) return;
    const line = detector.forceLineDone(cam.videoRef.current ?? undefined);
    if (!line) setHint('No new writing found in the box. Move your hand out of the box and try again.');
  }, [cam.ready, cam.videoRef, detector]);

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

  const startCamera = () => {
    setWantCamera(true);
    cam.start();
  };

  const stopCamera = () => {
    setWantCamera(false);
    cam.stop();
  };

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
    detector.reset(); // new page: forget known ink
    setProblem('');
  };

  const starting = wantCamera && !cam.ready && !cam.error;

  return (
    <div className="practice">
      <TopBar counts={state.counts} cloudMode={state.cloudMode} />

      <main className="practice-main">
        <section className="pane pane-camera" aria-label="Camera">
          <div className={`video-wrap${cam.ready ? '' : ' video-wrap-idle'}`}>
            {/* Always rendered so the stream can attach; FrameGuide maps to its exact box. */}
            <div className="video-frame">
              <video ref={cam.videoRef} className="video" playsInline muted aria-label="Live view of your paper" />
              {cam.ready && (
                <FrameGuide
                  roi={roi}
                  onChange={setRoi}
                  onChangeEnd={commitRoi}
                  hideLabel={state.lines.length > 0}
                  label="Frame your page (drag to fit)"
                />
              )}
            </div>
            {!cam.ready && (
              <div className="video-empty">
                <p>Point the camera down at your paper. Frames stay on this device.</p>
                <button type="button" className="btn btn-primary" onClick={startCamera} disabled={starting}>
                  {starting ? 'Starting…' : cam.error ? 'Try again' : 'Start camera'}
                </button>
                {cam.error && <p className="error">{cam.error.message}</p>}
              </div>
            )}
          </div>
          <div className="camera-actions">
            <button type="button" className="btn" onClick={lineDone} disabled={!cam.ready}>
              Line done <kbd>Space</kbd>
            </button>
            {cam.ready && (
              <button type="button" className="btn btn-quiet" onClick={stopCamera}>
                Stop camera
              </button>
            )}
            {cam.devices.length > 1 && (
              <select
                className="select"
                aria-label="Camera"
                value={cam.deviceId ?? ''}
                onChange={(e) => cam.selectDevice(e.target.value || null)}
              >
                <option value="">Default camera</option>
                {cam.devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => void runDemo()} disabled={demoRunning || boot !== 'ready'}>
              {demoRunning ? 'Demo running…' : 'Demo mode'}
            </button>
          </div>
          {hint && (
            <p className="notice" role="status">
              {hint}
            </p>
          )}
          <p className="muted small">
            Fit the box to your page. New lines are picked up when you pause; press <kbd>Space</kbd> to send one now.
            Click any line on the right to fix what was read.
          </p>
          {SHOW_DEBUG && <CaptureDebug detector={detector} />}
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
