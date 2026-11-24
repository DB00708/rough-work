import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Explanation, Line, LineStatus } from '../types';
import { speak } from './modulesAdapter';

const STATUS_LABEL: Record<LineStatus, string> = {
  checking: 'checking',
  ok: 'OK',
  wrong: 'wrong',
  unsure: 'unsure',
};

export function StatusChip({ status }: { status: LineStatus }) {
  return (
    <span className={`chip chip-${status}`}>
      {status === 'checking' && <span className="spinner" aria-hidden="true" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

function SourceBadge({ line }: { line: Line }) {
  if (!line.read) return null;
  if (!line.cropDataUrl) return <span className="badge badge-src">typed</span>;
  const src = line.read.source;
  return (
    <span className={`badge badge-src badge-src-${src}`} title={src === 'device' ? 'Read by Gemini Nano on this device' : 'Read by Gemini in the cloud'}>
      {src}
      {line.editedByUser && ' · fixed'}
    </span>
  );
}

function ExplanationPanel({ explanation }: { explanation: Explanation }) {
  const [english, setEnglish] = useState(false);
  const [hintsShown, setHintsShown] = useState(0);
  const hasEnglish = !!explanation.english;
  const text = english && hasEnglish ? explanation.english! : explanation.hinglish;
  const label = english ? explanation.mistakeLabel : explanation.mistakeLabelHinglish;
  const hintNames = ['Nudge', 'Method', 'Answer'];

  return (
    <div className="explain">
      <p className="explain-type">{label}</p>
      <p className="explain-text" lang={english ? 'en' : 'hi-Latn'}>
        {text}
      </p>
      <div className="explain-actions">
        {hasEnglish && (
          <button type="button" className="btn btn-small" onClick={() => setEnglish((v) => !v)} aria-pressed={english}>
            {english ? 'Hinglish' : 'English'}
          </button>
        )}
        <button
          type="button"
          className="btn btn-small"
          onClick={() => speak(text, english ? 'en-IN' : 'hi-IN')}
          aria-label="Read the explanation aloud"
        >
          ▶ Speak
        </button>
      </div>
      {hintsShown > 0 && (
        <ol className="hints">
          {explanation.hints.slice(0, hintsShown).map((h, i) => (
            <li key={i}>
              <span className="hint-name">{hintNames[i]}</span> {h}
            </li>
          ))}
        </ol>
      )}
      {hintsShown < 3 && (
        <button type="button" className="btn btn-small btn-quiet" onClick={() => setHintsShown((n) => n + 1)}>
          Show {hintNames[hintsShown].toLowerCase()} hint
        </button>
      )}
    </div>
  );
}

interface LineItemProps {
  line: Line;
  onEdit(id: string, plain: string): void;
}

export function LineItem({ line, onEdit }: LineItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEdit = () => {
    if (!line.read && line.status === 'checking') return;
    setDraft(line.read?.plain ?? '');
    setEditing(true);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim() && draft.trim() !== line.read?.plain) onEdit(line.id, draft);
    setEditing(false);
  };

  return (
    <li className={`line line-${line.status}`}>
      <div className="line-row">
        <span className="line-num" aria-hidden="true">
          {line.index + 1}
        </span>
        {line.cropDataUrl ? (
          <img className="line-thumb" src={line.cropDataUrl} alt={`Line ${line.index + 1} as written`} />
        ) : (
          <span className="line-thumb line-thumb-empty" aria-hidden="true" />
        )}
        <div className="line-body">
          {editing ? (
            <form onSubmit={submit} className="line-edit">
              <label className="sr-only" htmlFor={`edit-${line.id}`}>
                Fix line {line.index + 1}
              </label>
              <input
                id={`edit-${line.id}`}
                ref={inputRef}
                className="mono"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
                onBlur={() => setEditing(false)}
                spellCheck={false}
                autoComplete="off"
              />
            </form>
          ) : (
            <button
              type="button"
              className="line-text mono"
              onClick={startEdit}
              title="Click to fix the transcription"
              disabled={!line.read && line.status === 'checking'}
            >
              {line.read?.plain ?? (line.status === 'checking' ? 'reading…' : 'could not read, click to type it')}
            </button>
          )}
          {line.check?.reason && line.status !== 'ok' && <p className="line-reason">{line.check.reason}</p>}
        </div>
        <div className="line-meta">
          <StatusChip status={line.status} />
          <SourceBadge line={line} />
        </div>
      </div>
      {line.status === 'wrong' &&
        (line.explanation ? (
          <ExplanationPanel
            key={`${line.explanation.mistakeType}|${line.explanation.hinglish}`}
            explanation={line.explanation}
          />
        ) : (
          <p className="explain explain-missing">This step does not follow from the line before. No explanation yet (offline or daily limit).</p>
        ))}
    </li>
  );
}
