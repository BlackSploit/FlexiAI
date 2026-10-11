# PhysioCoach

> **Guided home physiotherapy, coached live in Malayalam.**
> A physiotherapist prescribes an exercise; an AI coach joins the patient's video call, watches their movement,
> counts every rep, measures range of motion and speaks to them in their own language, while the physio
> sees the results live and over time.

## Abstract

### The problem
Recovery after a knee replacement, a fracture or a stroke depends on doing prescribed exercises at home, every day,
correctly. In Kerala, an ageing population and too few physiotherapists mean most of that work goes
**unsupervised**. Patients do reps too fast, bend too little or stop when it hurts, and the physio only finds out at
the next clinic visit, weeks later. Existing exercise apps are in English, need accounts and app installs, and show
videos rather than watching the patient. That rules them out for many elderly, Malayalam-speaking patients.

### The solution
PhysioCoach turns a short video call into a **supervised exercise session**, with no app to install and no account
to create.

1. **The physio prescribes.** They pick an exercise from a clinical library, knee bend, elbow bend or shoulder
   raise, and set the target angle, reps, sets and minimum seconds per rep.
2. **The physio starts a session.** PhysioCoach creates a private video call and a signed one-time link, shared as
   a QR code or through WhatsApp.
3. **The patient taps the link** on any phone. After consent, the AI coach is already in the call. It:
   - finds the patient's body with pose estimation and measures the joint angle in real time;
   - counts each rep, checks depth and tempo, and shows an annotated video with a skeleton, the rep count, an angle
     gauge and the target line;
   - **speaks in Malayalam**, with cues like "bend a little more" and "slow down", plus a short spoken summary after
     each set;
   - asks for a pain score (0–10) after every set and **stops the set at once** on high pain, a symptom
     (dizziness, chest pain, sharp pain) or the big red Stop button.
4. **The physio watches live or later.** The dashboard shows every rep as it happens, safety alerts, results set by
   set, range-of-motion trends against the target, adherence, pain flags, and a bilingual **weekly summary**
   (drafted by AI and checked by rules) ready to share with the patient.

### What makes it different
- **It measures the movement.** Reps are counted from joint angles, not guessed by a chatbot. The rep engine is
  pure, deterministic and fully unit-tested.
- **Malayalam first.** Voice cues, captions and every patient-facing button are in Malayalam, with English
  alongside. The audio clips are pre-rendered and cached, so the coach replies in about a third of a second.
- **Nothing to install.** Patients join from a browser using a signed link that works for that one call only. The
  physio uses a desktop dashboard.
- **AI where it helps, rules where it matters.** OpenAI writes the encouraging post-set note and the weekly summary.
  Every AI sentence is checked: the numbers must match the data, banned (diagnosis) words are rejected and the
  Malayalam must really be Malayalam. If any check fails, a deterministic rule-based note is used instead, so the
  product works fully offline from the LLM.
- **A coach you can talk to.** With an OpenAI key, the optional **Live Coach** answers the patient's questions by voice
  in the call, reports pain and symptoms they say out loud, and gives grounded feedback between sets. Counting,
  cues and safety stay deterministic; if the Live Coach is off or fails, the session sounds exactly as before.
- **The physio stays in charge.** Speaking in the call quiets the coach (barge-in). They can stop a set, restart a
  crashed coach, or end the session for everyone.

### Safety and privacy by design
- **No video or audio is recorded or stored.** Only numbers are saved: reps, angles, tempo, scores and pain.
- **No diagnosis, ever.** The coach supports the prescribed exercise and never changes it.
- **Safety stops always win.** Stop, symptoms and pain of 7 or more go out over two independent paths, so the
  physio is alerted even if the AI coach is down.
- Patient access is a signed, expiring link tied to one call. Regenerating the link revokes the old one. Physio
  data is isolated per physio.

