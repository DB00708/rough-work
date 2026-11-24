// Tuning view for the line detector: live ink mask (gray = committed ink,
// red = new ink not yet emitted, teal outline = last emitted band), detector
// status, and the last crop. Everything stays in memory.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { DetectorDebug, LineDetector } from './lineDetector';

export interface CaptureDebugProps {
  detector: LineDetector;
  /** Refresh period in ms (default 250). */
  refreshMs?: number;
}

function drawMask(canvas: HTMLCanvasElement, d: DetectorDebug) {
  const { procWidth: w, procHeight: h, mask, baseline, lastBand } = d;
  if (!mask || w === 0 || h === 0 || mask.length !== w * h) return;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  const px = img.data;
  const base = baseline && baseline.length === mask.length ? baseline : null;
  for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
    let r = 255;
    let g = 255;
    let b = 255;
    if (mask[i] && base?.[i]) {
      r = g = b = 90; // committed ink
    } else if (mask[i]) {
      r = 230;
      g = 40;
      b = 40; // new ink
    } else if (base?.[i]) {
      r = g = b = 200; // ink that vanished (hand covering, erased)
    }
    px[j] = r;
    px[j + 1] = g;
    px[j + 2] = b;
    px[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (lastBand) {
    ctx.strokeStyle = '#14b8a6';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, lastBand.y0 + 0.5, w - 1, lastBand.y1 - lastBand.y0);
  }
}

export function CaptureDebug({ detector, refreshMs = 250 }: CaptureDebugProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [snap, setSnap] = useState<DetectorDebug>(() => detector.getDebug());

  useEffect(() => {
    const tick = () => {
      const d = detector.getDebug();
      setSnap(d);
      if (canvasRef.current) drawMask(canvasRef.current, d);
    };
    tick();
    const id = setInterval(tick, refreshMs);
    return () => clearInterval(id);
  }, [detector, refreshMs]);

  const row: CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' };
  const label: CSSProperties = { font: '600 11px system-ui, sans-serif', opacity: 0.7, marginBottom: 4 };

  return (
    <section
      aria-label="Capture debug"
      style={{ font: '12px ui-monospace, monospace', padding: 8, border: '1px solid #8884', borderRadius: 6 }}
    >
      <div style={{ marginBottom: 6 }}>
        status <b>{snap.status}</b> · still {snap.stillCount} · change {(snap.lastChange * 100).toFixed(2)}% · lines{' '}
        {snap.linesEmitted} · mask {snap.procWidth}×{snap.procHeight}
      </div>
      <div style={row}>
        <div>
          <div style={label}>Ink mask (red = new)</div>
          <canvas
            ref={canvasRef}
            width={1}
            height={1}
            style={{ width: 320, maxWidth: '100%', imageRendering: 'pixelated', border: '1px solid #8886' }}
          />
        </div>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={label}>Last crop</div>
          {snap.lastCrop ? (
            <img src={snap.lastCrop} alt="Last captured line" style={{ maxWidth: '100%', border: '1px solid #8886' }} />
          ) : (
            <div style={{ opacity: 0.6 }}>No line yet</div>
          )}
        </div>
      </div>
    </section>
  );
}
