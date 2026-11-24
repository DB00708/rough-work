import { describe, expect, it, vi } from 'vitest';
import { COUNTS_DEBOUNCE_MS, LOCAL_QUOTA_ID, Pipeline, findPrevAnchor, hybridRatio, type PipelineDeps } from './pipeline';
import type { AppConfig, Explanation, Line, LineRead, StepCheck } from './types';
import { localFallbackExplanation } from './explain';

const cfg: AppConfig = {
  frameIntervalMs: 8000,
  cloudFrameIntervalMs: 20000,
  confidenceThreshold: 0.6,
  dailyCloudCap: 50,
  readPrompt: '',
  explainPrompt: '',
  cloudModel: 'test',
};

const EXPL: Explanation = {
  hinglish: 'Minus sign chhoot gaya.',
  english: 'You dropped a minus sign.',
  hints: ['Look at the sign', 'Expand carefully', 'x = 2'],
  mistakeType: 'dropped_minus',
  mistakeLabel: 'Dropped minus',
  mistakeLabelHinglish: 'Minus chhoota',
  ms: 10,
};

/** Fake checker: "a=b" lines; equivalent when the value after '=' matches; "??" is unparseable. */
function fakeCheck(prev: string, next: string): StepCheck {
  if (prev.includes('??') || next.includes('??')) return { verdict: 'unparseable' };
  const v = (s: string) => s.split('=')[1]?.trim();
  return v(prev) === v(next) ? { verdict: 'equivalent' } : { verdict: 'not_equivalent', reason: 'differs' };
}

const r = (plain: string, source: 'device' | 'cloud' = 'device', confidence = 0.9): LineRead => ({
  latex: plain,
  plain,
  confidence,
  source,
  ms: 1,
});

/** Device reads come from a per-crop script: each call pops the next value. */
function makeDeps(script: Record<string, LineRead[]>, over: Partial<PipelineDeps> = {}) {
  const calls = { cloudRead: 0, explain: 0, record: 0, log: 0, counts: 0 };
  const deps: PipelineDeps = {
    readLine: vi.fn(async (crop: string) => {
      const q = script[crop];
      if (!q?.length) throw new Error('no script for ' + crop);
      return q.length > 1 ? q.shift()! : q[0];
    }),
    readLineInCloud: vi.fn(async (crop: string) => {
      calls.cloudRead++;
      return r(crop.replace('crop:', ''), 'cloud', 0.95);
    }),
    checkStep: vi.fn(fakeCheck),
    normalizePlain: (s) => s.replace(/\s+/g, ''),
    explainMistake: vi.fn(async () => {
      calls.explain++;
      return EXPL;
    }),
    canCallCloud: vi.fn(async () => true),
    recordCloudCall: vi.fn(() => {
      calls.record++;
    }),
    startSession: vi.fn(async () => 'sid1'),
    logMistake: vi.fn(async () => {
      calls.log++;
      return 'm1';
    }),
    updateSessionCounts: vi.fn(async () => {
      calls.counts++;
    }),
    sleep: vi.fn(async () => {}),
    ...over,
  };
  return { deps, calls };
}

async function run(p: Pipeline, crops: string[]) {
  for (const c of crops) p.addCrop(c);
  await p.whenIdle();
  return p.getState();
}