### How it's built
| Layer | Technology |
|---|---|
| Web app and API | Next.js 15 (App Router), React 19, tRPC v11, TanStack Query, Tailwind and shadcn/ui |
| Data and auth | Neon Postgres with Drizzle ORM; Better Auth for physios; HMAC-signed join links for patients |
| Real-time video | Stream Video (WebRTC SFU) with a locked-down `physio_session` call type (recording and transcription off) |
| AI coach | Python 3.13 worker on Vision Agents: MediaPipe / YOLO pose estimation → joint-angle EMA → rep engine → coach rules → cached Malayalam TTS with Silero VAD barge-in |
| Language model | OpenAI (`gpt-5-mini` by default, strict JSON schema) for post-set notes and weekly summaries, validated and with a rule fallback |
| Live Coach (optional) | OpenAI Realtime (`gpt-realtime-2`, voice `marin`) for spoken conversation, with tools wired into the deterministic flow |
| Reliability | FastAPI supervisor (one process per call), Redis outbox with signed retries, heartbeats and agent-down detection |

### Impact
A physiotherapist can supervise many more patients' home sessions without being present at each one. Patients get
real-time correction and encouragement in their own language, and the clinic gets objective progress data instead
of "I did my exercises". The approach extends to other exercises, other Indian languages and tele-rehab programmes.

---

## Architecture

```
 ┌────────────────────────────── Browser ───────────────────────────────┐
 │ Physio dashboard (Better Auth)        Patient  /join/[token]         │
 │  tRPC + TanStack Query (2 s poll)      no login, single-call token   │
 │  /call/[sessionId]  viewer="physio"    viewer="patient": consent,    │
 │  live rep panel, alerts, Restart coach Stop, pain 0-10, symptoms     │
 └──────────┬───────────────────────────────────────┬──────────────────┘
            │ tRPC / HTTPS                          │ WebRTC + custom events (pc.*)
            ▼                                       ▼
 ┌──────────────── web: Next.js 15 ────────────┐   ┌──────── Stream Video ────────┐
 │ Better Auth · tRPC routers · Drizzle        │──►│ SFU, call type (recording,   │
 │ (the ONLY database writer)                  │   │ transcription disabled),     │
 │ lib/stream-video: create call, tokens       │◄──│ webhooks, custom events      │
 │ /api/webhook        Stream lifecycle        │   └──────────────▲───────────────┘
 │ /api/agent/events   HMAC worker → web       │                  │ joins as
 │ lib/agent-worker    HMAC web → worker       │                  │ "physiocoach-agent"
 └──────┬─────────────────────▲─────────┬──────┘                  │
        │ neon-http           │ signed  │ signed                  │
        ▼                     │ callback│ control                 │
 ┌──────────────┐   ┌─────────┴─────────▼─── agent-worker (Python, internal) ────────┐
 │ Neon Postgres│   │ FastAPI supervisor :8080 ── Redis (lifecycle, heartbeats,       │
 │ (system of   │   │   one OS process per call  inbox, callback outbox)              │
 │  record)     │   │ ┌──────────── Vision Agents process (one per call) ───────────┐ │
 └──────────────┘   │ │ patient frames → pose (MediaPipe | YOLO) → joint angle      │ │
                    │ │   → EMA → RepEngine (pure, deterministic) → set metrics     │ │
                    │ │   → annotated tile (skeleton, n/10, gauge, target line)     │ │
                    │ │ Flow: consent → positioning → countdown → set → note → pain │ │
                    │ │ Coach: templated cues; rule note ∥ optional OpenAI note     │ │
                    │ │ Voice: pre-rendered Malayalam clips → cache → TTS fallback  │ │
                    │ │ Barge-in: physio speaks → coach goes quiet                  │ │
                    │ │ Live Coach (optional): OpenAI Realtime conversation + tools │ │
                    │ └─────────────────────────────────────────────────────────────┘ │
                    └──────────────────────────────────────────────────────────────────┘
```

- **Next.js** (repo root) is the only product backend. It handles physio auth, patients, prescriptions, sessions,
  results, analytics, Stream call creation and tokens, the Stream webhook and the worker callbacks.
- **agent-worker** (`./agent`, Python 3.13, uv) runs the coach. It **never touches Postgres**. It sends consent,
  set results, pain and safety events back to the web app over HMAC-signed `POST /api/agent/events`, and retries
  from a Redis outbox if a callback fails.
- **Shared contracts** live in `shared/` (`exercises.json`, `phrases.json`, fixtures). `src/modules/agent-bridge/schemas.ts`
  and `agent/physiocoach/core/contracts.py` mirror each other, so a change to one means changing the other and the fixtures too.
- **Two input paths:** consent, Stop, pain and symptoms go out as Stream custom events and also through a backup
  path (web → worker Redis inbox), so a dropped event never loses a safety signal.

