# Demo video script

Target length: 2:45. Hard limit: under 3:00. Language: English voice-over, English subtitles.

## Before you record

- [ ] Chrome 139 or later, flag `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` on, Nano downloaded (`/spike` shows "On-device model: **available**").
- [ ] Open `/practice` with Wi-Fi **on**, so anonymous sign-in and Remote Config finish. Check that there is **no** "cloud mode" badge.
- [ ] Do one warm-up read, so the cold Nano start (about 20 s) is not in the video. Then click **New** (do not reload). This clears the warm-up line, so it is not the anchor and not in the meter.
- [ ] Webcam points down at a plain white page. Good light, no shadow from your hand.
- [ ] Fit the guide box to the page.
- [ ] Use a thick dark pen. Write large and neat. One step per line.
- [ ] Screen recorder captures the browser and the webcam picture-in-picture of the paper.
- [ ] Do a full dry run. Read the hybrid meter at the end (see "Hybrid meter check").

## The problem

Type this in the **Problem** box:

`Solve: 2(3x - 4) + 3(x + 2) - (x - 5) = 5(x + 1) + 2(x - 3) + 9`

Write these lines on paper, one per line. Lines marked ✗ are planned mistakes.

| # | Line | Planned result |
|---|---|---|
| 1 | 2(3x - 4) + 3(x + 2) - (x - 5) = 5(x + 1) + 2(x - 3) + 9 | OK (first line) |
| 2 | 6x - 8 + 3(x + 2) - (x - 5) = 5(x + 1) + 2(x - 3) + 9 | OK |
| 3 | 6x - 8 + 3x + 6 - (x - 5) = 5(x + 1) + 2(x - 3) + 9 | OK |
| 4 ✗ | 6x - 8 + 3x + 6 - x - 5 = 5(x + 1) + 2(x - 3) + 9 | Wrong (Wi-Fi off). Dropped minus on -5. |
| 5 | 6x - 8 + 3x + 6 - x + 5 = 5(x + 1) + 2(x - 3) + 9 | OK (checked against line 3) |
| 6 | 6x + 3x - x - 8 + 6 + 5 = 5(x + 1) + 2(x - 3) + 9 | OK |
| 7 | 8x + 3 = 5(x + 1) + 2(x - 3) + 9 | OK |
| 8 | 8x + 3 = 5x + 5 + 2(x - 3) + 9 | OK |
| 9 | 8x + 3 = 5x + 5 + 2x - 6 + 9 | OK |
| 10 | 8x + 3 = 5x + 2x + 5 - 6 + 9 | OK |
| 11 | 8x + 3 = 7x + 8 | OK |
| 12 | 8x - 7x + 3 = 8 | OK |
| 13 | x + 3 = 8 | OK |
| 14 ✗ | x = 8 + 3 | Wrong (Wi-Fi on). Sign not flipped when moving +3. |
| 15 | x = 8 - 3 | OK (checked against line 13) |
| 16 | x = 5 | OK |

The app checks each new line against the last line marked OK. So after a red line, write the corrected line below it.

## Shot list

