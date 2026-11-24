// Practice pipeline: line crop -> read -> check -> (explain -> log).
// Framework-free class plus a thin React hook. All module calls come in
// through `PipelineDeps`, so tests run with fakes and no DOM.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type {
  AppConfig,
  Explanation,
  HybridCounts,
  Line,
  LineRead,
  StepCheck,
} from './types';

export interface ExplainArgs {
  prev: string;
  next: string;
  prevCrop?: string;
  nextCrop?: string;
}

export interface SessionCounts extends HybridCounts {
  linesTotal: number;
}

/** Every outside module the pipeline uses. Inject fakes in tests. */
export interface PipelineDeps {
  readLine(jpegDataUrl: string, cfg: AppConfig): Promise<LineRead>;
  readLineInCloud(jpegDataUrl: string, cfg: AppConfig): Promise<LineRead>;
  checkStep(prevPlain: string, nextPlain: string): StepCheck;
  normalizePlain(s: string): string;
  explainMistake(input: ExplainArgs, cfg: AppConfig): Promise<Explanation>;
  canCallCloud(uid: string, cfg: AppConfig): Promise<boolean>;
  recordCloudCall(uid: string): void | Promise<void>;
  startSession(uid: string, problemText: string): Promise<string>;
  logMistake(uid: string, sid: string, line: Line, prev: Line, explanation: Explanation): Promise<unknown>;
  updateSessionCounts(uid: string, sid: string, counts: SessionCounts): Promise<unknown>;
  /** Defaults to Date.now. */
  now?(): number;
  /** Defaults to setTimeout. */
  sleep?(ms: number): Promise<void>;
}

export interface PipelineSetup {
  cfg: AppConfig;
  /** Anonymous user id. Null when Firebase is not available (demo mode). */
  uid: string | null;
  /** True when Nano is not available: reads go to the cloud, slower. */
  cloudMode: boolean;
}

export interface PipelineState {
  lines: Line[];
  counts: HybridCounts;
  cloudMode: boolean;
  /** Jobs waiting or running. */
  pending: number;
  /** Short note for the UI, e.g. "Daily cloud limit reached". */
  notice: string | null;
}

/** Extra data for a text-only line (demo mode, or typed input). */
export interface TextLineOptions {
  /** Used when the cloud explanation cannot be fetched (demo without Firebase). */
  fallbackExplanation?: Explanation;
}

type Job =
  | { kind: 'crop'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'recheck'; id: string };

export const COUNTS_DEBOUNCE_MS = 2000;

let idSeq = 0;
const newId = () => `l${Date.now().toString(36)}_${(idSeq++).toString(36)}`;

/**
 * The line a new line is checked against: the last OK line before it.
 * A hand-fixed line counts once its own re-check passes (it is re-checked
 * first). Wrong and unsure lines are skipped, so one slip does not turn every
 * later line red.
 */
export function findPrevAnchor(lines: Line[], index: number): Line | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.read && l.status === 'ok') return l;
  }
  return undefined;
}

export class Pipeline {
  private deps: PipelineDeps;
  private setup: PipelineSetup | null = null;
  private state: PipelineState = {
    lines: [],
    counts: { deviceReads: 0, cloudCalls: 0 },
    cloudMode: false,
    pending: 0,
    notice: null,
  };
  private listeners = new Set<() => void>();
  private queue: Job[] = [];
  private running = false;
  private idle: Promise<void> = Promise.resolve();
  private idleResolve: (() => void) | null = null;
  private lastReadAt = -Infinity;
  private sid: string | null = null;
  private sessionPromise: Promise<string | null> | null = null;
  private problemText = '';
  private countsTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbacks = new Map<string, Explanation>();
  /** id -> normalized plain that two reads already agreed on. */
  private confirmed = new Map<string, string>();
  private disposed = false;

  constructor(deps: PipelineDeps) {
    this.deps = deps;
  }

  // ---- public API -------------------------------------------------------

  init(setup: PipelineSetup): void {
    this.setup = setup;
    this.patch({ cloudMode: setup.cloudMode });
    this.pump();
  }

  get isReady(): boolean {
    return this.setup !== null;
  }

  setProblemText(text: string): void {
    this.problemText = text;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): PipelineState => this.state;

  /** Resolves when the queue is empty. */
  whenIdle(): Promise<void> {
    return this.idle;
  }

  /** A new line crop from the capture module or the spacebar. */
  addCrop(cropDataUrl: string): string {
    const line = this.appendLine({ cropDataUrl });
    this.enqueue({ kind: 'crop', id: line.id });
    return line.id;
  }