## Features

**Physio dashboard (desktop)**
- Patients, prescriptions (exercise, target angle, reps, sets, seconds per rep, sessions per week) and session history.
- **Start guided session** creates the Stream call, starts the coach and opens a join-link dialog with a QR code for the patient.
- Live call view: each rep as it happens, safety alerts, and a **Restart coach** button (the set index continues and consent is kept).
- Results: per-set score, a chart for each rep, ROM trend against the target, adherence, pain flags, and a weekly summary
  (rule-based, with an optional **Generate AI summary** button).

**Patient call (phone first, Malayalam first)**
- Opens from a signed, single-call link, with no account. The page sends `noindex`.
- Consent button "ഞാൻ സമ്മതിക്കുന്നു / I agree". No pose analysis runs until the patient presses it.
- Malayalam voice: greeting, positioning prompts, countdown, rep counts, one short cue per rep at most, a post-set note and a pain check.
- Large touch targets for Stop, pain 0–10 and symptom buttons (dizziness, chest pain, sharp pain). Captions in Malayalam, plus English for patients who prefer it.

**Agent worker**
- A deterministic rep engine with an arming rule, a minimum peak, a minimum time per rep and dropout handling.
- Rule-based coaching from a fixed phrase catalogue, with audio rendered in advance.
- Replay mode feeds a recorded clip through the same pipeline, for demos and golden tests.
- Optional Live Coach (OpenAI Realtime): spoken Q&A, voice pain and symptom reports, grounded feedback at rest. See below.

## Live Coach (optional, OpenAI Realtime)

The Live Coach adds a real conversation to the call. It is **on when `OPENAI_API_KEY` is set** (unless
`LIVE_COACH=off`) and completely absent without a key.

**One owner per job**
- **Rep engine and flow** own counts, angles, scores, phases and safety. They are deterministic and never depend on the LLM.
- **Pre-rendered clips** own every scripted cue: greeting, positioning, countdown, rep counts, the post-set note,
  the pain question and the safety line. They start in about 20 ms and are verbatim, reviewed Malayalam.
- **The realtime model** owns free conversation only: answering the patient during positioning and rest, short
  replies after a tool call, and one proactive, grounded comment when rest starts. It never speaks counts and is
  quiet during the countdown and the set.

**How they share one voice**
- An **arbiter** serialises everything onto the coach's single audio track, and clips always win. Realtime audio is
  dropped unless the phase is conversational, consent is given, the physio is not speaking and no clip is playing.
  Non-safety clips wait (at most 5 s) while the coach is mid-sentence; safety and count clips never wait.
- The coach sees the session through silent `[STATE]` items (phase, each rep, set summaries, pain requests) and a
  `get_progress` tool, and may only quote those numbers.
- Tools route into the same paths as the buttons: `report_pain`, `report_symptom`, `request_stop`,
  `ready_to_continue`. A halt silences the coach in the same tick.
- **Voice-safety spotter:** every final patient transcript, in every phase, is checked against a deterministic
  list of stop and symptom phrases, so "stop" or "I feel dizzy" halts the set even if the model does nothing.
  Voice stop is a convenience; the on-screen Stop button stays the primary path.
- A guardrail tripwire cuts the coach off if it starts giving medical advice, and the prompt supplies a fixed
  redirect to the physiotherapist.

**Fallback.** The connection starts in the background when the patient joins (6 s timeout, one retry with a
minimal session). If it fails or drops later, the coach is marked down, the "live" badge goes away and the
cached clips carry on, so the session sounds exactly as it does without the Live Coach. There is no reconnect
during a call. Kill switch: set `LIVE_COACH=off` and restart the worker.

**Language.** The coach speaks the patient's language (`ml` or `en`) and follows a switch. As an explicit exception
to the "audio is always Malayalam" rule (DEV-16), the Live Coach may speak English to an `en` patient. Clips stay Malayalam.

**Privacy.** No patient audio or images are sent to OpenAI before the patient consents; before that, only the
session instructions (the prescription, no name) are. The consent text always includes:

> If the live voice coach is on, your voice (and, if enabled, still images of the annotated exercise video) are
> sent live to OpenAI so the coach can answer you. Live captions of the conversation are shown in the call.
> PhysioCoach does not record or store your video, voice or the conversation. OpenAI may keep API data for a
> limited time for abuse monitoring under its API policy.

