# PhysioCoach: 5-minute judge demo

You need a **laptop** (the physio's dashboard, logged in) and a **phone** (the patient: camera, speaker). One
presenter speaks. A second person does the exercise in front of the phone, or the presenter holds it.

The demo prescription is **Knee bend, target 60°, 10 reps, at least 2 s per rep, 1 set** for "Demo Patient". It is
created by `npm run db:seed -- --demo`, which also adds 5 past sessions so the ROM trend has history.

---

## Pre-demo checklist (T−30 min)

**Services**
- [ ] The worker is healthy. `curl http://localhost:8080/healthz` (or the deployed worker's healthz) returns OK. Redis is up.
- [ ] Web is up. The dashboard loads, you are logged in as the physio, and the database responds (the patient list renders).
- [ ] The Stream webhook URL points at `https://<domain>/api/webhook`. A test event returns 200.
- [ ] `STREAM_CALL_TYPE` matches what was smoke-tested (`default` unless `physio_session` has been verified).
- [ ] Do one dry run: **Start guided session** shows the coach tile within about 15 s. End it afterwards.

**Voice**
- [ ] The voice cache is present. `agent/assets/voice/<VOICE_SLUG>/` exists in the worker image and `VOICE_SLUG` points at it. Use the demo voice set, **not** `dev-espeak-ml`.
- [ ] The greeting is audible on both devices during the dry run.

**Network**
- [ ] Both devices are on the same reliable network (a phone hotspot as backup). Venue Wi-Fi with a captive portal is not acceptable.
- [ ] The patient link opens over **HTTPS** (deployed domain or ngrok). Camera access fails on plain HTTP.
- [ ] `NEXT_PUBLIC_DEMO_MODE=true` on the demo deployment, so a replay fallback still updates the trend.

**Sound and devices**
- [ ] The phone is charged, brightness up, volume up, and auto-lock is off. The browser has already been allowed camera access for the domain.
- [ ] Laptop volume is up. The **physio mic is muted**, because room echo would trigger barge-in and silence the coach.
- [ ] Space: the patient stands side-on, 2–3 m from the phone, with the whole leg in frame and good front lighting.

**Fallbacks ready**
- [ ] A terminal is open in `agent/` with the offline replay command already typed (see Fallback B).
- [ ] The screen recording of a full successful run is open in a paused player.

---

## The script (about 5:00)

| Time | Step | Presenter does / says | Audience sees |
|---|---|---|---|
| 0:00–0:30 | **Problem** | "Kerala is ageing and there are too few physios. Home exercise between visits goes unsupervised, done wrong or not done at all." | Title or dashboard overview |
| 0:30–0:50 | **1. Sign in as the physio** | Show the dashboard overview, already logged in. "This is the physio's view." | Overview cards, recent sessions |
| 0:50–1:10 | **2. Patient** | Open **Patients → Demo Patient**. | Patient page: history, ROM trend against target, adherence |
| 1:10–1:30 | **3. Prescription** | Open the knee-bend prescription. "Target 60°, 10 reps, at least 2 seconds each." | Prescription detail |
| 1:30–1:45 | **4. Start session** | Click **Start guided session**. "This creates a private video call and starts the AI coach." | Join-link dialog with a **QR code** |
| 1:45–2:05 | **5. Patient joins on the phone** | Scan the QR with the phone and tap Join. "No app and no account. The link works for this one call only." On the laptop, click **Join as physio**. | Phone: lobby, then the call. Laptop: physio call view with the live panel |
| 2:05–2:20 | **6. Consent** | The coach greets in Malayalam. The patient taps **ഞാൻ സമ്മതിക്കുന്നു / I agree**. "Nothing is analysed until the patient agrees, and no video is ever recorded." | The coach tile switches to the annotated skeleton view |
| 2:20–2:35 | **7. Positioning** | The coach asks the patient to stand side-on with the leg in view. Adjust until it confirms, then the countdown starts. | Positioning prompt, then a Malayalam countdown |
| 2:35–3:25 | **8. A set of reps** | The patient does **all 10 reps slowly (2 s or more each) at a steady shallow bend of about 45–50°**. "It counts every rep out loud in Malayalam, and there's the cue: bend a little more." | Annotated tile on both screens: skeleton, `n / 10`, angle gauge with the 60° line. The physio panel logs each rep |
| 3:25–3:50 | **9. Note and pain check** | The coach gives its note: good effort, you bent to about 48° against a target of 60°, do 3 more reps slowly. The pain scale appears. The patient taps **3**. "Stop is always on screen, and pain 7 or above ends the set at once and alerts the physio." | Post-set note, pain 0–10 scale |
| 3:50–4:40 | **10. Results** | End the session on the laptop. Open the session page, then the patient page. Click **Generate AI summary**. "Only numbers are stored. The summary always has a rule-based version and never diagnoses." | Set score, chart for each rep, ROM trend (seeded history plus today), adherence, weekly summary |
| 4:40–5:00 | **Close** | "Live, supervised practice for patients and real data for physios. It supports the prescription and never diagnoses." | Dashboard |

**Why 45–50°:** 35° is the minimum, so every rep counts. Anything under 52° (the target minus 8) triggers the
"good effort … 3 more reps" note. A mix of six good reps and four shallow ones averages about 52° and gives the
"well done" note instead, so keep the bend steady.

**Optional (if time allows):** start a second session, tap pain **7** on the phone, and show the red safety flag on the dashboard within 2 s.

---

## If something goes wrong

| Symptom | Do this |
|---|---|
| Error toast on Start | Click again. Start is idempotent. |
| No sound on the phone | Tap the **"No sound? Tap here"** banner, then check the volume and silent switch. |
| Consent seems ignored | Wait 2 s. It re-sends automatically and also goes through the backup path. |
| "Can't see you" or tracking lost | Step back, stand side-on, and turn on more light, as the voice prompt says. |
| The coach froze or dropped out | In the physio panel, click **Restart coach**. The set index continues and consent is kept. |
| A rep was missed | Keep going. Say "it only counts a rep when the full movement is tracked". Frame-rate dips are a known issue. |
| The LLM note is slow | Nothing to do. The rule note plays right away with the same content. |
| The dashboard is behind | It polls every 2 s. Refresh the page. |

## Fallback ladder

**A. Network is flaky but working: in-call replay.** On the prescription page, click **Start replay (demo)**. A
recorded clip (from the `AGENT_REPLAY_CLIPS` allow-list in `agent/replay/clips/`) goes through the same pipeline:
the same annotated tile, Malayalam voice, set results and dashboard update. Consent is granted automatically and
logged as replay. With `NEXT_PUBLIC_DEMO_MODE=true`, the session appears in the ROM trend and adherence with a
"demo" badge. Pick up the script at step 8.

**B. Stream or the internet is down: offline replay on the laptop.** No call is needed. A preview window opens with
the skeleton overlay, and the Malayalam audio plays locally.

```bash
cd agent
uv sync --group tools
uv run python -m physiocoach.replay.cli replay/clips/knee_demo.mp4 \
  --exercise knee_bend --target 60 --reps 10 --min-seconds 2 --play-audio
```

If the clip is missing, use `--synthetic demo_shallow` in place of the clip path. That run has no video but the same counts and note.

**C. Laptop problem:** play the pre-recorded screen capture of a full successful run.

## After the demo

- End every open session from the dashboard. Only **End session** ends a call. Closing tabs does not.
- Replay sessions are kept out of the real analytics unless demo mode is on.