  /** A typed line with no crop (demo mode). Skips the read. */
  addText(plain: string, opts: TextLineOptions = {}): string {
    const line = this.appendLine({
      cropDataUrl: '',
      read: { latex: plain, plain, confidence: 1, source: 'device', ms: 0 },
      editedByUser: true,
    });
    if (opts.fallbackExplanation) this.fallbacks.set(line.id, opts.fallbackExplanation);
    this.enqueue({ kind: 'text', id: line.id });
    return line.id;
  }

  /** Fix-it: the student corrects a transcription. Re-checks it and the next line. */
  editLine(id: string, plain: string): void {
    const line = this.find(id);
    if (!line) return;
    const trimmed = plain.trim();
    if (!trimmed) return;
    const read: LineRead = line.read
      ? { ...line.read, plain: trimmed, latex: trimmed }
      : { latex: trimmed, plain: trimmed, confidence: 1, source: 'device', ms: 0 };
    this.updateLine(id, {
      read,
      editedByUser: true,
      status: 'checking',
      check: undefined,
      explanation: undefined,
    });
    this.enqueue({ kind: 'recheck', id });
    const next = this.state.lines[line.index + 1];
    if (next) this.enqueue({ kind: 'recheck', id: next.id });
  }

  /** Clear all lines and counters (new problem). */
  reset(): void {
    this.flushCounts();
    this.queue = [];
    this.sid = null;
    this.sessionPromise = null;
    this.fallbacks.clear();
    this.confirmed.clear();
    this.patch({ lines: [], counts: { deviceReads: 0, cloudCalls: 0 }, pending: 0, notice: null });
  }

  /** Write counters now (page hide / unmount). */
  flushCounts(): void {
    if (this.countsTimer) {
      clearTimeout(this.countsTimer);
      this.countsTimer = null;
      void this.writeCounts();
    }
  }

  dispose(): void {
    this.flushCounts();
    this.disposed = true;
    this.queue = [];
    this.listeners.clear();
  }

  // ---- state helpers ----------------------------------------------------

  private patch(p: Partial<PipelineState>): void {
    this.state = { ...this.state, ...p };
    for (const fn of this.listeners) fn();
  }

  private find(id: string): Line | undefined {
    return this.state.lines.find((l) => l.id === id);
  }

  private updateLine(id: string, p: Partial<Line>): void {
    const lines = this.state.lines.map((l) => (l.id === id ? { ...l, ...p } : l));
    this.patch({ lines });
  }

  private appendLine(p: Pick<Line, 'cropDataUrl'> & Partial<Line>): Line {
    const line: Line = {
      id: newId(),
      index: this.state.lines.length,
      status: 'checking',
      ...p,
    };
    this.patch({ lines: [...this.state.lines, line] });
    this.scheduleCounts();
    return line;
  }

  private bump(source: 'device' | 'cloud'): void {
    const c = this.state.counts;
    this.patch({
      counts:
        source === 'device'
          ? { ...c, deviceReads: c.deviceReads + 1 }
          : { ...c, cloudCalls: c.cloudCalls + 1 },
    });
    this.scheduleCounts();
  }

  // ---- queue ------------------------------------------------------------

  private enqueue(job: Job): void {
    if (this.disposed) return;
    this.queue.push(job);
    if (!this.idleResolve) {
      this.idle = new Promise((r) => (this.idleResolve = r));
    }
    this.patch({ pending: this.queue.length + (this.running ? 1 : 0) });
    this.pump();
  }

  private pump(): void {
    if (this.running || !this.setup || this.disposed) return;
    const job = this.queue.shift();
    if (!job) {
      this.idleResolve?.();
      this.idleResolve = null;
      this.patch({ pending: 0 });
      return;
    }
    this.running = true;
    this.patch({ pending: this.queue.length + 1 });
    void this.run(job)
      .catch((e) => {
        console.warn('[pipeline] job failed', e);
        if (this.find(job.id)) this.updateLine(job.id, { status: 'unsure' });
      })
      .finally(() => {
        this.running = false;
        this.pump();
      });
  }

  private async run(job: Job): Promise<void> {
    if (job.kind === 'crop') {
      const r = await this.readCrop(job.id);
      // 'edited': the student fixed it mid-read; the queued recheck evaluates it.
      if (r !== 'read') return;
    }
    await this.evaluate(job.id, job.kind === 'crop');

    // A fix can turn a line OK; then a later red/amber line may now follow from it.
    if (job.kind === 'recheck') {
      const line = this.find(job.id);
      const next = line && this.state.lines[line.index + 1];
      if (
        line?.status === 'ok' &&
        next &&
        (next.status === 'wrong' || next.status === 'unsure') &&
        next.read &&
        !this.queue.some((j) => j.id === next.id)
      ) {
        this.queue.push({ kind: 'recheck', id: next.id });
      }
    }
  }

