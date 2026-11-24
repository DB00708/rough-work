import { describe, expect, it } from 'vitest';
import { createDetectorCore, type CoreEvent } from './detectorCore';

const W = 100;
const H = 80;

const empty = () => new Uint8Array(W * H);

/** Handwriting-like ink: every other column in rows y0..y1, x0..x1. */
function write(m: Uint8Array, y0: number, y1: number, x0: number, x1: number, dx = 0, dy = 0) {
  const out = m.slice();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x += 2) out[(y + dy) * W + x + dx] = 1;
  return out;
}

/** Solid block (hand, sleeve, phone). */
function block(m: Uint8Array, y0: number, y1: number) {
  const out = m.slice();
  for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x++) out[y * W + x] = 1;
  return out;
}

/** Hollow outline (2 px thick): what the adaptive threshold makes of a hand. */
function ring(m: Uint8Array, y0: number, y1: number, x0: number, x1: number) {
  const out = m.slice();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const edge = y - y0 < 2 || y1 - y < 2 || x - x0 < 2 || x1 - x < 2;
      if (edge) out[y * W + x] = 1;
    }
  }
  return out;
}

function clearRect(m: Uint8Array, y0: number, y1: number, x0: number, x1: number) {
  const out = m.slice();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out[y * W + x] = 0;
  return out;
}

function feed(core: ReturnType<typeof createDetectorCore>, mask: Uint8Array, times: number): CoreEvent[] {
  const events: CoreEvent[] = [];
  for (let i = 0; i < times; i++) {
    const e = core.push(mask);
    if (e) events.push(e);
  }
  return events;
}

function primed() {
  const core = createDetectorCore({ width: W, height: H, stableSamples: 3 });
  expect(feed(core, empty(), 4)).toEqual([{ type: 'baseline' }]);
  return core;
}