| Time | On screen | Action | Voice-over |
|---|---|---|---|
| 0:00 to 0:12 | Close-up of paper and pen. Then the app with a red line. | Write line 4 with the mistake. Cut to the red line in the app. | "A dropped minus sign. Usually you find it twenty minutes later. Rough Work finds it on that line." |
| 0:12 to 0:27 | Home page, then `/practice`. | Click **Start practice**. Click **Start camera**. Drag the guide box to fit the page. Point at the top bar. | "Point a webcam at your notebook and fit the box to the page. Gemini Nano runs inside Chrome, on this laptop. The meter at the top counts where every AI call runs." |
| 0:27 to 0:35 | Laptop Wi-Fi menu, then the top bar. | Turn Wi-Fi **off**. Show the **offline** badge. | "First, no internet at all." |
| 0:35 to 1:00 | Paper and line list side by side. | Write lines 1 to 3 (speed up 4x). Write line 4 at normal speed. Line 4 turns red with a **device** badge. Show "No explanation yet (offline or daily limit)." | "Nano reads each line on the device. Code, not the AI, checks each step. Line 4 turns red a few seconds later, with no network. Nano read it twice, and both reads agree." |
| 1:00 to 1:10 | Paper and line list. | Write line 5. It turns green. | "Write the fix below. It is checked against the last correct line." |
| 1:10 to 1:15 | Wi-Fi menu, then the top bar. | Turn Wi-Fi **on**. Show the **online** badge. | "Now back online." |
| 1:15 to 1:30 | Paper and line list. | Write lines 6 to 13 (speed up 6x). Every line turns green with a **device** badge. | "While your work is right, nothing is sent to the cloud for reading. The camera sees a student's room, so full frames are never sent and never stored." |
| 1:30 to 2:00 | Line list, close-up on line 14. | Write line 14. It turns red and shows "No explanation yet (offline or daily limit)" while the cloud call runs. Cut that wait in the edit. The Hinglish explanation appears. Click **English**, then back to **Hinglish**. Click **▶ Speak** for 3 seconds. | "Line 14 is wrong. Only now does the cloud run. Gemini gets this line and the last correct line, and explains the mistake in Hinglish. There is an English version, and it reads aloud." |
| 2:00 to 2:12 | Hint ladder. | Click **Show nudge hint**, then **method**, then **answer**. | "Three hints: a nudge, the method, then the answer. The student chooses how much help to get." |
| 2:12 to 2:20 | Paper and line list. | Write lines 15 and 16. Both turn green. | "Fix it, and finish." |
| 2:20 to 2:30 | Line list. | Click a line. The edit box opens. Change the text, then press Enter. Show the line checked again (badge shows "· fixed"). | "If Nano misreads a line, click it and fix the text. The app checks it again." |
| 2:30 to 2:37 | Top bar, zoom on the meter. | Hold on the meter. | "For this problem: (read the real numbers) on-device reads, one cloud call." |
| 2:37 to 2:45 | `/mistakes` page. | Click **My mistakes**. Show the line 14 mistake type and the common mistakes list. | "Mistakes are saved as text. Device reads, code judges, the cloud speaks only when you are wrong." |

Total: 2:45.

## Hybrid meter check

The meter counts reads for the current problem. Expected counts for the plan above:

- Device reads: 16 lines, plus 2 confirm reads for the 2 red lines, gives about **18**. The warm-up read is cleared by **New**. A line written in two goes is read again, which adds device reads.
- Cloud calls: **1** (the line 14 explanation). The offline red line makes no cloud call. A low-confidence read adds 1 cloud call.

The target is at least 20:1. In the dry run, if the ratio is below 20:1, add more one-step lines (for example, split line 9 into two steps) and run again. Never edit the meter numbers in the video. Say the number that the screen shows.

## English subtitles plan

1. Write the voice-over text above into an `.srt` file, one cue per sentence, timed to the final edit.
2. Add cues for the Hinglish on screen and for the spoken Hinglish explanation: show the English translation (use the app's **English** text).
3. Upload the `.srt` to YouTube as **English** captions. Do not rely on auto-captions.
4. Also burn in short captions for the 0:35 to 1:00 and 1:30 to 2:00 segments, so the key moments read without sound.
5. Upload the video as **Public**. Check the length is under 3:00.

## If something fails during the take

| Problem | Fix |
|---|---|
| A line is not picked up | Press **Space** ("Line done"). |
| Nano misreads a line | Use it for the fix-it shot: change the text, then press Enter. |
| A line turns amber ("unsure") | Click it, type the correct text, press Enter. |
| The cloud explanation is slow | Cut the wait in the edit. Do not speed up the clock on screen. |
| No webcam shot works | Use **Demo mode** on `/practice` for the flow, and say it is a sample. |
