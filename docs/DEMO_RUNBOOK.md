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
- [ ] The greeting is audible on the phone during the dry run (and on the laptop only if the Live Coach is off).

**Live Coach (OpenAI Realtime; skip this block if `OPENAI_API_KEY` is not set)**
- [ ] Preflight both checks. They print whether the key is set, never its value, and exit non-zero on failure:
  ```bash
  docker compose exec agent-worker python -m physiocoach.devtools.check_openai     # text model + one strict note call
  docker compose exec agent-worker python -m physiocoach.devtools.check_realtime   # realtime model, voice, session config
  ```
- [ ] In the dry run, the "live" coach badge appears a second or two after the patient joins, and one question during
  positioning gets a spoken answer.
- [ ] Malayalam check: if the realtime coach's Malayalam recognition or speech is weak in rehearsal, switch the demo
  patient's language to `en` for the conversation beats and **keep the Malayalam safety beat** (the deterministic
  spotter and the clips are Malayalam either way).
- [ ] Know the kill switch: set `LIVE_COACH=off` in the root `.env` (or the Dokploy Environment tab), then restart the
  worker (`docker compose up -d agent-worker`). The session then sounds exactly as it does without the Live Coach.

**Network**
- [ ] Both devices are on the same reliable network (a phone hotspot as backup). Venue Wi-Fi with a captive portal is not acceptable.
- [ ] The patient link opens over **HTTPS** at https://physio.algon.tech. Camera access fails on plain HTTP.
- [ ] `NEXT_PUBLIC_DEMO_MODE=true` on the demo deployment, so a replay fallback still updates the trend.

**Sound and devices**
- [ ] The phone is charged, brightness up, volume up, and auto-lock is off. The browser has already been allowed camera access for the domain.
- [ ] **Room setup: only the patient phone plays the coach's audio.** The laptop (physio) uses headphones or has its
  speakers muted, or sits in another room. Otherwise the coach hears itself through the patient's mic.
- [ ] The **physio mic is muted** unless you are doing the barge-in beat, because room echo would trigger barge-in and
  silence the coach.
- [ ] Volume: phone at about 70-80% (loud enough to hear across 2-3 m, not so loud that it distorts or echoes back
  into its own mic). Speak to the coach in a normal voice, facing the phone, one sentence at a time, then pause.
- [ ] Keep `LIVE_COACH_BARGE_IN=off` (half-duplex: wait for the coach to finish before speaking) unless barge-in was
  rehearsed in this room.
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

## Live Coach beats (when the Live Coach is on)

Fold these into the script above (they add about 1:30; trim the Problem and Results steps to fit). The safety beat
needs a second set: give the demo prescription 2 sets, or run it in a second session. Every Malayalam line still
needs a native-speaker check.

| When | Patient says / does | What should happen |
|---|---|---|
| Positioning (step 7) | "എന്റെ കാൽ ശരിയായി കാണുന്നുണ്ടോ?" ("Can you see my leg properly?") | The coach answers in 1-2 sentences. The orb goes listening, thinking, speaking, and a caption bubble appears. |
| Positioning | "ഇത് എത്ര തവണ ചെയ്യണം?" ("How many times should I do this?") | Grounded numbers from the prescription, e.g. "10 reps, bend to 60 degrees". |
| Countdown and set (step 8) | Just exercise. | The orb shows "Coach is quiet while counting — say stop anytime". Counts are the exact recorded clips. |
| Pain check (step 9) | After the pain question: "മൂന്ന്" ("three") | The pain scale closes on 3 and the thank-you clip plays. Tapping still works too. |
| Rest | Wait a moment, then ask "ഞാൻ എങ്ങനെ ചെയ്തു?" ("How did I do?") | The coach starts on its own with grounded feedback, then answers using only real numbers. |
| Rest (guardrail) | "ഈ വേദനയ്ക്ക് ഏത് ഗുളിക കഴിക്കണം?" ("Which tablet should I take for this pain?") | The fixed redirect: ask your physiotherapist. No medical advice. |
| Rest | "ഞാൻ തയ്യാറാണ്" ("I'm ready") | Rest ends and the countdown starts. |
| Any time | The physio unmutes and speaks. | The coach stops at once; the physio panel shows both sides of the transcript. Mute again afterwards. |
| Set 2 (safety) | "എനിക്ക് തല കറങ്ങുന്നു" ("I feel dizzy"), said clearly, then a pause. | The set halts within about 1-2 s, the safety clip plays, the physio gets the red alert and the coach stays silent. |

**Voice stop and voice symptoms are a backup.** The on-screen Stop button is the primary path. If nothing happens
within 2 s of a spoken "stop" or symptom, **press Stop** (or the symptom button) on the phone.

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
| No "live" badge, or the coach never answers | The Live Coach failed to connect or dropped; clips carry on. Continue with buttons. Before the next run, rerun the preflight checks. |
| The coach talks over itself, repeats, or reacts to its own voice | Echo: mute or put headphones on the laptop, lower the phone volume a little. If it persists, use the kill switch (`LIVE_COACH=off`, restart the worker). |
| The coach misunderstands Malayalam | Repeat once, slowly. If it keeps failing, use the buttons, and switch the next run to an `en` patient (keep the Malayalam safety beat). |
| A spoken "stop" or symptom is ignored | Press **Stop** or the symptom button. Voice is a backup only. |
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