describe('detectorCore', () => {
  it('sets a baseline only after N still samples', () => {
    const core = createDetectorCore({ width: W, height: H, stableSamples: 3 });
    expect(core.push(empty())).toBeNull(); // first sample: change = 1
    expect(core.state().status).toBe('warming');
    expect(core.push(empty())).toBeNull();
    expect(core.push(empty())).toBeNull();
    expect(core.push(empty())).toEqual({ type: 'baseline' });
  });

  it('does not count ink already on the page as a new line', () => {
    const core = createDetectorCore({ width: W, height: H });
    const page = write(empty(), 5, 9, 10, 80);
    const events = feed(core, page, 10);
    expect(events).toEqual([{ type: 'baseline' }]);
  });

  it('emits one line after the new ink is stable, with padding', () => {
    const core = primed();
    const m = write(empty(), 20, 24, 10, 60);
    expect(core.push(m)).toBeNull(); // changing
    expect(core.state().status).toBe('moving');
    expect(core.push(m)).toBeNull();
    expect(core.push(m)).toBeNull();
    const e = core.push(m);
    expect(e).toMatchObject({ type: 'line', amends: false, forced: false, rawBand: { y0: 20, y1: 24 } });
    if (e?.type !== 'line') throw new Error('expected line');
    expect(e.band.y0).toBeLessThanOrEqual(17);
    expect(e.band.y1).toBeGreaterThanOrEqual(27);
    // Staying still afterwards emits nothing more.
    expect(feed(core, m, 10)).toEqual([]);
  });

  it('does not emit while the scene keeps changing (writing in progress)', () => {
    const core = primed();
    let m = empty();
    const events: CoreEvent[] = [];
    for (let x = 10; x < 90; x += 10) {
      m = write(m, 20, 24, x, x + 8);
      const e = core.push(m);
      if (e) events.push(e);
    }
    expect(events).toEqual([]);
    const done = feed(core, m, 3);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ type: 'line', rawBand: { y0: 20, y1: 24 } });
  });

  it('ignores a transient hand that comes and goes', () => {
    const core = primed();
    const hand = block(empty(), 30, 79);
    expect(feed(core, hand, 2)).toEqual([]);
    expect(feed(core, empty(), 6)).toEqual([]);
  });

  it('does not emit a still hand resting on the page, then rebaselines', () => {
    const core = createDetectorCore({ width: W, height: H, rebaselineSamples: 5 });
    feed(core, empty(), 4);
    const hand = block(empty(), 30, 79);
    const events = feed(core, hand, 3 + 4);
    expect(events).toEqual([]);
    expect(core.state().status).toBe('obstructed');
    expect(core.push(hand)).toEqual({ type: 'rebaseline', reason: 'obstruction' });
  });

  it('treats a dense short block (sleeve edge) as an obstruction', () => {
    const core = primed();
    const sleeve = block(empty(), 60, 75); // 16 rows < 40% of 80 but fully dense
    expect(feed(core, sleeve, 6)).toEqual([]);
    expect(core.state().status).toBe('obstructed');
  });

  it('absorbs 1 px camera jitter without emitting', () => {
    const core = createDetectorCore({ width: W, height: H });
    const page = write(empty(), 20, 24, 10, 60);
    feed(core, page, 4);
    const shifted = write(empty(), 20, 24, 10, 60, 1, 1);
    expect(feed(core, shifted, 6)).toEqual([]);
  });

  it('ignores scattered salt noise', () => {
    const core = primed();
    const m = empty();
    for (let i = 0; i < 8; i++) m[(5 + i * 9) * W + 7 * i + 3] = 1;
    expect(feed(core, m, 6)).toEqual([]);
  });

  it('marks ink that extends the last line as an amendment', () => {
    const core = primed();
    const a = write(empty(), 20, 24, 10, 40);
    const [first] = feed(core, a, 4);
    expect(first).toMatchObject({ type: 'line', amends: false });
    const b = write(a, 19, 25, 50, 80);
    const [second] = feed(core, b, 4);
    expect(second).toMatchObject({ type: 'line', amends: true, rawBand: { y0: 19, y1: 25 } });
  });

  it('emits a fresh (non-amending) line below the previous one', () => {
    const core = primed();
    const a = write(empty(), 20, 24, 10, 60);
    feed(core, a, 4);
    const b = write(a, 40, 45, 10, 60);
    const [e] = feed(core, b, 4);
    expect(e).toMatchObject({ type: 'line', amends: false, rawBand: { y0: 40, y1: 45 } });
  });

  it('force() emits the ink added since the last emit, ignoring stability', () => {
    const core = primed();
    const m = write(empty(), 30, 34, 10, 60);
    core.push(m);
    const e = core.force();
    expect(e).toMatchObject({ type: 'line', forced: true, rawBand: { y0: 30, y1: 34 } });
    expect(feed(core, m, 6)).toEqual([]);
    expect(core.force()).toBeNull();
  });

  it('force() works before any baseline (everything is new)', () => {
    const core = createDetectorCore({ width: W, height: H });
    expect(core.force()).toBeNull();
    core.push(write(empty(), 10, 14, 5, 50));
    expect(core.force()).toMatchObject({ type: 'line', forced: true, rawBand: { y0: 10, y1: 14 } });
  });

  it('erasing ink does not emit, and reads as covered before the covered limit', () => {
    const core = createDetectorCore({ width: W, height: H });
    feed(core, write(empty(), 10, 30, 10, 90), 4);
    expect(feed(core, empty(), 20)).toEqual([]);
    expect(core.state().status).toBe('obstructed');
    expect(core.state().obstruction).toBe('covered');
  });

  it('erased lines: after coveredRebaselineSamples the known ink shrinks and detection resumes', () => {
    const core = createDetectorCore({ width: W, height: H, coveredRebaselineSamples: 40 });
    let page = empty();
    for (const y of [5, 15, 25, 35, 45]) page = write(page, y, y + 4, 10, 80);
    expect(feed(core, page, 4)).toEqual([{ type: 'baseline' }]);
    const erased = clearRect(clearRect(page, 15, 19, 0, 99), 35, 39, 0, 99); // 2 of 5 lines gone
    const events = feed(core, erased, 3 + 40);
    expect(events).toEqual([{ type: 'rebaseline', reason: 'ink-gone' }]);
    expect(core.state().status).toBe('idle');
    // A new line in the erased space is emitted.
    const [e] = feed(core, write(erased, 15, 19, 10, 60), 4);
    expect(e).toMatchObject({ type: 'line', amends: false, rawBand: { y0: 15, y1: 19 } });
  });

  it('force() may emit a line at the bottom edge of the box', () => {
    const core = primed();
    const m = write(empty(), 74, 79, 10, 60);
    expect(feed(core, m, 6)).toEqual([]);
    expect(core.state().obstruction).toBe('bottom-edge');
    expect(core.force()).toMatchObject({ type: 'line', forced: true, rawBand: { y0: 74, y1: 79 } });
  });

  it('a hand covering existing text, then leaving, never emits the text (MUST 1)', () => {
    const core = createDetectorCore({ width: W, height: H, rebaselineSamples: 12 });
    const page = write(write(empty(), 10, 14, 10, 80), 20, 24, 10, 80);
    expect(feed(core, page, 4)).toEqual([{ type: 'baseline' }]);
    // Hand outline over the text; the text under the hand is hidden.
    const hand = ring(clearRect(page, 8, 40, 30, 70), 8, 40, 30, 70);
    expect(feed(core, hand, 20)).toEqual([]); // well past 1.5 s and past rebaselineSamples
    expect(core.state().obstruction).toBe('covered');
    expect(feed(core, page, 6)).toEqual([]); // hand lifts: old text reappears
    // Real new writing is still detected afterwards.
    const next = write(page, 50, 54, 10, 60);
    const [e] = feed(core, next, 4);
    expect(e).toMatchObject({ type: 'line', rawBand: { y0: 50, y1: 54 } });
  });

  it('a still hand outline (thin ring, 35% of ROI) does not emit (MUST 2)', () => {
    const core = primed();
    const hand = ring(empty(), 20, 47, 30, 70);
    expect(feed(core, hand, 8)).toEqual([]);
    expect(core.state().obstruction).toBe('tall');
    expect(core.force()).toBeNull();
  });

  it('a smaller still hand outline (20% of ROI) is rejected as a blob (MUST 2)', () => {
    const core = primed();
    const hand = ring(empty(), 30, 45, 30, 60);
    expect(feed(core, hand, 8)).toEqual([]);
    expect(core.state().obstruction).toBe('blob');
  });

  it('ink reaching the bottom edge (arm entering) does not emit', () => {
    const core = primed();
    const arm = write(empty(), 72, 79, 40, 60);
    expect(feed(core, arm, 8)).toEqual([]);
    expect(core.state().obstruction).toBe('bottom-edge');
  });

  it('slow writing: emits once the pause is stable, then amends as the line grows', () => {
    const core = primed();
    let m = empty();
    const lines: CoreEvent[] = [];
    // 10 new ink px per sample: under the still tolerance, so the scene counts as still.
    for (let x = 10; x < 60; x += 4) {
      m = write(m, 20, 24, x, x + 2);
      const e = core.push(m);
      if (e?.type === 'line') lines.push(e);
    }
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toMatchObject({ amends: false });
    for (const e of lines.slice(1)) expect(e).toMatchObject({ amends: true, rawBand: { y0: 20, y1: 24 } });
  });

  it('a tall next line that overlaps the last rows but starts at the left is not an amendment', () => {
    const core = primed();
    const a = write(empty(), 20, 24, 10, 60);
    feed(core, a, 4);
    const b = write(a, 23, 31, 10, 60); // e.g. a fraction whose top touches the line above
    const [e] = feed(core, b, 4);
    expect(e).toMatchObject({ type: 'line', amends: false });
  });

  it('tolerates edge flicker that scales with ink on a dense page', () => {
    const core = createDetectorCore({ width: W, height: H });
    const page = write(empty(), 2, 70, 2, 97); // ~3300 ink px
    let flick = page;
    const events: CoreEvent[] = [];
    for (let i = 0; i < 6; i++) {
      flick = flick.slice();
      // Flip 40 ink pixels per sample (> 0.2% of 8000 = 16, < 3% of ink).
      for (let k = 0; k < 40; k++) flick[(2 + k) * W + 2 + (i % 2) * 2] ^= 1;
      const e = core.push(flick);
      if (e) events.push(e);
    }
    expect(events).toEqual([{ type: 'baseline' }]);
  });

  it('reset() forgets the baseline', () => {
    const core = primed();
    core.reset();
    expect(core.state().baseline).toBeNull();
    expect(core.state().status).toBe('warming');
    const page = write(empty(), 20, 24, 10, 60);
    expect(feed(core, page, 4)).toEqual([{ type: 'baseline' }]);
  });

  it('rejects masks of the wrong size', () => {
    const core = createDetectorCore({ width: W, height: H });
    expect(() => core.push(new Uint8Array(10))).toThrow();
  });
});
