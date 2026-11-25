# Devpost submission text

Paste each section into the matching Devpost field. Lines marked **VERIFY BEFORE SUBMIT** depend on tests or deploys that are not done yet. Check them, then remove the marker.

## Links and form fields

- **Platform:** Web (Chrome)
- **Hosted app:** https://rough-work-81b7f.web.app (deployed Nov 25. VERIFY BEFORE SUBMIT: open it in a clean Chrome profile without Nano, expect the cloud mode badge)
- **Repository:** <GitHub repo URL> (public, Apache 2.0 visible in the About section)
- **Demo video:** <YouTube URL> (public, under 3:00, English subtitles)
- **Testing instructions:** paste from [docs/TESTING.md](TESTING.md), or link to it in the repo.

## Name

Rough Work

## Tagline

Catches your maths mistake on the line you make it.

## Inspiration

A Class 10 or JEE student practises past papers on paper. They make a sign error on line 3. They find it only at the end, when the answer does not match the key. Then they search back through every line. Tools today grade the finished sheet or need typed input. Nothing watches the paper while the student writes.

We wanted a tutor that sits beside the notebook, stays quiet while the work is right, and speaks up on the exact line that goes wrong.

## What it does

- You point a webcam at your notebook and solve a problem on paper.
- Rough Work finds each new line when you pause (or press Space), reads it, and checks that it follows from your last correct line.
- A correct line turns green. A wrong line turns red. A line that the app cannot read or parse, or that two reads disagree on, turns amber ("unsure"), so a bad read does not become a false red flag. A low-confidence read is first re-read in the cloud.
- For a red line, it gives a short explanation in Hinglish (with an English toggle), a hint ladder (nudge, method, answer) and a mistake type. A button reads the explanation aloud.
- You can click any line and fix what was read. The app checks it again.
- The **My mistakes** page lists your recent mistakes, and the most common mistake types across all users.
- A hybrid meter in the top bar shows on-device reads, cloud calls and the ratio between them.
- Demo mode plays a sample problem with one sign error, for people without a webcam.

## How we built it

- **Frontend:** Vite, React 19 and TypeScript.
- **Capture:** `getUserMedia` and a canvas frame diff inside a guide box that the student fits to the page. When the student pauses, the app crops only the new line to a JPEG. The Space key sends a line at once.
- **Read:** Firebase AI Logic with `InferenceMode.PREFER_ON_DEVICE`. Gemini Nano reads the crop in Chrome and returns JSON `{latex, plain, confidence}` through a response schema.
- **Check:** a deterministic step checker compares the new line with the last correct line. For expressions, it compares values at test points, with nerdamer's `expand()` of the difference as a backup. For equations, it checks whether one equation is a constant multiple of the other, then compares real solution sets. A partial answer (one root of two) is accepted. Anything it cannot judge is "unsure", never red.
- **Explain:** Firebase AI Logic with `InferenceMode.ONLY_IN_CLOUD` and `gemini-3.5-flash-lite`. The model returns structured JSON with a mistake type from a fixed list.
- **Firebase:** Anonymous Auth, Firestore (text-only mistake log), Remote Config (prompts, thresholds, daily cloud cap, model name), App Check with reCAPTCHA Enterprise, and Hosting.

Firebase AI Logic is called in `src/firebase.ts`, `src/read.ts` and `src/explain.ts`. The routing is in `src/pipeline.ts`.

## How hybrid inference is used

The device reads every line. Code judges every line. The cloud speaks only when a line is wrong.

| Layer | Runs | Job |
|---|---|---|
| Gemini Nano, on device | Every new line | Reads the handwriting |
| nerdamer, in code | After every read | Decides right or wrong. The result is deterministic. |
| Gemini, in the cloud | Only on a wrong step or a low-confidence read | Explains the mistake in Hinglish, gives hints, names the mistake type. Re-reads a low-confidence line. |

Routing rules:

1. Read with `PREFER_ON_DEVICE`. If Nano is not available, read in the cloud at a slower pace and show a "cloud mode" badge.
2. If Nano's confidence is below a threshold (Remote Config, default 0.6), re-read that crop once in the cloud.
3. Before a line turns red, Nano reads it a second time. Two reads must agree. (Skipped in cloud mode and for lines fixed by hand.)
4. If the checker cannot parse a line, mark it "unsure". Do not call the cloud.
5. A daily cap on cloud calls per user (Remote Config, default 50).

## Why hybrid is essential

- **Cost.** A 2-hour practice session can have hundreds of line reads. Sending each one to the cloud would cost too much for a free student tool. On the device, reads cost nothing. The cloud runs only for the few lines that are wrong.
- **Latency.** The red flag needs no network round trip. The student sees it a few seconds after finishing the line, before the next step.
- **Privacy.** The camera looks into a minor's room. Full webcam frames never leave the device and are never stored. With Nano, line crops go to the cloud only for a wrong step (the wrong line and the last correct line) or a low-confidence read (that line). Without Nano, the app shows a "cloud mode" badge and every line crop goes to the cloud for reading.
- **Bad Wi-Fi.** Hostel and home Wi-Fi in India drops often. With Nano, reading and checking work with Wi-Fi off. Only the explanation waits for the network.

The language model never decides if the maths is right. It reads handwriting on the device and explains in the cloud. The verdict comes from code.

## Challenges we ran into

- **Finding a "new line" in a webcam feed.** Hands, shadows and small camera moves all change pixels. We diff frames inside a guide box, wait for the writing to settle, and added the Space key as a manual "line done".
- **Turning handwriting into maths that a CAS can parse.** LaTeX from a model often does not parse. We ask Nano for a second field, plain ASCII maths with explicit `*`, and use that for the check.
- **False red flags.** A misread looks like a maths error. We added the two-read rule, the "unsure" state in amber, and the fix-it edit.
- **Cloud explanation speed.** Our first measurement was 7.2 s against a 5 s target. A shorter prompt, Hinglish-only output, a token cap and text-only input brought the median to 2.0 s.

## Accomplishments that we're proud of

- The full loop is built: capture, on-device read, deterministic check, cloud explanation, mistake log. On the hosted app (Nov 25): Nano read, cloud Gemini through App Check, and the Firestore rules (own writes allowed, other users and image data denied) are checked. (VERIFY BEFORE SUBMIT: one full camera run on the hosted app that logs a mistake.)
- Measurements on typed-font images, Chrome 158: warm Nano read about 2 s, cloud read 4.3 s, cloud Hinglish explanation 1.6 to 2.4 s (median 2.0 s over 5 runs). Accuracy on real handwriting is not measured yet. (VERIFY BEFORE SUBMIT: add the handwriting score.)
- Cloud calls are rare by design, and the hybrid meter shows the ratio live.
- Webcam frames never leave the device or get stored.

## What we learned

- On-device models are good readers but should not be judges. A small CAS gives a verdict that you can trust and test.
- `PREFER_ON_DEVICE` makes the hybrid code short. The work is in the routing rules around it: confidence, agreement and caps.
- Structured JSON output from both Nano and the cloud model removes most parsing problems.
- For a student, "unsure" is better than a wrong red flag.

## What's next

- Measure accuracy on real handwriting from more students and tune the read prompt through Remote Config.
- Faster cloud explanations (under 5 s).
- More topics: calculus steps, inequalities, trigonometric and log identities.
- A weekly summary of repeated mistake types for the student, a parent or a tutor.

## Built with

firebase-ai-logic, gemini-nano, gemini-api, chrome-built-in-ai, firebase, firestore, firebase-auth, firebase-remote-config, firebase-app-check, recaptcha-enterprise, firebase-hosting, react, typescript, vite, nerdamer, webrtc, canvas, web-speech-api
