# Orchestration status

Repo: `C:\Users\divya\hackathons\rough_work` (git, branch `main`). Process: `docs/WORKFLOW.md`. Ownership: `docs/CONTRACTS.md`.

## Tasks

| Task | Coder session (name / id) | Branch | Reviewer session | State |
|---|---|---|---|---|
| T1 AI Logic + Nano read + /spike | t1-coder-ai / local_5f86e43a-7af9-4517-b6b0-1e604e8ee25d | task/t1-ai-read | t1-reviewer / local_7ef83158-077d-497d-adae-ee3e1425f1e3 | MERGED (24aa9f2) |
| T2 nerdamer step checker | t2-coder-check / local_2340d82c-934f-403d-8b44-d9b2f54040ab | task/T2-step-check | t2-reviewer / local_7d165164-85d4-4cdd-b5ee-4b26e70f4d0f | MERGED @481482a |
| T3 webcam capture + line crop | t3-coder-capture / local_432c5fdb-89b6-44a2-9884-29b977942848 | task/T3-capture | t3-reviewer / local_9b8e8a5d-995c-4d08-827a-c0ebb79235c6 | MERGED @4a89b8e |
| T4 cloud explain, quota, speech | t4-coder-explain / local_44659a34-32ef-4a11-a5a4-ac0653ca91cb | task/T4-explain | t4-reviewer / local_51e01654-8078-412d-beba-b85a35d3d8cb | MERGED |
| T5 Firestore + My mistakes | t5-coder-data / local_ddf65766-b436-4d43-8604-ec84ac8bdaa9 | task/t5-data | t5-reviewer / local_76ca4003-65d6-4916-9161-b8c9110d578c | MERGED |
| T6 Remote Config, Hosting, README | t6-coder-config / local_19ee461a-00a0-4203-af28-56207ab4a8e9 | task/t6-config-deploy | t6-reviewer / local_43723da3-f191-40d2-9d3f-761dcd34966c | MERGED @326a1aa |
| T7 practice screen + pipeline | t7-coder-practice / local_4fb63dfc-c0b2-420d-acdb-25f209a0f383 | task/T7-practice | t7-reviewer / local_9993ac7e-c0e7-484f-868e-e53c2d88e46d | MERGED (T7b @daaa13c) |

`*` the app may add a prefix/suffix to branch names. Use `git branch -a` to find the real names.

Merge order: T2, T6, T1, T4, T5, T3, then T7 last (it has adapter files to fix up).

## Phase 2 (after all 7 merge)
- T8 integration pass: fix adapters, end-to-end demo mode, build on main.
- T9 polish + Devpost text + demo video script + testing instructions.

## Waiting on the user
- Firebase web config values for `.env.local` (see `.env.example`).
- reCAPTCHA Enterprise site key; App Check debug token registration (user only).
- GitHub repo creation (public, Apache 2.0) and push: needs the user's OK.

## Carry-over for T8 (from reviews)
- T4: explain timeout 8 s → 5 s target; corrupt quota count should fail closed; add taxonomy slugs (quotient rule, inequality sign flip, log/trig rules, factorisation, integral limits / +C); ensure `initializeApp` (T1) runs before `explainMistake`; pipeline must call `canCallCloud` / `recordCloudCall`.

## Review loop now
Reviewers message their coder directly with MUST items and re-review each new commit. The orchestrator merges on a one-line "VERDICT: APPROVED <branch> @ <sha>".

## Firebase setup (done Nov 25, ~00:00 IST)
Project `rough-work-81b7f` (Spark plan). Web app registered; `.env.local` filled (git-ignored). AI Logic on (Gemini Developer API, App Check enforced, AI monitoring off). Anonymous Auth on. Firestore (default) in asia-south1, production mode. App Check: reCAPTCHA Enterprise key `rough-work-web` (localhost, *.web.app, *.firebaseapp.com) registered; debug token `local-dev` in `.env.local`.
Not yet: Firestore rules deploy, Remote Config template publish, Hosting deploy (need `npx firebase-tools login`).