describe('Pipeline routing', () => {
  it('marks equivalent steps OK and counts device reads', async () => {
    const { deps, calls } = makeDeps({ a: [r('2x=4')], b: [r('x=4')] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    const s = await run(p, ['a', 'b']);
    expect(s.lines.map((l) => l.status)).toEqual(['ok', 'ok']);
    expect(s.counts).toEqual({ deviceReads: 2, cloudCalls: 0 });
    expect(calls.explain).toBe(0);
  });

  it('re-reads once in the cloud when confidence is low, and counts it as a cloud call', async () => {
    const { deps, calls } = makeDeps({ 'crop:y=1': [r('y=7', 'device', 0.3)] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    const s = await run(p, ['crop:y=1']);
    expect(calls.cloudRead).toBe(1);
    expect(s.lines[0].read?.plain).toBe('y=1');
    expect(s.lines[0].read?.source).toBe('cloud');
    expect(s.counts).toEqual({ deviceReads: 1, cloudCalls: 1 });
    expect(calls.record).toBe(1);
  });

  it('flags wrong only when two reads agree, then explains, records and logs', async () => {
    const { deps, calls } = makeDeps({ a: [r('x=2')], b: [r('x=3'), r('x = 3')] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    p.setProblemText('solve');
    const s = await run(p, ['a', 'b']);
    expect(s.lines[1].status).toBe('wrong');
    expect(s.lines[1].explanation).toEqual(EXPL);
    expect(deps.readLine).toHaveBeenCalledTimes(3); // a, b, b confirm
    expect(s.counts).toEqual({ deviceReads: 3, cloudCalls: 1 });
    expect(calls.explain).toBe(1);
    expect(calls.record).toBe(1);
    expect(calls.log).toBe(1);
    expect(deps.startSession).toHaveBeenCalledWith('u', 'solve');
    const logArgs = vi.mocked(deps.logMistake).mock.calls[0];
    expect(logArgs[0]).toBe('u');
    expect(logArgs[1]).toBe('sid1');
    expect((logArgs[3] as Line).read?.plain).toBe('x=2');
  });

  it('marks unsure (no cloud) when the confirming read differs', async () => {
    const { deps, calls } = makeDeps({ a: [r('x=2')], b: [r('x=3'), r('x=2')] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    const s = await run(p, ['a', 'b']);
    expect(s.lines[1].status).toBe('unsure');
    expect(calls.explain).toBe(0);
  });

  it('marks unparseable lines unsure and never calls the cloud', async () => {
    const { deps, calls } = makeDeps({ a: [r('x=2')], b: [r('??')] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    const s = await run(p, ['a', 'b']);
    expect(s.lines[1].status).toBe('unsure');
    expect(calls.explain + calls.cloudRead).toBe(0);
  });

  it('checks against the last OK line, skipping unsure lines', async () => {
    const { deps } = makeDeps({ a: [r('x=2')], b: [r('??')], c: [r('2x=2')] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    const s = await run(p, ['a', 'b', 'c']);
    expect(s.lines.map((l) => l.status)).toEqual(['ok', 'unsure', 'ok']);
    expect(deps.checkStep).toHaveBeenLastCalledWith('x=2', '2x=2');
  });

  it('respects the daily cap: wrong line stays red with no explain call', async () => {
    const { deps, calls } = makeDeps(
      { a: [r('x=2')], b: [r('x=3')] },
      { canCallCloud: vi.fn(async () => false) },
    );
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    const s = await run(p, ['a', 'b']);
    expect(s.lines[1].status).toBe('wrong');
    expect(s.lines[1].explanation).toBeUndefined();
    expect(calls.explain).toBe(0);
    expect(s.notice).toMatch(/limit/i);
  });

  it('skips the low-confidence cloud re-read when over the cap', async () => {
    const { deps, calls } = makeDeps({ a: [r('x=2', 'device', 0.2)] }, { canCallCloud: vi.fn(async () => false) });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    await run(p, ['a']);
    expect(calls.cloudRead).toBe(0);
  });

  it('survives module failures: a throwing read or checker marks the line unsure', async () => {
    const { deps } = makeDeps({ a: [r('x=2')] }, {});
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    const s1 = await run(p, ['missing']);
    expect(s1.lines[0].status).toBe('unsure');

    deps.checkStep = () => {
      throw new Error('boom');
    };
    const s2 = await run(p, ['a']);
    expect(s2.lines[1].status).toBe('unsure');
  });

  it('a failing explain leaves the line wrong without crashing', async () => {
    const { deps } = makeDeps(
      { a: [r('x=2')], b: [r('x=5')] },
      { explainMistake: vi.fn(async () => Promise.reject(new Error('offline'))) },
    );
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    const s = await run(p, ['a', 'b']);
    expect(s.lines[1].status).toBe('wrong');
    expect(s.lines[1].explanation).toBeUndefined();
    expect(deps.logMistake).not.toHaveBeenCalled();
  });

  it('a timeout fallback explanation is shown and counted but not logged', async () => {
    const fallback = localFallbackExplanation({ prev: 'x=2', next: 'x=5' }, 5000);
    const { deps, calls } = makeDeps(
      { a: [r('x=2')], b: [r('x=5')] },
      { explainMistake: vi.fn(async () => fallback) },
    );
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    const s = await run(p, ['a', 'b']);
    expect(s.lines[1].status).toBe('wrong');
    expect(s.lines[1].explanation).toBe(fallback);
    expect(s.counts.cloudCalls).toBe(1);
    expect(calls.record).toBe(1);
    expect(deps.logMistake).not.toHaveBeenCalled();
    expect(deps.startSession).not.toHaveBeenCalled();
  });

  it('demo lines: bundled explanation, no cloud, no log, not counted, even with a uid', async () => {
    vi.useFakeTimers();
    try {
      const { deps } = makeDeps({});
      const p = new Pipeline(deps);
      p.init({ cfg, uid: 'u', cloudMode: false });
      p.addDemoLine('x=2');
      p.addDemoLine('x=5', { explanation: EXPL });
      p.addDemoLine('x=9');
      await p.whenIdle();
      await vi.advanceTimersByTimeAsync(COUNTS_DEBOUNCE_MS + 10);
      p.flushCounts();
      const s = p.getState();
      // x=9 is checked against x=2 (the last OK line), not the wrong x=5.
      expect(s.lines.map((l) => l.status)).toEqual(['ok', 'wrong', 'wrong']);
      expect(deps.checkStep).toHaveBeenLastCalledWith('x=2', 'x=9');
      expect(s.lines[1].explanation).toEqual(EXPL);
      expect(s.lines[2].explanation).toBeUndefined();
      expect(deps.readLine).not.toHaveBeenCalled();
      expect(deps.explainMistake).not.toHaveBeenCalled();
      expect(deps.canCallCloud).not.toHaveBeenCalled();
      expect(deps.logMistake).not.toHaveBeenCalled();
      expect(deps.startSession).not.toHaveBeenCalled();
      expect(deps.updateSessionCounts).not.toHaveBeenCalled();
      expect(s.counts).toEqual({ deviceReads: 0, cloudCalls: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('logMistake never receives crop images', async () => {
    const { deps } = makeDeps({ 'crop:a': [r('x=2')], 'crop:b': [r('x=3')] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    await run(p, ['crop:a', 'crop:b']);
    const [, , line, prev] = vi.mocked(deps.logMistake).mock.calls[0];
    expect(line.cropDataUrl).toBe('');
    expect(prev.cropDataUrl).toBe('');
    // The explain call still gets both crops (cloud explain on error).
    expect(deps.explainMistake).toHaveBeenCalledWith(
      expect.objectContaining({ prevCrop: 'crop:a', nextCrop: 'crop:b' }),
      cfg,
    );
  });

  it('Nano dropping out mid-session switches to cloud mode', async () => {
    const { deps } = makeDeps({ a: [r('x=2', 'cloud')], b: [r('x=2', 'cloud')] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    const s = await run(p, ['a', 'b']);
    expect(s.cloudMode).toBe(true);
    expect(s.counts).toEqual({ deviceReads: 0, cloudCalls: 2 });
    // Second read was gated by the cap and spaced by the cloud interval.
    expect(deps.canCallCloud).toHaveBeenCalled();
    expect(deps.sleep).toHaveBeenCalled();
  });

  it('cloud mode: waits cloudFrameIntervalMs between reads and counts cloud calls', async () => {
    let t = 0;
    const sleeps: number[] = [];
    const { deps } = makeDeps(
      { a: [r('x=2', 'cloud')], b: [r('x=2', 'cloud')] },
      {
        now: () => t,
        sleep: vi.fn(async (ms: number) => {
          sleeps.push(ms);
          t += ms;
        }),
      },
    );
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: true });
    const s = await run(p, ['a', 'b']);
    expect(s.cloudMode).toBe(true);
    expect(sleeps).toEqual([20000]);
    expect(s.counts).toEqual({ deviceReads: 0, cloudCalls: 2 });
  });

  it('cloud mode over the cap: line is unsure and not read', async () => {
    const { deps } = makeDeps({ a: [r('x=2', 'cloud')] }, { canCallCloud: vi.fn(async () => false) });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: true });
    const s = await run(p, ['a']);
    expect(s.lines[0].status).toBe('unsure');
    expect(deps.readLine).not.toHaveBeenCalled();
  });

  it('runs one read at a time, in order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    const { deps } = makeDeps(
      {},
      {
        readLine: vi.fn(async (crop: string) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((res) => setTimeout(res, 5));
          order.push(crop);
          inFlight--;
          return r('x=1');
        }),
      },
    );
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    await run(p, ['a', 'b', 'c']);
    expect(maxInFlight).toBe(1);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('queues crops added before init and processes them after', async () => {
    const { deps } = makeDeps({ a: [r('x=1')] });
    const p = new Pipeline(deps);
    p.addCrop('a');
    expect(p.getState().lines[0].status).toBe('checking');
    p.init({ cfg, uid: 'u', cloudMode: false });
    await p.whenIdle();
    expect(p.getState().lines[0].status).toBe('ok');
  });
});

describe('Fix-it edit', () => {
  it('sets editedByUser, re-checks the line and the next one', async () => {
    const { deps, calls } = makeDeps({ a: [r('x=2')], b: [r('x=3')], c: [r('2x=3')] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    let s = await run(p, ['a', 'b', 'c']);
    expect(s.lines.map((l) => l.status)).toEqual(['ok', 'wrong', 'wrong']);

    // The student says the first line was really x=3.
    p.editLine(s.lines[0].id, 'x=3');
    await p.whenIdle();
    s = p.getState();
    expect(s.lines[0].editedByUser).toBe(true);
    expect(s.lines[0].read?.plain).toBe('x=3');
    expect(s.lines[1].status).toBe('ok');
    expect(s.lines[1].explanation).toBeUndefined();
    expect(s.lines[2].status).toBe('ok'); // 2x=3 now checked against the fixed chain
    expect(calls.explain).toBeGreaterThanOrEqual(1);
  });

  it('an edited line is trusted without a confirming re-read', async () => {
    const { deps, calls } = makeDeps({ a: [r('x=2')], b: [r('x=2')] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    const s = await run(p, ['a', 'b']);
    const readsBefore = vi.mocked(deps.readLine).mock.calls.length;
    p.editLine(s.lines[1].id, 'x=7');
    await p.whenIdle();
    expect(p.getState().lines[1].status).toBe('wrong');
    expect(vi.mocked(deps.readLine).mock.calls.length).toBe(readsBefore);
    expect(calls.explain).toBe(1);
  });

  it('ignores empty edits', async () => {
    const { deps } = makeDeps({ a: [r('x=2')] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    const s = await run(p, ['a']);
    p.editLine(s.lines[0].id, '   ');
    expect(p.getState().lines[0].editedByUser).toBeUndefined();
  });
});

describe('Session counts', () => {
  it('debounces updateSessionCounts and writes absolute values with linesTotal', async () => {
    vi.useFakeTimers();
    try {
      const { deps } = makeDeps({ a: [r('x=1')], b: [r('x=1')] });
      const p = new Pipeline(deps);
      p.init({ cfg, uid: 'u', cloudMode: false });
      p.addCrop('a');
      p.addCrop('b');
      await vi.advanceTimersByTimeAsync(10);
      await p.whenIdle();
      expect(deps.updateSessionCounts).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(COUNTS_DEBOUNCE_MS + 10);
      expect(deps.updateSessionCounts).toHaveBeenCalledTimes(1);
      expect(deps.updateSessionCounts).toHaveBeenCalledWith('u', 'sid1', {
        deviceReads: 2,
        cloudCalls: 0,
        linesTotal: 2,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not write counts without a uid', async () => {
    const { deps } = makeDeps({ a: [r('x=1')] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: null, cloudMode: false });
    p.addCrop('a');
    await p.whenIdle();
    p.flushCounts();
    expect(deps.updateSessionCounts).not.toHaveBeenCalled();
    expect(deps.startSession).not.toHaveBeenCalled();
  });
});

describe('reset and stop', () => {
  it('reset() before the debounce writes the pre-reset counts to the old session; new mistakes use a new session', async () => {
    let n = 0;
    let releaseFirst!: () => void;
    const { deps } = makeDeps(
      { a: [r('x=2')], b: [r('x=2')], c: [r('y=1')], d: [r('y=5')] },
      {
        // The first session start is slow, so it is still in flight at reset().
        startSession: vi.fn(async () => {
          n++;
          if (n === 1) await new Promise<void>((res) => (releaseFirst = res));
          return `sid${n}`;
        }),
      },
    );
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    await run(p, ['a', 'b']);
    expect(deps.updateSessionCounts).not.toHaveBeenCalled(); // still debounced

    p.reset(); // flush snapshot taken now; old startSession still pending
    expect(p.getState().counts).toEqual({ deviceReads: 0, cloudCalls: 0 });
    releaseFirst();
    await new Promise((res) => setTimeout(res, 0));

    expect(deps.updateSessionCounts).toHaveBeenCalledWith('u', 'sid1', {
      deviceReads: 2,
      cloudCalls: 0,
      linesTotal: 2,
    });

    // New problem: a wrong step logs to a NEW session.
    await run(p, ['c', 'd']);
    expect(deps.startSession).toHaveBeenCalledTimes(2);
    const logArgs = vi.mocked(deps.logMistake).mock.calls[0];
    expect(logArgs[1]).toBe('sid2');
  });

  it('a job in flight at reset() does not touch the new counters or lines', async () => {
    let release!: (v: LineRead) => void;
    const { deps } = makeDeps(
      {},
      {
        readLine: vi.fn(
          () => new Promise<LineRead>((res) => (release = res)),
        ),
      },
    );
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    p.addCrop('a');
    await Promise.resolve();
    p.reset();
    release(r('x=1'));
    await p.whenIdle();
    await new Promise((res) => setTimeout(res, 0));
    expect(p.getState().counts).toEqual({ deviceReads: 0, cloudCalls: 0 });
    expect(p.getState().lines).toEqual([]);
  });

  it('stop() drops the queue; init() starts it again', async () => {
    const { deps } = makeDeps({ a: [r('x=1')], b: [r('x=1')] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    p.stop();
    p.addCrop('a');
    await new Promise((res) => setTimeout(res, 0));
    expect(deps.readLine).not.toHaveBeenCalled();
    p.init({ cfg, uid: 'u', cloudMode: false });
    await p.whenIdle();
    expect(p.getState().lines[0].status).toBe('ok');
  });
});

describe('Capture amends', () => {
  it('amendLast replaces the last crop line and reads it again', async () => {
    const { deps } = makeDeps({ a: [r('x=2')], b: [r('2*x')], b2: [r('2*x=4')] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    await run(p, ['a', 'b']);
    const id = p.getState().lines[1].id;
    expect(p.amendLast('b2')).toBe(id);
    await p.whenIdle();
    const s = p.getState();
    expect(s.lines).toHaveLength(2);
    expect(s.lines[1].cropDataUrl).toBe('b2');
    expect(s.lines[1].read?.plain).toBe('2*x=4');
  });

  it('an amend during an in-flight read drops the old result', async () => {
    let releaseOld!: (v: LineRead) => void;
    const { deps } = makeDeps(
      {},
      {
        readLine: vi.fn((crop: string) =>
          crop === 'old' ? new Promise<LineRead>((res) => (releaseOld = res)) : Promise.resolve(r('x=9')),
        ),
      },
    );
    const p = new Pipeline(deps);
    p.init({ cfg, uid: 'u', cloudMode: false });
    p.addCrop('old');
    await Promise.resolve();
    p.amendLast('new');
    releaseOld(r('x=1'));
    await p.whenIdle();
    const s = p.getState();
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].read?.plain).toBe('x=9');
    expect(s.lines[0].status).toBe('ok');
  });

  it('amendLast with no crop line adds a new line', async () => {
    const { deps } = makeDeps({ c: [r('x=1')] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: null, cloudMode: false });
    p.addDemoLine('x=1');
    p.amendLast('c');
    await p.whenIdle();
    expect(p.getState().lines).toHaveLength(2);
  });
});

describe('Quota without an account', () => {
  it('still applies the daily cap under a local key', async () => {
    const { deps, calls } = makeDeps(
      { a: [r('x=2')], b: [r('x=3')] },
      { canCallCloud: vi.fn(async () => false) },
    );
    const p = new Pipeline(deps);
    p.init({ cfg, uid: null, cloudMode: false });
    await run(p, ['a', 'b']);
    expect(deps.canCallCloud).toHaveBeenCalledWith(LOCAL_QUOTA_ID, cfg);
    expect(calls.explain).toBe(0);
  });

  it('records cloud calls under the local key', async () => {
    const { deps } = makeDeps({ 'crop:y=1': [r('y=7', 'device', 0.3)] });
    const p = new Pipeline(deps);
    p.init({ cfg, uid: null, cloudMode: false });
    await run(p, ['crop:y=1']);
    expect(deps.recordCloudCall).toHaveBeenCalledWith(LOCAL_QUOTA_ID);
  });
});

describe('helpers', () => {
  it('hybridRatio', () => {
    expect(hybridRatio({ deviceReads: 47, cloudCalls: 2 })).toBe('24:1');
    expect(hybridRatio({ deviceReads: 5, cloudCalls: 0 })).toBe('5:0');
  });

  it('findPrevAnchor returns the last OK line, skipping wrong and unsure ones', () => {
    const mk = (i: number, status: Line['status'], edited = false): Line => ({
      id: String(i),
      index: i,
      cropDataUrl: '',
      status,
      read: r('x=1'),
      editedByUser: edited,
    });
    const lines = [mk(0, 'ok'), mk(1, 'ok', true), mk(2, 'wrong', true), mk(3, 'unsure'), mk(4, 'checking')];
    expect(findPrevAnchor(lines, 4)?.id).toBe('1');
    expect(findPrevAnchor(lines, 1)?.id).toBe('0');
    expect(findPrevAnchor(lines, 0)).toBeUndefined();
  });
});
