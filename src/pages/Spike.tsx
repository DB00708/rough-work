// Day 1 spike: can Gemini Nano read handwritten algebra? Owned by T1. Mounted at /spike by T7.
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { isFirebaseConfigured, missingFirebaseEnv, NOT_CONFIGURED_MESSAGE } from '../firebase';
import { deviceModelAvailability, initDeviceModel, normalizeForCompare, readLine } from '../read';
import { loadConfig, DEFAULT_CONFIG } from '../config';
import type { AppConfig, LineRead } from '../types';

interface Row {
  id: number;
  name: string;
  thumbUrl: string;
  status: 'queued' | 'reading' | 'done' | 'error';
  read?: LineRead;
  error?: string;
  expected: string;
}

/** Longest side of the image sent to the model. Keeps Nano under its token limit. */
const MAX_SIDE = 1024;

/** Loads an image file, downscales it, and returns a JPEG data URL. */
async function fileToJpegDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available.');
  ctx.fillStyle = '#fff'; // PNG transparency -> white paper
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.9);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export default function Spike() {
  const configured = isFirebaseConfigured();
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CONFIG);
  const [availability, setAvailability] = useState<string>('checking...');
  const [progress, setProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const rowsRef = useRef<Row[]>([]);
  rowsRef.current = rows;

  useEffect(() => {
    loadConfig().then(setCfg, () => setCfg(DEFAULT_CONFIG));
    deviceModelAvailability().then(setAvailability);
  }, []);

  // Free thumbnail object URLs on unmount.
  useEffect(() => () => rowsRef.current.forEach((r) => URL.revokeObjectURL(r.thumbUrl)), []);

  const patchRow = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const onDownload = async () => {
    setDownloadError(null);
    setProgress(0);
    try {
      await initDeviceModel(setProgress);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
    setAvailability(await deviceModelAvailability());
  };

  const readRows = async (targets: { row: Row; file: File }[]) => {
    setBusy(true);
    // One at a time: Nano runs a single session, and per-read timing stays honest.
    for (const { row, file } of targets) {
      patchRow(row.id, { status: 'reading', error: undefined });
      try {
        const dataUrl = await fileToJpegDataUrl(file);
        const read = await readLine(dataUrl, cfg);
        patchRow(row.id, { status: 'done', read });
      } catch (e) {
        patchRow(row.id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
    setBusy(false);
    setAvailability(await deviceModelAvailability());
  };

  const filesById = useRef(new Map<number, File>());

  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => /^image\/(jpeg|png)$/.test(f.type));
    e.target.value = '';
    if (!files.length) return;
    const added = files.map((file) => {
      const row: Row = {
        id: nextId.current++,
        name: file.name,
        thumbUrl: URL.createObjectURL(file),
        status: 'queued',
        expected: '',
      };
      filesById.current.set(row.id, file);
      return { row, file };
    });
    setRows((rs) => [...rs, ...added.map((a) => a.row)]);
    if (configured) void readRows(added);
  };

  const rerunAll = () => {
    const targets = rows.flatMap((row) => {
      const file = filesById.current.get(row.id);
      return file ? [{ row, file }] : [];
    });
    void readRows(targets);
  };

  const clearAll = () => {
    rows.forEach((r) => URL.revokeObjectURL(r.thumbUrl));
    filesById.current.clear();
    setRows([]);
  };

  const stats = useMemo(() => {
    const done = rows.filter((r) => r.status === 'done' && r.read);
    const scored = done.filter((r) => r.expected.trim());
    const correct = scored.filter((r) => normalizeForCompare(r.read!.plain) === normalizeForCompare(r.expected));
    const device = done.filter((r) => r.read!.source === 'device');
    const cloud = done.filter((r) => r.read!.source === 'cloud');
    return {
      scored: scored.length,
      correct: correct.length,
      deviceCount: device.length,
      cloudCount: cloud.length,
      deviceMs: mean(device.map((r) => r.read!.ms)),
      cloudMs: mean(cloud.map((r) => r.read!.ms)),
      errors: rows.filter((r) => r.status === 'error').length,
    };
  }, [rows]);

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Nano read spike</h1>
      <p>Gate: Nano reads at least 14 of 20 neat handwritten lines correctly.</p>

      {!configured && (
        <p role="alert" style={alertStyle}>
          {NOT_CONFIGURED_MESSAGE} Missing: {missingFirebaseEnv().join(', ')}.
        </p>
      )}

      <section style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0' }}>
        <button onClick={onDownload} disabled={progress !== null && progress < 100 && !downloadError}>
          Download Gemini Nano
        </button>
        <span>
          On-device model: <strong>{availability}</strong>
        </span>
        {progress !== null && (
          <span>
            <progress max={100} value={progress} /> {progress}%
          </span>
        )}
        {downloadError && <span style={{ color: '#b00020' }}>{downloadError}</span>}
      </section>

      <section style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0' }}>
        <label>
          Line photos (JPEG/PNG):{' '}
          <input type="file" accept="image/jpeg,image/png" multiple onChange={onFiles} disabled={!configured || busy} />
        </label>
        <button onClick={rerunAll} disabled={!configured || busy || !rows.length}>
          Re-read all
        </button>
        <button onClick={clearAll} disabled={busy || !rows.length}>
          Clear
        </button>
        {busy && <span>Reading...</span>}
      </section>

      {rows.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {['#', 'Photo', 'LaTeX', 'Plain', 'Conf.', 'Source', 'ms', 'Expected (plain)', 'Match'].map((h) => (
                <th key={h} style={cell}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const match =
                r.read && r.expected.trim()
                  ? normalizeForCompare(r.read.plain) === normalizeForCompare(r.expected)
                  : null;
              return (
                <tr key={r.id}>
                  <td style={cell}>{i + 1}</td>
                  <td style={cell}>
                    <img src={r.thumbUrl} alt={r.name} title={r.name} style={{ maxWidth: 220, maxHeight: 80 }} />
                  </td>
                  <td style={{ ...cell, fontFamily: 'monospace' }}>{r.read?.latex}</td>
                  <td style={{ ...cell, fontFamily: 'monospace' }}>
                    {r.status === 'error' ? <span style={{ color: '#b00020' }}>{r.error}</span> : r.read?.plain}
                    {(r.status === 'queued' || r.status === 'reading') && <em>{r.status}...</em>}
                  </td>
                  <td style={cell}>{r.read ? r.read.confidence.toFixed(2) : ''}</td>
                  <td style={cell}>{r.read?.source}</td>
                  <td style={cell}>{r.read?.ms}</td>
                  <td style={cell}>
                    <input
                      value={r.expected}
                      onChange={(e) => patchRow(r.id, { expected: e.target.value })}
                      placeholder="2*x+3=7"
                      style={{ fontFamily: 'monospace', width: 160 }}
                    />
                  </td>
                  <td style={{ ...cell, textAlign: 'center' }}>{match === null ? '' : match ? '✅' : '❌'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <section style={{ marginTop: 24, fontSize: 18 }}>
        <p>
          Accuracy:{' '}
          <strong>
            {stats.scored
              ? `${stats.correct} / ${stats.scored} (${Math.round((100 * stats.correct) / stats.scored)}%)`
              : 'fill in expected answers'}
          </strong>
          {stats.scored > 0 &&
            (stats.correct / stats.scored >= 0.7 ? ' - meets the 70% gate' : ' - below the 70% gate')}
        </p>
        <p>
          Average device read time:{' '}
          <strong>{stats.deviceMs === null ? 'no device reads yet' : `${Math.round(stats.deviceMs)} ms`}</strong> (
          {stats.deviceCount} on device, {stats.cloudCount} in cloud
          {stats.cloudMs !== null ? `, cloud avg ${Math.round(stats.cloudMs)} ms` : ''}
          {stats.errors ? `, ${stats.errors} errors` : ''})
        </p>
      </section>
    </main>
  );
}

const cell: CSSProperties = { border: '1px solid #ccc', padding: '4px 8px', verticalAlign: 'middle' };
const alertStyle: CSSProperties = { background: '#fff3cd', border: '1px solid #e0c46c', padding: 12, borderRadius: 6 };
