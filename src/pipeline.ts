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
  /** Anonymous user id. Null when Firebase is not available. */
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

/** Options for a demo line (typed, no crop). */
export interface DemoLineOptions {
  /** Shown when this line is wrong. Demo lines never call the cloud. */
  explanation?: Explanation;
}

type Job =
  | { kind: 'crop'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'recheck'; id: string };

/** Snapshot of what to write for session counts, taken synchronously. */
interface CountsSnapshot {
  uid: string;
  sid: Promise<string | null>;
  counts: SessionCounts;
}

export const COUNTS_DEBOUNCE_MS = 2000;
/** Quota key used when there is no signed-in user. */
export const LOCAL_QUOTA_ID = 'local';

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

/** Lines sent to Firestore never carry an image. */
const textOnly = (l: Line): Line => ({ ...l, cropDataUrl: '' });

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
  /** Demo lines: no cloud, no logging, not in session counts. */
  private demo = new Map<string, Explanation | undefined>();
  /** id -> normalized plain that two reads already agreed on. */
  private confirmed = new Map<string, string>();
  /**
   * Bumped by reset() and stop(). A job or session start from an older
   * generation must not touch the new state.
   */
  private gen = 0;
  /** Generation of the job that is running now. */
  private jobGen = 0;
  private stopped = false;

  constructor(deps: PipelineDeps) {
    this.deps = deps;
  }

  // ---- public API -------------------------------------------------------

  /** Start (or restart after stop()) with config, account and Nano status. */
  init(setup: PipelineSetup): void {
    this.setup = setup;
    this.stopped = false;
    this.patch({ cloudMode: setup.cloudMode });
    this.pump();
  }

  get isReady(): boolean {
    return this.setup !== null && !this.stopped;
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
    this.scheduleCounts();
    this.enqueue({ kind: 'crop', id: line.id });
    return line.id;
  }

  /**
   * The capture module saw the student keep writing on the last line
   * (CapturedLine.amends). Replace that line's crop and read it again.
   * Falls back to a new line when there is no crop line to amend.
   */
  amendLast(cropDataUrl: string): string {
    const last = this.state.lines[this.state.lines.length - 1];
    if (!last || !last.cropDataUrl || this.demo.has(last.id)) return this.addCrop(cropDataUrl);
    this.confirmed.delete(last.id);
    this.updateLine(last.id, {
      cropDataUrl,
      read: undefined,
      editedByUser: false,
      status: 'checking',
      check: undefined,
      explanation: undefined,
    });
    if (!this.queue.some((j) => j.kind === 'crop' && j.id === last.id)) {
      this.enqueue({ kind: 'crop', id: last.id });
    }
    return last.id;
  }

  /**
   * A demo line: typed text, no crop, no read. It is checked like any line,
   * but never calls the cloud, is never logged, and is not counted in the
   * session, so demo mode is offline-safe and keeps "My mistakes" clean.
   */
  addDemoLine(plain: string, opts: DemoLineOptions = {}): string {
    const line = this.appendLine({
      cropDataUrl: '',
      read: { latex: plain, plain, confidence: 1, source: 'device', ms: 0 },
      editedByUser: true,
    });
    this.demo.set(line.id, opts.explanation);
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

  /** Clear all lines and counters (new problem). The old session keeps its final counts. */
  reset(): void {
    this.flushCounts();
    this.gen++;
    this.queue = [];
    this.sid = null;
    this.sessionPromise = null;
    this.demo.clear();
    this.confirmed.clear();
    this.patch({ lines: [], counts: { deviceReads: 0, cloudCalls: 0 }, pending: this.running ? 1 : 0, notice: null });
    this.settleIfIdle();
  }

  /** Stop work (unmount). Lines stay; init() starts it again. */
  stop(): void {
    this.flushCounts();
    this.gen++;
    this.stopped = true;
    this.queue = [];
    this.patch({ pending: 0 });
    this.settleIfIdle();
  }

  /** Write counters now (page hide / reset / stop). */
  flushCounts(): void {
    if (!this.countsTimer) return;
    clearTimeout(this.countsTimer);
    this.countsTimer = null;
    const snap = this.snapshotCounts();
    if (snap) void this.writeCounts(snap);
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

  /** True when the running job belongs to an older generation. */
  private stale(): boolean {
    return this.jobGen !== this.gen;
  }

  /** Job-side line write; dropped for a stale job. */
  private setLine(id: string, p: Partial<Line>): void {
    if (!this.stale()) this.updateLine(id, p);
  }

  private appendLine(p: Pick<Line, 'cropDataUrl'> & Partial<Line>): Line {
    const line: Line = {
      id: newId(),
      index: this.state.lines.length,
      status: 'checking',
      ...p,
    };
    this.patch({ lines: [...this.state.lines, line] });
    return line;
  }

  private bump(source: 'device' | 'cloud'): void {
    if (this.stale()) return;
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
    this.queue.push(job);
    if (!this.idleResolve) {
      this.idle = new Promise((r) => (this.idleResolve = r));
    }
    this.patch({ pending: this.queue.length + (this.running ? 1 : 0) });
    this.pump();
  }

  private settleIfIdle(): void {
    if (!this.running && this.queue.length === 0) {
      this.idleResolve?.();
      this.idleResolve = null;
    }
  }

  private pump(): void {
    if (this.running || !this.setup || this.stopped) return;
    const job = this.queue.shift();
    if (!job) {
      this.settleIfIdle();
      this.patch({ pending: 0 });
      return;
    }
    this.running = true;
    this.jobGen = this.gen;
    this.patch({ pending: this.queue.length + 1 });
    void this.run(job)
      .catch((e) => {
        console.warn('[pipeline] job failed', e);
        if (this.find(job.id)) this.setLine(job.id, { status: 'unsure' });
      })
      .finally(() => {
        this.running = false;
        if (this.stopped) this.settleIfIdle();
        else this.pump();
      });
  }

  private async run(job: Job): Promise<void> {
    if (job.kind === 'crop') {
      const r = await this.readCrop(job.id);
      // 'edited': the student fixed it mid-read; the queued recheck evaluates it.
      if (r !== 'read') return;
    }
    await this.evaluate(job.id, job.kind === 'crop');
    if (this.stale()) return;

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

  /**
   * Key for the daily cloud cap. Without an account the cap still applies,
   * under a local key, so a failed sign-in cannot lift it.
   */
  private quotaId(): string {
    return this.setup?.uid ?? LOCAL_QUOTA_ID;
  }

  /** Quota is real usage, so it is recorded even for a stale job. */
  private recordCloud(): void {
    if (!this.setup) return;
    try {
      void Promise.resolve(this.deps.recordCloudCall(this.quotaId())).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  /**
   * Nano dropped out mid-session (PREFER_ON_DEVICE fell back to the cloud).
   * Switch to cloud mode: badge, slower interval, every read behind the cap.
   */
  private enterCloudMode(): void {
    if (!this.setup || this.setup.cloudMode) return;
    this.setup = { ...this.setup, cloudMode: true };
    this.patch({ cloudMode: true });
  }

  private async allowCloud(): Promise<boolean> {
    const { cfg } = this.setup!;
    try {
      const ok = await this.deps.canCallCloud(this.quotaId(), cfg);
      if (!ok && !this.stale()) this.patch({ notice: 'Daily cloud limit reached. Fix lines by hand.' });
      return ok;
    } catch {
      return false;
    }
  }

  /** 'failed' means the line is already marked unsure. */
  private async readCrop(id: string): Promise<'read' | 'failed' | 'edited' | 'stale'> {
    const { cfg } = this.setup!;
    const line = this.find(id);
    if (!line) return 'failed';
    if (line.editedByUser) return 'edited';

    if (this.setup!.cloudMode && !(await this.allowCloud())) {
      this.setLine(id, { status: 'unsure', check: { verdict: 'unparseable', reason: 'cloud limit reached' } });
      return 'failed';
    }

    await this.waitForReadSlot();
    if (this.stale()) return 'stale';
    let read: LineRead;
    try {
      read = await this.deps.readLine(line.cropDataUrl, cfg);
      this.markRead();
      this.countRead(read);
      if (read.source === 'cloud') this.enterCloudMode();
    } catch (e) {
      this.markRead();
      console.warn('[pipeline] readLine failed', e);
      this.setLine(id, { status: 'unsure', check: { verdict: 'unparseable', reason: 'could not read the line' } });
      return 'failed';
    }
    if (this.stale()) return 'stale';

    // Rule 2: low confidence -> re-read once in the cloud.
    if (read.source === 'device' && read.confidence < cfg.confidenceThreshold && (await this.allowCloud())) {
      if (this.stale()) return 'stale';
      try {
        const cloud = await this.deps.readLineInCloud(line.cropDataUrl, cfg);
        this.countRead(cloud);
        read = cloud;
      } catch (e) {
        console.warn('[pipeline] readLineInCloud failed', e);
      }
      if (this.stale()) return 'stale';
    }

    // The student may have fixed the line while we were reading, or the
    // capture module may have amended its crop (a crop job is then queued).
    const now = this.find(id);
    if (now?.editedByUser) return 'edited';
    if (now && now.cropDataUrl !== line.cropDataUrl) return 'stale';
    this.setLine(id, { read });
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
    if (this.stale()) return;
    const line = this.find(id);
    if (!line?.read) return;
    const plain = line.read.plain;
    const prev = findPrevAnchor(this.state.lines, line.index);

    // First line (or nothing valid before it): it is the anchor. OK if it parses.
    if (!prev?.read) {
      const self = this.safeCheck(plain, plain);
      this.setLine(id, {
        status: self.verdict === 'unparseable' ? 'unsure' : 'ok',
        check: self.verdict === 'unparseable' ? self : { verdict: 'equivalent', reason: 'first line' },
        explanation: undefined,
      });
      return;
    }

    const check = this.safeCheck(prev.read.plain, plain);
    if (check.verdict === 'equivalent') {
      this.setLine(id, { status: 'ok', check, explanation: undefined });
      return;
    }
    if (check.verdict === 'unparseable') {
      // Rule 4: amber, no cloud call.
      this.setLine(id, { status: 'unsure', check, explanation: undefined });
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
      if (this.stale()) return;
      if (!agree) {
        this.setLine(id, {
          status: 'unsure',
          check: { verdict: 'unparseable', reason: 'two reads disagree; check the transcription' },
          explanation: undefined,
        });
        return;
      }
      this.confirmed.set(id, this.norm(plain));
    }
    if (this.find(id)?.read?.plain !== plain) return; // edited meanwhile; recheck is queued

    this.setLine(id, { status: 'wrong', check, explanation: undefined });
    await this.explain(id, prev);
  }

  /** Re-read the same crop on device; true when it gives the same line. */
  private async confirmRead(line: Line): Promise<boolean> {
    const { cfg } = this.setup!;
    try {
      await this.waitForReadSlot();
      if (this.stale()) return false;
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
    const line = this.find(id)!;

    // Demo lines: bundled explanation only. No cloud, no log.
    if (this.demo.has(id)) {
      const ex = this.demo.get(id);
      if (ex) this.setLine(id, { explanation: ex });
      return;
    }

    const { cfg, uid } = this.setup!;
    if (!(await this.allowCloud()) || this.stale()) return;
    let explanation: Explanation;
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
      this.recordCloud();
      this.bump('cloud');
    } catch (e) {
      console.warn('[pipeline] explainMistake failed', e);
      return; // stays red; the UI shows "no explanation"
    }
    if (this.stale()) return;

    const current = this.find(id);
    if (!current || current.status !== 'wrong' || current.read?.plain !== line.read!.plain) return;
    this.setLine(id, { explanation });

    if (!uid) return;
    const sid = await this.ensureSession();
    if (!sid || this.stale()) return;
    try {
      await this.deps.logMistake(uid, sid, textOnly({ ...current, explanation }), textOnly(prev), explanation);
    } catch (e) {
      console.warn('[pipeline] logMistake failed', e);
    }
  }

  // ---- session + counts -------------------------------------------------

  /**
   * Session id for the current generation. A startSession that resolves
   * after reset() still answers its own caller but does not become the new
   * problem's session.
   */
  private ensureSession(): Promise<string | null> {
    const uid = this.setup?.uid;
    if (!uid) return Promise.resolve(null);
    if (this.sid) return Promise.resolve(this.sid);
    if (!this.sessionPromise) {
      const g = this.gen;
      const p = this.deps
        .startSession(uid, this.problemText)
        .then((sid) => sid || null)
        .catch((e) => {
          console.warn('[pipeline] startSession failed', e);
          return null;
        })
        .then((sid) => {
          if (g === this.gen) {
            this.sid = sid;
            if (!sid) this.sessionPromise = null;
          }
          return sid;
        });
      this.sessionPromise = p;
    }
    return this.sessionPromise;
  }

  private countedLines(): number {
    let n = 0;
    for (const l of this.state.lines) if (!this.demo.has(l.id)) n++;
    return n;
  }

  /** Taken synchronously, so a later reset() cannot change what gets written. */
  private snapshotCounts(): CountsSnapshot | null {
    const uid = this.setup?.uid;
    if (!uid) return null;
    return {
      uid,
      sid: this.ensureSession(),
      counts: { ...this.state.counts, linesTotal: this.countedLines() },
    };
  }

  private scheduleCounts(): void {
    if (!this.setup?.uid) return;
    if (this.countsTimer) clearTimeout(this.countsTimer);
    this.countsTimer = setTimeout(() => {
      this.countsTimer = null;
      const snap = this.snapshotCounts();
      if (snap) void this.writeCounts(snap);
    }, COUNTS_DEBOUNCE_MS);
  }

  private async writeCounts(snap: CountsSnapshot): Promise<void> {
    const sid = await snap.sid;
    if (!sid) return;
    try {
      await this.deps.updateSessionCounts(snap.uid, sid, snap.counts);
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
 * On unmount the pipeline stops (queue dropped, counts flushed); init()
 * re-arms it, so StrictMode's mount/unmount/mount is safe.
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
      pipeline.stop();
    };
  }, [pipeline]);

  return { pipeline, state };
}