Transcripts are shown as live captions only; they are not stored and are kept out of the worker's INFO logs.

**Room setup is part of the system.** Only the **patient device** plays the coach's audio. The physio uses
headphones, mutes their speakers or sits in another room; otherwise the coach can hear itself. Patient barge-in
(`LIVE_COACH_BARGE_IN`) stays off (half-duplex) unless it has been rehearsed in that room.

## Privacy and safety guarantees

| Guarantee | How it is enforced |
|---|---|
| **No video or audio is stored** | Recording, transcription, captions and frame recording are disabled on the call type and in each call's `settings_override`. Only derived numbers (angles, rep counts, scores, pain) are saved. No transcripts are stored; Live Coach captions are shown in the call only. |
| **Live Coach is consented and optional** | No patient audio or images go to OpenAI before consent, and the consent text names OpenAI. Without a key, or with `LIVE_COACH=off`, nothing is sent. |
| **No diagnosis, no prescription changes** | Spoken lines come from a fixed catalogue. The optional LLM note is checked against a deny-list and replaced by the rule note if it fails. UI copy avoids diagnostic wording. |
| **Works without an LLM** | Counting, cues, the post-set note and the weekly summary all have deterministic rule paths. The LLM is optional, has a timeout and falls back to the rules. It never decides counts, angles or safety. |
| **Stop always wins** | Stop and the symptom buttons are enabled as soon as the call UI renders, before the coach joins. Pain ≥ 7, Stop or a symptom halts the set at once, alerts the physio and writes a safety event through both input paths. Symptoms send on the first tap. |
| **No analysis before consent** | The pose model ignores the patient's frames until `pc.consent` arrives. |
| **Barge-in** | When the physio speaks, the coach stops talking right away. |
| **Secrets stay server-side** | Only `NEXT_PUBLIC_*` values reach the browser. Join tokens are signed, scoped to one call, stored only as a hash and expire. |
| **Leaving does not end the call** | Only the physio's **End session** (or server lifecycle logic) ends a call. |

## Local setup