  // ---- read -------------------------------------------------------------

  private async waitForReadSlot(): Promise<void> {
    const { cfg, cloudMode } = this.setup!;
    if (!cloudMode) return;
    const now = this.deps.now ? this.deps.now() : Date.now();
    const wait = this.lastReadAt + cfg.cloudFrameIntervalMs - now;
    if (wait > 0) await this.sleep(wait);
  }

  private markRead(): void {
    this.lastReadAt = this.deps.now ? this.deps.now() : Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return this.deps.sleep ? this.deps.sleep(ms) : new Promise((r) => setTimeout(r, ms));
  }

  /** Count a read by where it ran; a cloud read is a cloud call. */
  private countRead(read: LineRead): void {
    this.bump(read.source);
    if (read.source === 'cloud') this.recordCloud();
  }

  private recordCloud(): void {
    const uid = this.setup?.uid;
    if (!uid) return;
    try {
      void Promise.resolve(this.deps.recordCloudCall(uid)).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  private async allowCloud(): Promise<boolean> {
    const { uid, cfg } = this.setup!;
    if (!uid) return true; // no account (demo): nothing to meter
    try {
      const ok = await this.deps.canCallCloud(uid, cfg);
      if (!ok) this.patch({ notice: 'Daily cloud limit reached. Fix lines by hand.' });
      return ok;
    } catch {
      return false;
    }
  }

  /** 'failed' means the line is already marked unsure. */
  private async readCrop(id: string): Promise<'read' | 'failed' | 'edited'> {
    const { cfg, cloudMode } = this.setup!;
    const line = this.find(id);
    if (!line) return 'failed';
    if (line.editedByUser) return 'edited';

    if (cloudMode && !(await this.allowCloud())) {
      this.updateLine(id, { status: 'unsure', check: { verdict: 'unparseable', reason: 'cloud limit reached' } });
      return 'failed';
    }

    await this.waitForReadSlot();
    let read: LineRead;
    try {
      read = await this.deps.readLine(line.cropDataUrl, cfg);
      this.markRead();
      this.countRead(read);
    } catch (e) {
      this.markRead();
      console.warn('[pipeline] readLine failed', e);
      this.updateLine(id, { status: 'unsure', check: { verdict: 'unparseable', reason: 'could not read the line' } });
      return 'failed';
    }

    // Rule 2: low confidence -> re-read once in the cloud.
    if (read.source === 'device' && read.confidence < cfg.confidenceThreshold && (await this.allowCloud())) {
      try {
        const cloud = await this.deps.readLineInCloud(line.cropDataUrl, cfg);
        this.countRead(cloud);
        read = cloud;
      } catch (e) {
        console.warn('[pipeline] readLineInCloud failed', e);
      }
    }

    // The student may have fixed the line while we were reading.
    if (this.find(id)?.editedByUser) return 'edited';
    this.updateLine(id, { read });
    return 'read';
  }

  // ---- check + explain --------------------------------------------------

  private safeCheck(prev: string, next: string): StepCheck {
    try {
      return this.deps.checkStep(prev, next);
    } catch (e) {
      console.warn('[pipeline] checkStep failed', e);
      return { verdict: 'unparseable', reason: 'checker error' };
    }
  }

  private norm(s: string): string {
    try {
      return this.deps.normalizePlain(s);
    } catch {
      return s.replace(/\s+/g, '');
    }
  }

  private async evaluate(id: string, freshRead: boolean): Promise<void> {
    const line = this.find(id);
    if (!line?.read) return;
    const plain = line.read.plain;
    const prev = findPrevAnchor(this.state.lines, line.index);

    // First line (or nothing valid before it): it is the anchor. OK if it parses.
    if (!prev?.read) {
      const self = this.safeCheck(plain, plain);
      this.updateLine(id, {
        status: self.verdict === 'unparseable' ? 'unsure' : 'ok',
        check: self.verdict === 'unparseable' ? self : { verdict: 'equivalent', reason: 'first line' },
        explanation: undefined,
      });
      return;
    }

    const check = this.safeCheck(prev.read.plain, plain);
    if (check.verdict === 'equivalent') {
      this.updateLine(id, { status: 'ok', check, explanation: undefined });
      return;
    }
    if (check.verdict === 'unparseable') {
      // Rule 4: amber, no cloud call.
      this.updateLine(id, { status: 'unsure', check, explanation: undefined });
      return;
    }

    // not_equivalent. Avoid false red flags: 2 reads must agree.
    // In cloud mode there is no device model to re-read with; trust the cloud read.
    const needConfirm =
      !line.editedByUser &&
      !!line.cropDataUrl &&
      !this.setup!.cloudMode &&
      (freshRead || this.confirmed.get(id) !== this.norm(plain));
    if (needConfirm) {
      const agree = await this.confirmRead(line);
      if (!agree) {
        this.updateLine(id, {
          status: 'unsure',
          check: { verdict: 'unparseable', reason: 'two reads disagree; check the transcription' },
          explanation: undefined,
        });
        return;
      }
      this.confirmed.set(id, this.norm(plain));
    }
    if (this.find(id)?.read?.plain !== plain) return; // edited meanwhile; recheck is queued

    this.updateLine(id, { status: 'wrong', check, explanation: undefined });
    await this.explain(id, prev);
  }

  /** Re-read the same crop on device; true when it gives the same line. */
  private async confirmRead(line: Line): Promise<boolean> {
    const { cfg } = this.setup!;
    try {
      await this.waitForReadSlot();
      const again = await this.deps.readLine(line.cropDataUrl, cfg);
      this.markRead();
      this.countRead(again);
      return this.norm(again.plain) === this.norm(line.read!.plain);
    } catch (e) {
      this.markRead();
      console.warn('[pipeline] confirm read failed', e);
      return false;
    }
  }

  private async explain(id: string, prev: Line): Promise<void> {
    const { cfg, uid } = this.setup!;
    const line = this.find(id)!;
    const fallback = this.fallbacks.get(id);
    let explanation: Explanation | undefined;

    if (await this.allowCloud()) {
      try {
        explanation = await this.deps.explainMistake(
          {
            prev: prev.read!.plain,
            next: line.read!.plain,
            prevCrop: prev.cropDataUrl || undefined,
            nextCrop: line.cropDataUrl || undefined,
          },
          cfg,
        );
        this.bump('cloud');
        this.recordCloud();
      } catch (e) {
        console.warn('[pipeline] explainMistake failed', e);
      }
    }
    explanation ??= fallback;
    if (!explanation) return; // stays red; the UI shows "no explanation"

    const current = this.find(id);
    if (!current || current.status !== 'wrong' || current.read?.plain !== line.read!.plain) return;
    this.updateLine(id, { explanation });

    const sid = await this.ensureSession();
    if (uid && sid) {
      try {
        await this.deps.logMistake(uid, sid, { ...current, explanation }, prev, explanation);
      } catch (e) {
        console.warn('[pipeline] logMistake failed', e);
      }
    }
  }

  // ---- session + counts -------------------------------------------------

  private ensureSession(): Promise<string | null> {
    const uid = this.setup?.uid;
    if (!uid) return Promise.resolve(null);
    if (this.sid) return Promise.resolve(this.sid);
    if (!this.sessionPromise) {
      this.sessionPromise = this.deps
        .startSession(uid, this.problemText)
        .then((sid) => {
          this.sid = sid || null;
          if (!this.sid) this.sessionPromise = null;
          return this.sid;
        })
        .catch((e) => {
          console.warn('[pipeline] startSession failed', e);
          this.sessionPromise = null;
          return null;
        });
    }
    return this.sessionPromise;
  }

  private scheduleCounts(): void {
    if (!this.setup?.uid) return;
    if (this.countsTimer) clearTimeout(this.countsTimer);
    this.countsTimer = setTimeout(() => {
      this.countsTimer = null;
      void this.writeCounts();
    }, COUNTS_DEBOUNCE_MS);
  }

  private async writeCounts(): Promise<void> {
    const uid = this.setup?.uid;
    if (!uid) return;
    const sid = await this.ensureSession();
    if (!sid) return;
    try {
      await this.deps.updateSessionCounts(uid, sid, {
        ...this.state.counts,
        linesTotal: this.state.lines.length,
      });
    } catch (e) {
      console.warn('[pipeline] updateSessionCounts failed', e);
    }
  }
}

/** Ratio label for the hybrid meter, e.g. "23:1", or "47:0". */
export function hybridRatio(c: HybridCounts): string {
  if (c.cloudCalls === 0) return `${c.deviceReads}:0`;
  return `${Math.round(c.deviceReads / c.cloudCalls)}:1`;
}

/**
 * React hook. Creates one Pipeline for the component's life; call
 * `pipeline.init(...)` once config, uid and device availability are known.
 */
export function usePipeline(deps: PipelineDeps): { pipeline: Pipeline; state: PipelineState } {
  const ref = useRef<Pipeline | null>(null);
  if (!ref.current) ref.current = new Pipeline(deps);
  const pipeline = ref.current;
  const state = useSyncExternalStore(pipeline.subscribe, pipeline.getState, pipeline.getState);

  useEffect(() => {
    const onHide = () => pipeline.flushCounts();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      pipeline.flushCounts();
    };
  }, [pipeline]);

  return { pipeline, state };
}