## First live measurements (Chrome 158, typed-font test images)
- Nano read: cold 19.7 s (first call), warm 1.9–2.4 s, 4/4 correct, conf 0.99–1.0.
- Cloud read: 4.3 s, correct.
- Cloud explain: 7.2 s (PRD target < 5 s) → T8: shorten prompt / output, drop english field or images, consider streaming. Hints came back in English, should be Hinglish.
- Real handwriting accuracy (Day 1 gate 14/20) NOT measured yet: needs the user's 20 photos.

## Phase 2 (Nov 25 ~00:30)
All of T1–T7 merged; main builds, 252 tests pass.
- T8 fixes (explain < 5 s, Hinglish hints, quota fail-closed, taxonomy): assigned 04:06 to t4-coder-explain (local_44659a34-32ef-4a11-a5a4-ac0653ca91cb), branch task/T8-fixes. Reviewer: t4-reviewer (local_51e01654-8078-412d-beba-b85a35d3d8cb).
- T9 docs (README, DEVPOST, DEMO_SCRIPT, TESTING): assigned 04:06 to t6-coder-config (local_19ee461a-00a0-4203-af28-56207ab4a8e9), branch task/T9-docs. Reviewer: t6-reviewer (local_43723da3-f191-40d2-9d3f-761dcd34966c).
Rule learned: automated turns (session notes, scheduled runs) cannot start sessions; reuse idle reviewer sessions with SendMessage instead.

## Phase 2 merged (Nov 25 ~05:00)
- T8 merged @c0ff73d, T9 merged @4cb0f32. main: build OK, 283 tests.
- Live re-measure (Chrome 158): cloud explain 1593–2439 ms, median 1959 ms over 5 cases, all hints Hinglish, mistake types correct. Target < 5 s met.
- Remaining: Day 1 handwriting test (user's 20 photos), deploy (needs `npx firebase-tools@15.37.0 login` by the user), clean-profile hosted test, video, Devpost submit.

## 9:15 resume (Nov 25)
- main @f8bd073: build OK, 283 tests pass. No open branches; all T1–T9 merged.
- Firebase CLI not logged in. Started `npx firebase-tools@15.37.0 login` in terminal tab "firebase login"; waits on the user (consent prompts + Google sign-in).
- After login: `npm run deploy:rules`, `npm run deploy:config`, `npm run deploy:hosting`, then test https://rough-work-81b7f.web.app in a clean Chrome profile.

## Deploy (Nov 25 ~09:40)
- Deployed: Firestore rules + indexes, Remote Config template, Hosting → https://rough-work-81b7f.web.app
- Security fix: the App Check debug token was inlined into the first production bundle (`const env = import.meta.env` copied every VITE_ var). src/firebase.ts now reads `import.meta.env.X` directly; rebuilt, redeployed, 0 of 9 live JS files contain the token. Old token `local-dev` revoked; new token `local-dev-2` in `.env.local`.
- Hosted checks: demo mode OK; /spike Nano read correct (cold 18.4 s); production App Check + anonymous auth + cloud Gemini OK (3.0 s); rules allow own session write, deny other-user write and `data:` strings.
- Left: clean-profile (cloud mode) check, one camera run on hosted that logs a mistake, handwriting 20-photo gate, GitHub repo (user OK), video, submit.

## First end-to-end run on the hosted app (Nov 25 ~10:55)
Method: Chrome's getUserMedia replaced by a canvas stream of a lined page; 4 lines written one by one in a handwriting-style font (Segoe Print). Everything else is the real hosted app.
- Line detection on pause: 4/4 lines cropped (1024x87, full width).
- Nano reads: 4/4 correct, all on device.
- Checker: lines 1-2 OK; line 3 (sign error) wrong after 2 matching reads.
- Cloud explanation: Hinglish + English toggle + 3-step hint ladder, correct type (sign moved across =).
- Firestore: mistake logged; My mistakes + Common mistakes show it.
- Meter: 6 device reads, 2 cloud calls.
Issues found → T10 (branch task/T10-e2e-fixes @f265298, in review by t7-reviewer):
1. Carried error (line 4 follows from wrong line 3) made a 2nd cloud call and a 2nd log.
2. Reason said "previous line" when it meant line 2.
3. Explanations started with "Line B mein" (prompt label leaked).
Cosmetic, not fixed: line thumbnail shows only the middle of the crop.
Not covered: real handwriting on paper through a real webcam (lighting, blur, hand in frame).
