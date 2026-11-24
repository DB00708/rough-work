// "Frame your page" overlay. Place it inside a position:relative wrapper that
// is exactly the size of the displayed video frame (e.g. the <video> with
// width:100%; height:auto, no letterboxing), so normalized ROI coordinates
// match the frame. Drag the box to move it, drag a corner to resize.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { moveRoi, resizeRoi, type Corner, type Roi } from './roi';

export interface FrameGuideProps {
  roi: Roi;
  /** Called while dragging (live) and on release. Omit to make the guide read-only. */
  onChange?: (roi: Roi) => void;
  /** Text shown in the box. Default "Frame your page". */
  label?: string;
  /** Hide the label (e.g. once practice has started). */
  hideLabel?: boolean;
  /** Box color. Default a bright teal. */
  color?: string;
}

type DragMode = { kind: 'move' } | { kind: 'resize'; corner: Corner };

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  startRoi: Roi;
  width: number;
  height: number;
}

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

export function FrameGuide({ roi, onChange, label = 'Frame your page', hideLabel, color = '#14b8a6' }: FrameGuideProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const editable = !!onChange;

  const begin = (mode: DragMode) => (e: PointerEvent<HTMLElement>) => {
    if (!editable || !layerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = layerRef.current.getBoundingClientRect();
    drag.current = { mode, startX: e.clientX, startY: e.clientY, startRoi: roi, width: rect.width, height: rect.height };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // capture is best effort
    }
    setDragging(true);
  };

  const onMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || !onChange || d.width === 0 || d.height === 0) return;
    const dx = (e.clientX - d.startX) / d.width;
    const dy = (e.clientY - d.startY) / d.height;
    onChange(d.mode.kind === 'move' ? moveRoi(d.startRoi, dx, dy) : resizeRoi(d.startRoi, d.mode.corner, dx, dy));
  };

  const end = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  };

  // Stop a drag if the component unmounts mid-gesture.
  useEffect(() => () => void (drag.current = null), []);

  const box: CSSProperties = {
    position: 'absolute',
    left: `${roi.x * 100}%`,
    top: `${roi.y * 100}%`,
    width: `${roi.w * 100}%`,
    height: `${roi.h * 100}%`,
    border: `2px dashed ${color}`,
    borderRadius: 6,
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
    cursor: editable ? (dragging ? 'grabbing' : 'grab') : 'default',
    touchAction: 'none',
    boxSizing: 'border-box',
    pointerEvents: editable ? 'auto' : 'none',
  };

  return (
    <div
      ref={layerRef}
      aria-label="Page guide"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      <div
        style={box}
        onPointerDown={begin({ kind: 'move' })}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {!hideLabel && (
          <span
            style={{
              position: 'absolute',
              top: 6,
              left: 8,
              padding: '2px 8px',
              borderRadius: 4,
              background: color,
              color: '#fff',
              font: '600 12px/1.6 system-ui, sans-serif',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          >
            {label}
          </span>
        )}
        {editable &&
          CORNERS.map((c) => (
            <span
              key={c}
              role="presentation"
              onPointerDown={begin({ kind: 'resize', corner: c })}
              onPointerMove={onMove}
              onPointerUp={end}
              onPointerCancel={end}
              style={{
                position: 'absolute',
                width: 16,
                height: 16,
                background: color,
                borderRadius: 3,
                touchAction: 'none',
                [c.includes('n') ? 'top' : 'bottom']: -9,
                [c.includes('w') ? 'left' : 'right']: -9,
                cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize',
              }}
            />
          ))}
      </div>
    </div>
  );
}