Prerequisites: Node 22, Docker Desktop (WSL2 backend on Windows), [uv](https://docs.astral.sh/uv/) for native
Python work, a Neon database and a Stream Video app. Production runs on Dokploy at https://physio.algon.tech.

### 1. Environment

Copy `.env.example` to `.env` and fill in the values. `.env.example` holds placeholders and safe defaults only; never
put real keys in it and never commit `.env`. An empty value always means "use the default". The worker reads the root
`.env` through docker compose interpolation (Stream keys are mapped to the names getstream reads, and the OpenAI and
Live Coach variables are passed through), and it can also read an optional `agent/.env`. After changing `.env`,
recreate the worker: `docker compose up -d agent-worker`.

**web (root `.env`)**

| Key | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `BETTER_AUTH_SECRET` | Better Auth signing secret (≥ 32 random bytes) |
| `BETTER_AUTH_URL` | Auth base URL, e.g. `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | Public base URL used in patient join links: `http://localhost:3000` locally, `https://physio.algon.tech` in production |
| `NEXT_PUBLIC_STREAM_VIDEO_API_KEY` | Stream API key (public) |
| `STREAM_VIDEO_SECRET_KEY` | Stream API secret (server only) |
| `STREAM_CALL_TYPE` | `default` until `physio_session` is created and verified |
| `NEXT_PUBLIC_STREAM_AGENT_USER_ID` | The coach's Stream user id (`physiocoach-agent`) |
| `JOIN_LINK_SECRET` | Signs the single-call patient join tokens |
| `AGENT_WORKER_URL` | Worker control API, `http://localhost:8080` in dev |
| `AGENT_CONTROL_SECRET` | HMAC secret for web → worker control calls |
| `AGENT_CALLBACK_SECRET` | HMAC secret for worker → web callbacks |
| `AGENT_REPLAY_CLIPS` | Comma-separated allow-list of replay clip file names |
| `OPENAI_API_KEY` | Optional AI weekly summary (rules are used without it) |
| `OPENAI_MODEL` | Text model, default `gpt-5-mini` |
| `OPENAI_REASONING_EFFORT` | Empty = `minimal`; `omit` leaves the parameter out; sent only to reasoning models (`gpt-5*`, `o1`/`o3`/`o4`...) |
| `WEEKLY_SUMMARY_LLM_ENABLED` | `false` turns the AI weekly summary off |
| `NEXT_PUBLIC_DEMO_MODE` | `true` only on the demo deployment: replay sessions show in analytics with a "demo" badge |
| `ALLOW_SIGNUP` | `true` to allow physio sign-up |

**agent-worker**

| Key | Purpose |
|---|---|
| `STREAM_API_KEY`, `STREAM_API_SECRET` | Same Stream app as web (compose maps them from the web keys) |
| `WEB_INTERNAL_URL` | Where callbacks go (`http://host.docker.internal:3000` in dev) |
| `REDIS_URL` | Worker state, inbox and outbox |
| `AGENT_CONTROL_SECRET`, `AGENT_CALLBACK_SECRET` | Same values as web |
| `AGENT_REPLAY_CLIPS` | Replay clip allow-list (clips live in `agent/replay/clips/`) |
| `SARVAM_API_KEY` | Primary runtime Malayalam TTS (for text that has no pre-rendered clip) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to the service-account JSON for the fallback TTS |
| `OPENAI_API_KEY` | Optional post-set note and Live Coach (passed from the root `.env`) |
| `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`, `NOTE_LLM_MODEL` | Text model and effort for the note (`NOTE_LLM_MODEL` overrides `OPENAI_MODEL`; effort as for web, `omit` drops it) |
| `NOTE_LLM_ENABLED`, `NOTE_LLM_TIMEOUT_S`, `NOTE_TTS_TIMEOUT_S` | Turn the LLM note on or off and set its timeouts |
| `VOICE_SLUG` | Which pre-rendered voice set under `agent/assets/voice/` to use |
| `TTS_PRIMARY`, `TTS_PACE`, `SARVAM_SPEAKER`, `GOOGLE_TTS_VOICE` | Runtime voice choice, matched to the clips |
| `PC_VOICE_CACHE` | Disk cache for synthesised audio |
| `POSE_BACKEND` | `mediapipe` or `yolo` |
| `POSE_FPS`, `POSE_OUT_W`, `POSE_OUT_H` | Analysis frame rate and annotated tile size |
| `MAX_SESSIONS` | Limit on concurrent calls per worker |
| `PATIENT_JOIN_TIMEOUT_S` | How long the coach waits for the patient |
| `BARGEIN_MIN_RMS` | Physio voice level that silences the coach |
| `LIVE_COACH` | Empty: on when `OPENAI_API_KEY` is set. `off`/`false`/`0`/`no`: off (kill switch) |
| `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE` | Realtime model (default `gpt-realtime-2`) and voice (default `marin`) |
| `LIVE_COACH_VIDEO` | Send occasional still images of the annotated video to the coach (compose default `on`) |
| `LIVE_COACH_SET_LISTEN` | Listen to the patient during the countdown and set (voice stop and symptoms), default `on` |
| `LIVE_COACH_BARGE_IN` | Let the patient interrupt the coach, default `off` (half-duplex) |
| `LIVE_COACH_PARTIALS`, `LIVE_COACH_TRANSCRIBE_LANG`, `LIVE_COACH_VAD_EAGERNESS` | Partial captions (default `off`), transcription language (`auto` to detect), turn-detection eagerness (default `medium`) |
| `PC_SHARED_DIR` | Location of `shared/` (`/app/shared` in Docker) |
| `WORKER_HOST` | Host label recorded in `agent_pid` |

### 2. Install, migrate and seed

```bash
npm i
npm run db:migrate              # apply drizzle/ migrations to Neon
npm run db:seed                 # exercise catalogue from shared/exercises.json
# sign up as a physio in the app first (ALLOW_SIGNUP=true), then:
npm run db:seed -- --demo       # "Demo Patient" + knee_bend prescription + 5 past sessions
```

### 3. Run

```bash
docker compose up --build redis agent-worker    # worker on http://localhost:8080 (healthz: /healthz)
docker compose exec agent-worker python -m physiocoach.devtools.check_openai     # optional: key + note model
docker compose exec agent-worker python -m physiocoach.devtools.check_realtime   # optional: Live Coach session
npm run dev                                     # web on http://localhost:3000
```

Locally, test the patient side in a second browser window on the same laptop (cameras work on `localhost`).
For a phone, use the deployed site: browsers only allow the camera over HTTPS, which Dokploy provides at
https://physio.algon.tech (see [docs/DEPLOY_DOKPLOY.md](docs/DEPLOY_DOKPLOY.md)). The Stream webhook URL is
`https://physio.algon.tech/api/webhook`.

Optional: `npm run stream:call-type` previews the `physio_session` call type without changing anything (a dry run). Adding `-- --apply` creates it.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Vitest web tests (`tests/**/*.test.ts`) |
| `npm run db:migrate` | Apply Drizzle migrations |
| `npm run db:generate` / `db:push` / `db:studio` | Drizzle schema tooling |
| `npm run db:seed [-- --demo]` | Seed exercises, plus the demo patient and history if `--demo` is passed |
| `npm run stream:call-type [-- --apply]` | Check, or create, the `physio_session` Stream call type |
| `npm run dev:create-call` | Create a dev call and write `dev-session.json` for the worker scripts |

## Testing

```bash
npm test                                                     # vitest: webhook, agent events, security, fixtures, weekly rules
npm run typecheck

# Python core (native, also works on Windows)
cd agent && uv sync && uv run pytest tests/core tests/contracts tests/replay

# Full worker suite (pose, call smoke, replay golden) in Docker
docker compose --profile test build agent-worker-test
docker compose --profile test run --rm agent-worker-test
```

Offline replay with no call and no internet:
`cd agent && uv run python -m physiocoach.replay.cli --synthetic demo_shallow --exercise knee_bend --target 60 --reps 10`.
See [agent/README.md](agent/README.md) for the live-call flow scripts and dev tools.

## Deploy (Dokploy)

Production runs as one Dokploy **Docker Compose** application built from [docker-compose.prod.yml](docker-compose.prod.yml),
served at **https://physio.algon.tech**. Full step-by-step guide: [docs/DEPLOY_DOKPLOY.md](docs/DEPLOY_DOKPLOY.md).

| Service | Exposure | Notes |
|---|---|---|
| `migrate` | Internal, one-shot | `Dockerfile` target `migrator`: `drizzle-kit migrate && npm run db:seed`. `web` starts only after it succeeds. |
| `web` | Public HTTPS (Traefik) | `Dockerfile` target `runtime`: Next.js standalone on `node:22-slim`, health check `GET /api/health`. Only `NEXT_PUBLIC_*` values are build args; it builds with no runtime secrets. |
| `agent-worker` | **Internal only** | `agent/Dockerfile` (repo root as context). Model weights are baked in, and the offline Malayalam voice is rendered into `/opt/voice` during the build. Budget about 1.5 GB RAM and 2 vCPU per concurrent session. |
| `redis` | Internal | `redis:7-alpine` with AOF |
| Postgres | External | Neon |

The compose file wires `AGENT_WORKER_URL=http://agent-worker:8080` and `WEB_INTERNAL_URL=http://web:3000` itself.
Point the Stream webhook at `https://physio.algon.tech/api/webhook`, and configure the access logs to drop or redact `/join/` paths (they contain join tokens).

## Status and known limitations

- **Malayalam text is a draft.** Every string in `shared/phrases.json` is marked `"review": "pending"` until a native speaker reviews it. Only the robotic `dev-espeak-ml` voice is in the repo, which is fine for pipeline tests but not for a demo. Render the production voice set before demoing.
- **The `physio_session` call type is created** (no recording or transcription; `user` has only `read-call`; event and reaction capabilities copied from `default`). Re-run `npm run stream:call-type -- --apply` once to strip the default `guest` grants, then switch `STREAM_CALL_TYPE=physio_session` after the custom-event smoke test passes.
- **Frame-rate dips** on the server have been seen to cost a rep now and then, and are still being investigated. The rep engine discards a rep that is in progress during a long tracking dropout.
- **No full browser end-to-end test yet.** It needs a physio sign-up, the dev server and the worker running together.
- **Demo replay clip not recorded yet:** `agent/replay/clips/knee_demo.mp4` (the replay fallback) still has to be recorded.
- Clip audio is always Malayalam (v1); English is shown as captions. Patient speech input exists only through the optional Live Coach, which may speak English to an `en` patient (DEV-16 exception).
- **Live Coach limits:** Malayalam recognition and speech quality depend on the realtime model and need a rehearsal; there is no reconnect within a call; a voice stop is recorded as a Stop press.

Demo script: [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md).
