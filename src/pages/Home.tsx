import { Link } from 'react-router-dom';

/** Chrome's built-in Prompt API global. Missing means Nano cannot run here. */
function hasPromptApi(): boolean {
  return typeof globalThis !== 'undefined' && 'LanguageModel' in globalThis;
}

export default function Home() {
  const nano = hasPromptApi();
  return (
    <main className="page home">
      <header className="home-head">
        <p className="eyebrow">Rough Work</p>
        <h1>Find the wrong line while you write it.</h1>
        <p className="lead">
          Solve maths on paper as usual. Your webcam watches the page. Gemini Nano reads each new line on your
          device, an algebra checker tests the step, and only a wrong step goes to the cloud for a short Hinglish
          explanation and hints.
        </p>
      </header>

      <div className="home-actions">
        <Link to="/practice" className="btn btn-primary btn-large">
          Start practice
        </Link>
        <Link to="/mistakes" className="btn btn-large">
          My mistakes
        </Link>
        <Link to="/spike" className="btn btn-quiet">
          Spike (dev)
        </Link>
      </div>

      <ol className="how">
        <li>
          <strong>Device reads</strong>
          <span>Nano transcribes every line. Frames never leave your laptop.</span>
        </li>
        <li>
          <strong>Code checks</strong>
          <span>An algebra library decides if the step follows. No guessing.</span>
        </li>
        <li>
          <strong>Cloud explains</strong>
          <span>Only a wrong step gets an explanation, hints and a mistake tag.</span>
        </li>
      </ol>

      {!nano && (
        <aside className="callout" aria-labelledby="flag-help">
          <h2 id="flag-help">Turn on Gemini Nano in Chrome</h2>
          <p>This browser does not expose the on-device model, so lines will be read in the cloud (slower).</p>
          <ol>
            <li>Use Chrome desktop 139 or later.</li>
            <li>
              Open <code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code> and set it to{' '}
              <em>Enabled</em>.
            </li>
            <li>Restart Chrome and come back here. The first run downloads the model.</li>
          </ol>
        </aside>
      )}
    </main>
  );
}
