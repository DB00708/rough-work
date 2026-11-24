# Module contracts and ownership

All shared types live in `src/types.ts`. Do not edit it in a task branch. If you need a change, say so in your report; the orchestrator makes it.

Each task owns only its files. Other tasks import these exports by the exact names below. Stubs exist on `main` so everything compiles from the start.

| Task | Owns | Must export |
|---|---|---|
| T1 AI Logic + spike | `src/firebase.ts`, `src/read.ts`, `src/pages/Spike.tsx` | `app`, `auth`, `db`, `ai`, `ensureSignedIn(): Promise<string /*uid*/>`, `getReadModel()`, `getCloudModel()`; `readLine(jpegDataUrl, cfg): Promise<LineRead>`, `readLineInCloud(jpegDataUrl, cfg): Promise<LineRead>`, `isOnDeviceAvailable(): Promise<boolean>`, `initDeviceModel(onProgress:(pct:number)=>void): Promise<void>` |
| T2 step checker | `src/check.ts`, `src/check.test.ts` | `checkStep(prevPlain, nextPlain): StepCheck`, `normalizePlain(s): string` |
| T3 capture | `src/capture/*` | `useCamera()`, `createLineDetector(opts)` returning `{ onFrame(video), forceLineDone() }` that emits `{ cropDataUrl, bbox }` once per new line, `FrameGuide` component |
| T4 cloud explain | `src/explain.ts`, `src/speech.ts`, `src/quota.ts` | `explainMistake({prev, next, prevCrop?, nextCrop?}, cfg): Promise<Explanation>`, `speak(text, lang)`, `canCallCloud(uid, cfg): Promise<boolean>`, `recordCloudCall(uid)` |
| T5 data | `src/data/*`, `firestore.rules`, `firestore.indexes.json`, `src/pages/Mistakes.tsx` | `startSession(uid, problemText)`, `updateSessionCounts(uid, sid, counts)`, `logMistake(uid, sid, line, prev, explanation)`, `listMyMistakes(uid)`, `listCommonMistakes()` |
| T6 config + deploy | `src/config.ts`, `src/config.test.ts`, `docs/SETUP.md`, `firebase.json`, `.firebaserc`, `remoteconfig.template.json`, `README.md`, `LICENSE` | `DEFAULT_CONFIG: AppConfig`, `loadConfig(): Promise<AppConfig>` |
| T7 practice screen | `src/pages/Practice.tsx`, `src/pipeline.ts`, `src/components/*`, `src/App.tsx`, `src/main.tsx`, CSS | `usePipeline()` orchestrating read → check → explain → log; routes `/`, `/practice`, `/mistakes`, `/spike` |

Routing rules (PRD section 4), implemented in `src/pipeline.ts`:
1. Read with PREFER_ON_DEVICE. If Nano is not available, read in cloud at `cloudFrameIntervalMs` and show a "cloud mode" badge.
2. If `confidence < confidenceThreshold`, re-read the crop once in the cloud.
3. If `checkStep` says `not_equivalent` (and 2 reads agree), call `explainMistake` (ONLY_IN_CLOUD).
4. If `unparseable`, mark the line "unsure" (amber). Do not call the cloud.
5. Respect the daily cloud cap.

No webcam frame is ever stored. Crops stay in memory and go to the cloud only on an error or a low-confidence read.
