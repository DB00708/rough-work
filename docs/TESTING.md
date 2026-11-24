# Testing instructions for judges

You do not need an account, a key or a password. The app signs you in anonymously.

**Hosted app:** <https://rough-work-81b7f.web.app> (not deployed yet; this line will be updated on deploy).

There are three ways to test, from least to most setup:

| Path | You need | What you see |
|---|---|---|
| A. Demo mode | Any desktop Chrome | The step check, red line, Hinglish explanation and hints, from a built-in sample |
| B. Cloud mode | Chrome and a webcam | The full loop, but each line is read in the cloud (slower) |
| C. Full hybrid | Chrome 139+, the flag, the Nano model, a webcam | The full loop with on-device reads, including Wi-Fi off |

## A. Demo mode (no webcam, no Nano)

1. Open the hosted app in Chrome.
2. Click **Start practice**.
3. Wait until "Getting ready…" goes away. Click **Demo mode**.
4. Expect: four sample lines appear, one about every second, each with a **typed** badge. Line 3 (`3*x - 2*x = 4 - 6`) turns red. A Hinglish explanation appears under it.
5. Click **English** to see the English version. Click **▶ Speak** to hear it.
6. Click **Show nudge hint**, then **Show method hint**, then **Show answer hint**.
7. Click any line, change the text, and press Enter. The line is checked again.

Demo mode uses a bundled explanation. It does not call the cloud, does not change the hybrid meter, and does not save to **My mistakes**.

## B. Cloud mode (webcam, no Nano)

If Chrome cannot run Gemini Nano, the app reads lines in the cloud and shows a **cloud mode** badge in the top bar. Reads are slower (about 4 s each), and the app waits at least 20 s between cloud reads.

1. Open the hosted app. Click **Start practice**.
2. Click **Start camera** and allow camera access.
3. Point the webcam down at a sheet of paper. Drag the guide box to fit the page.
4. Type a problem in the **Problem** box, for example `Solve 3(x - 2) = 2x + 4`.
5. Write one step per line, large and neat, with a dark pen:
   - `3(x - 2) = 2x + 4`
   - `3x - 6 = 2x + 4`
   - `3x - 2x = 4 - 6` (wrong on purpose)
6. After each line, move your hand out of the box and pause, or press **Space** ("Line done").
7. Expect: each line shows its transcription and a **cloud** badge. Lines 1 and 2 turn green. Line 3 turns red, then a Hinglish explanation and hints appear.
8. Write the corrected line `3x - 2x = 4 + 6`. It is checked against line 2 and turns green.
9. Click **My mistakes** (from the home page). Expect the mistake from line 3.

In cloud mode, each line crop goes to the cloud for reading. Full webcam frames never leave the device.

## C. Full hybrid (Gemini Nano on device)

### Set up Chrome

1. Use Chrome desktop 139 or later, on a machine with 16 GB RAM (or a GPU with more than 4 GB VRAM) and about 22 GB free disk.
2. Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`. Set it to **Enabled**. Restart Chrome.
3. Open the hosted app and go to `/spike` (or click **Spike (dev)** on the home page).
4. Click **Download Gemini Nano**. Wait until it shows 100% and "On-device model: **available**". The download is large and can take a long time.

### Test the loop

1. Open the hosted app with Wi-Fi on. Click **Start practice**. Check that there is **no** "cloud mode" badge.
2. Follow steps 2 to 8 of path B.
3. Expect: lines show a **device** badge. A red line appears in about 2 to 3 s after the line is sent. The first read after a page load can take about 20 s while Nano starts.
4. Expect: the meter in the top bar counts **on-device reads** for every line and a **cloud call** only for the explanation.

### Wi-Fi off test

1. Load `/practice` with Wi-Fi on, start the camera, and write one correct line.
2. Turn Wi-Fi off. The top bar shows **offline**.
3. Write a correct step, then a wrong step.
4. Expect: both lines show a **device** badge. The wrong line turns red. Under it: "No explanation yet (offline or daily limit)." Reading and checking work without the network.
5. Turn Wi-Fi on. Write the corrected line, then make a new mistake. Expect: the new red line gets a Hinglish explanation.

## What to expect

| State | Meaning |
|---|---|
| Green (OK) | The step follows from the last correct line. |
| Red (wrong) | The step does not follow. With Nano, two reads agreed before the line turned red. |
| Amber (unsure) | The app could not read or parse the line, or two reads disagreed. Click the line and type the correct text. |
| **device** / **cloud** / **typed** badge | Where the line was read. **typed** is a demo or hand-fixed line. |
| **cloud mode** badge | Nano is not available. Every line is read in the cloud. |

Limits:

- One problem at a time. Click **New** to start the next problem. The meter resets for each problem.
- Algebra lines only (no geometry, graphs or word problems).
- A daily cap of 50 cloud calls per user. At the cap, lines that need the cloud turn amber, and you can fix them by hand.
- Handwriting accuracy depends on the pen, light and camera angle. Neat, large writing works best.

## Privacy

- No webcam frame is stored.
- Line crops stay in memory. A crop goes to the cloud for a wrong step, a low-confidence read, or every read in cloud mode.
- Firestore stores text only: the two lines around each mistake and the explanation.
