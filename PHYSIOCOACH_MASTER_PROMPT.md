# PhysioCoach: Migration Master Prompt

> **Audience:** an autonomous coding agent (Claude Code, Codex or similar) that opens this repository and carries out the migration milestone by milestone.
> **Written:** 2026-10-10. **Repo:** `C:/Users/black/OneDrive/Desktop/Codex_hackathon/Psysio_Agent`. It is **not** a git repo yet, and `node_modules` is **not** installed.
> **This document is self-contained.** You have not seen the conversation that produced it. Everything you need is here or in the repo. If this document and the repo disagree about the *current* code, the repo wins. If they disagree about the *target*, this document wins, unless the user tells you otherwise.

## How to use this prompt
- **Start at §0, then §1.4 and §16.** They tell you how to read the tags, what you must never violate, and how to work.
- **Then execute §11 milestone by milestone.** Each milestone lists its tasks, the spec sections it needs, its acceptance criteria and a **STOP AND REPORT** checkpoint. Do not skip a checkpoint and do not start the next milestone until the user approves.
- **Anything tagged [U] is a spike, not a fact.** Prove it in the named milestone task before you build on it.
- **Anything labelled DECISION (user may veto)** (the DEV-n rows in §3.4) is a deliberate departure from the user's spec. Show the table at Checkpoint 0 and follow the "If vetoed" column for any the user rejects.
- **Use the TOC below** to jump to the contract you need. Contracts (§6, §7.7, §8.4–§8.9) are exact; implement them literally.

## Table of contents
- §0 How to read and use this document (reading order, tags, prototype file)
- §1 Role, mission, product context, demo, non-negotiables
- §2 Current state of the repository (files, patterns, known bugs)
- §3 Target architecture (decisions, diagram, services, DEV-1…DEV-16)
- §4 Reuse map, file by file (config, app, shared code, patients, prescriptions, sessions, call, dashboard, dependencies)
- §5 Target repo layout
- §6 Data model (Drizzle schema, Better Auth fields, exercise seed, migration steps)
- §7 API surface and contracts (tRPC, join link, Stream, start sequence, webhook, callbacks, shared contracts, redundant input, worker control API)
- §8 Agent worker specification (layering, pose, angles, rep engine, scoring, coaching rules, phrases, LLM note, voice, pose processor, inputs, barge-in, process model, flow, outbox, replay)
- §9 Malayalam phrase catalogue and voice plan
- §10 Frontend specification (dashboard, patient join page, call layout)
- §11 Milestones 0–7 with checkpoints (0, 1, A, B, 4, pre-delete, call-type, 5, 6, 7)
- §12 Testing strategy (pytest, vitest, voice contract, rehearsal checklist)
- §13 Environment, deployment, local development
- §14 Demo runbook
- §15 Risks and open questions register
- §16 Working rules and conventions
- Appendix A: Verified API cheat sheet

---

## 0. How to read and use this document

### 0.1 Reading order
1. Read §1 (mission and non-negotiables) and §16 (working rules) in full before you touch anything.
2. Read §2 (current state) and skim `APP_OVERVIEW.md` in the repo root. It describes the current Meet.AI app in detail.
3. Read §3 (target architecture) and the **DECISION** list in §3.4.
4. Work through §11 (milestones) in order. Each milestone points to the spec sections it needs (§4–§10, §12–§13).

### 0.2 Tags used throughout
| Tag | Meaning |
|---|---|
| **[V]** | **Verified.** Someone read the upstream source or docs on or before 2026-10-10 (Vision-Agents `main@902db86`, PyPI `vision-agents==0.6.9`, stream-py `v4.3.0`, `@stream-io/node-sdk@0.4.26`, `@stream-io/video-client@1.61.2`, `@stream-io/video-react-sdk@1.43.4`, the Sarvam/Google/Azure/ElevenLabs docs). You may build on it, but still pin versions. **Caveat for the web SDKs:** the repo's `package-lock.json` installs `@stream-io/node-sdk` **0.4.24**, `@stream-io/video-react-sdk` **1.18.0**, `@stream-io/video-client` **1.23.2** and `@stream-io/video-react-bindings` **1.6.5**, not the versions the [V] tags were checked against. A Stream web [V] claim holds for the installed code only after Milestone 0 task 4 pins node-sdk to 0.4.26 and checks the React hooks in the installed `.d.ts` files. |
| **[U]** | **Unverified or inferred.** Do **not** build on it until a spike task proves it. Every [U] item that matters is a named spike task in §11. |
| **DECISION (user may veto)** | A deliberate departure from the user's original spec, or a choice the spec left open. Implement it as written unless the user vetoes it. If they veto, use the "If vetoed" column. |
| **STOP AND REPORT** | A checkpoint. Stop, summarise what you did and what you found, and wait for the user's go-ahead before you continue. |

### 0.3 The prototype file
The user's spec refers to a single-file browser prototype, `physiocoach.html`, whose logic (angle math, EMA, side selection, rep state machine, score, rule-based Malayalam/English strings, simulator) was meant to be ported. **The file is not anywhere in the workspace.**
- At the start of Milestone 1, **ask the user once** for `physiocoach.html`.
- If they provide it, port its logic into `agent/physiocoach/core/` and add golden tests that compare your Python output with the prototype's output on the same synthetic signals. Where the prototype and §8 of this document differ, **STOP AND REPORT** the differences and let the user choose.
- If it is unavailable, implement directly from the formulas in §8. They are complete and are written from the spec. Do not wait.
- **Port ONLY:** angle math, EMA, side selection, rep state machine, score, rule-based Malayalam + English strings, and the simulator (which becomes `replay/synthetic.py`). **Do NOT carry over:** the camera HUD, the Web Speech API (`speechSynthesis`/recognition), `localStorage`, or the phone-first layout. The annotated tile (§8.11), `CachedMalayalamTTS` (§8.10), the database (§6) and the responsive, desktop-first UI (§10) replace them.

---

## 1. Role, mission, product context and non-negotiables

### 1.1 Your role
You are the lead engineer migrating the existing **Meet.AI** app (Next.js 15 + tRPC + Drizzle/Neon + Better Auth + Stream Video) into **PhysioCoach**, **reusing as much of the current code as possible**. You also build a new Python agent worker on Stream's open-source **Vision Agents** framework. You work in small, verifiable steps, run tests and type checks, keep the TypeScript and Python contracts in sync, and stop at every checkpoint.

### 1.2 What PhysioCoach is
An AI physiotherapy agent that joins a live **Stream Video** call and guides a patient through their prescribed exercise in real time.
- The patient opens a signed link in our web app on a laptop, tablet or phone. It is a normal responsive web app, desktop first, **not** a native app and **not** phone-first.
- The agent is already in the call as a participant. It watches the patient's video, counts reps, checks range of motion (ROM), and coaches **out loud in Malayalam**.
- It publishes an **annotated video tile** (skeleton, rep counter, angle gauge, target line) that the patient and the physio both see.
- Every set is logged for the physiotherapist, who can join the same call at any time and sees progress, adherence and pain flags in a dashboard.

**Positioning:** a real clinical-support product. Kerala has an ageing population and too few physiotherapists, so exercise between visits goes unsupervised. PhysioCoach gives patients live, supervised practice and gives physios data. **It supports prescribed exercise. It never diagnoses and never changes the prescription.**

### 1.3 The 3-minute hackathon demo (everything you build serves this)
1. Physio dashboard: show the prescription (knee bend, target 60°, 10 reps, at least 2 s per rep) and click **"Start guided session"**. A Stream call is created and the agent joins.
2. The presenter opens the patient link on a second device and does knee bends in front of the camera.
3. The agent speaks Malayalam in the call. It counts reps, then says the equivalent of "good effort, but you only bend to 48 degrees, try 3 more reps slowly".
4. The agent publishes an annotated video tile (skeleton, rep counter, angle gauge) that the patient and the physio both see.
5. The dashboard updates live: ROM trend, adherence, pain flag, weekly summary.
6. Fallback if the network misbehaves: **replay mode** feeds a recorded video through the same pipeline and plays the voice locally.

### 1.4 Non-negotiables (violating any of these is a bug, whatever else you were asked)
1. **No diagnosis, no prescription changes, no medical advice beyond the prescribed exercise.** This applies to every spoken string, every LLM output and every UI string. The LLM post-set note is validated against a deny-list (§8.9), and the rule-based fallback is used on any violation.
2. **No video or audio is recorded or stored.** Store only derived numbers. Recording, transcription, closed captions and individual/raw/frame recording are **disabled** on the Stream call type and in each call's `settings_override`. No transcripts are stored. Do not add any opt-in video feature unless the user explicitly asks for one later.
3. **Secrets stay server-side.** The Stream secret, Anthropic key, TTS keys, `JOIN_LINK_SECRET`, `AGENT_CONTROL_SECRET` and `AGENT_CALLBACK_SECRET` never reach the browser and are never committed. Only `NEXT_PUBLIC_*` variables may be read by client code.
4. **Rules must always work with no LLM.** Live counting, live cues, the post-set note and the weekly summary each have a deterministic rule-based path that runs with no network to Anthropic. The LLM is an optional enhancement with a timeout and a fallback.
5. **Live Malayalam cues are templated, never LLM-generated.** Counts and short corrections come from a fixed phrase catalogue with pre-rendered audio.
6. **The LLM never decides rep counts, angles or safety.** Rep counting, ROM and safety stops are pure deterministic code (`RepEngine`, `flow.py`). Realtime speech-to-speech models (OpenAI Realtime, Gemini Live) are **not** used in v1 and must never speak live counts.
7. **No analysis before consent.** The pose model does not run on the patient's frames until the patient presses "I agree" (`pc.consent`).
8. **Safety stops win.** Pain ≥ 7, the Stop button, or a reported symptom (dizziness, chest pain, sharp pain) ends the set immediately, says the safety phrase and alerts the physio. Nothing may block or delay this path: the Stop and symptom buttons are enabled as soon as the call UI renders, and the halt, the `pc.safety_alert` event and the `safety_alert` callback happen at once even while the physio is speaking. The only thing that may wait is the spoken `safety.stop` audio, which plays when the barge-in gate releases (§8.10), because the physio is already talking to the patient.
9. **Barge-in:** when the physio speaks, the agent stops talking immediately and stays quiet until they finish.
10. **Never end the call for everyone because one participant left or a page unmounted.** Only the physio's explicit "End session" (or the server's lifecycle logic) ends a call.

---

## 2. Current state of the repository

### 2.1 What exists today (Meet.AI)
`package.json` name `meetai`. Next.js `15.3.2`, React 19, TypeScript, Tailwind v4, shadcn/ui (new-york), tRPC v11 + TanStack Query v5, Drizzle ORM `^0.43.1` on Neon (`drizzle-orm/neon-http`), Better Auth `^1.2.8` (email/password), `@stream-io/node-sdk ^0.4.24`, `@stream-io/video-react-sdk ^1.18.0`, Stream Chat, OpenAI Realtime through `@stream-io/openai-realtime-api` (connected inside the webhook), Inngest (GPT-4o summariser through `@inngest/agent-kit`), nuqs, DiceBear avatars, recharts (via shadcn `chart.tsx`).

Scripts: `dev`, `build`, `start`, `lint`, `db:push`, `db:studio`, `dev:webhook` (`ngrok http --url=[NGROK_STATIC_DOMAIN] 3000`).

**Key files (real paths):**
```
src/app/layout.tsx                         Inter font; NuqsAdapter + TRPCReactProvider wrap <html> (wrong); metadata "Create Next App"
src/app/(auth)/{layout,sign-in/page,sign-up/page}.tsx
src/app/(dashboard)/layout.tsx             SidebarProvider + DashboardSidebar + DashboardNavbar; NO session check
src/app/(dashboard)/agents/page.tsx        auth check + prefetch trpc.agents.getMany + HydrationBoundary/Suspense/ErrorBoundary
src/app/(dashboard)/agents/[agentId]/page.tsx   (no session check)
src/app/(dashboard)/meetings/page.tsx, meetings/[meetingId]/page.tsx
src/app/call/layout.tsx, call/[meetingId]/page.tsx
src/app/api/auth/[...all]/route.ts         Better Auth
src/app/api/trpc/[trpc]/route.ts           tRPC
src/app/api/webhook/route.ts               Stream webhook: OpenAI Realtime connect, call.end() on any leave, transcripts, recordings, chat GPT-4o replies
src/app/api/inngest/route.ts               serves meetingsProcessing
src/components/{command-select,data-pagination,data-table,empty-state,error-state,generated-avatar,loading-state,responsive-dialog}.tsx
src/components/ui/*                        ~45 shadcn primitives incl. chart.tsx, progress.tsx, tabs.tsx, switch.tsx, select.tsx, slider.tsx
src/constants.ts                           DEFAULT_PAGE=1, DEFAULT_PAGE_SIZE=10, MAX_PAGE_SIZE=100, MIN_PAGE_SIZE=1
src/db/index.ts, src/db/schema.ts          Better Auth tables + agents + meetings + meeting_status enum
src/hooks/{use-confirm.tsx,use-mobile.ts}
src/inngest/{client.ts (id "meet-ai-2"), functions.ts (summarizer, meetingsProcessing)}
src/lib/auth.ts                            betterAuth({ emailAndPassword, database: drizzleAdapter(db,{provider:"pg",schema}) })
src/lib/auth-client.ts                     createAuthClient()
src/lib/avatar.tsx                         generateAvatarUri({seed, variant: "botttsNeutral"|"initials"})
src/lib/stream-video.ts                    new StreamClient(NEXT_PUBLIC_STREAM_VIDEO_API_KEY, STREAM_VIDEO_SECRET_KEY)
src/lib/stream-chat.ts                     Stream Chat server client
src/lib/utils.ts                           cn, formatDuration
src/modules/agents/{hooks/use-agents-filters.ts, params.ts, schemas.ts, types.ts, server/procedures.ts,
                    ui/components/{agent-form, agent-id-view-header, agents-list-header, agents-search-filter, columns,
                                   data-pagination (duplicate), new-agent-dialog, update-agent-dialog}.tsx,
                    ui/views/{agent-id-view, agents-view}.tsx}
src/modules/meetings/{hooks/use-meetings-filters.ts, params.ts, schemas.ts, types.ts (MeetingStatus enum, StreamTranscriptItem),
                      server/procedures.ts (generateChatToken, getTranscript, generateToken, remove, update, create, getOne, getMany),
                      ui/components/{active-state, agent-id-filter, cancelled-state, chat-provider, chat-ui, columns, completed-state,
                                     meeting-form, meeting-id-view-header, meetings-list-header, meetings-search-filter,
                                     new-meeting-dialog, processing-state, status-filter, transcript, upcoming-state, update-meeting-dialog}.tsx,
                      ui/views/{meeting-id-view, meetings-view}.tsx}
src/modules/call/ui/components/{call-active (SpeakerLayout + CallControls), call-connect, call-ended, call-lobby, call-provider, call-ui}.tsx
src/modules/call/ui/views/call-view.tsx
src/modules/dashboard/ui/components/{dashboard-command, dashboard-navbar, dashboard-sidebar, dashboard-user-button}.tsx
src/modules/home/ui/views/home-view.tsx    placeholder, unused
src/modules/auth/ui/views/{sign-in-view, sign-up-view}.tsx
src/trpc/{init.ts, client.tsx, server.tsx, query-client.ts, routers/_app.ts}
public/{logo,empty,upcoming,processing,cancelled}.svg + create-next-app leftovers {file,globe,next,vercel,window}.svg
next.config.ts                             redirect "/" -> "/meetings"
drizzle.config.ts                          out: "./drizzle"
.env.example                               CONTAINS REAL-LOOKING CREDENTIALS (see Milestone 0)
```

**Established patterns you must keep:**
- Feature modules: `src/modules/<feature>/{server/procedures.ts, schemas.ts, params.ts, types.ts, hooks/, ui/components/, ui/views/}`.
- Each `page.tsx` prefetches with `getQueryClient()` + `trpc.<router>.<proc>.queryOptions(...)` from `@/trpc/server`, then renders `HydrationBoundary` → `Suspense` (fallback `<XViewLoading/>`) → `ErrorBoundary` (fallback `<XViewError/>`) → `<XView/>` that calls `useSuspenseQuery`.
- Types come from `inferRouterOutputs<AppRouter>` in `types.ts`.
- Lists return `{ items, total, totalPages }` with `page`/`pageSize`/`search` inputs and nuqs URL filters (`params.ts` + `hooks/use-*-filters.ts`).
- Dialogs use `ResponsiveDialog` (a drawer on mobile). Confirms use `useConfirm`. Pickers use `CommandSelect`. Tables use `DataTable` + `DataPagination`. States use `EmptyState`/`ErrorState`/`LoadingState`.
- IDs are `nanoid()`. The meeting id doubles as the Stream call id.

### 2.2 Known bugs and security holes (fix all of these in Milestone 0 or as you touch the file)
From `APP_OVERVIEW.md` §11 plus a code read. These are all real; the code was read.
1. `.env.example` contains what look like real credentials: a Neon connection string with password, the Stream secret, an OpenAI key, `BETTER_AUTH_SECRET="gigachadproject"`. **The user must rotate them.** You replace them with placeholders.
2. `src/app/api/webhook/route.ts` checks the signature but never checks that `x-api-key` equals `NEXT_PUBLIC_STREAM_VIDEO_API_KEY`.
3. `meetings.generateToken` upserts every user into Stream with `role: "admin"`, and `generateChatToken` does the same for Chat.
4. `generateToken` passes `validity_in_seconds: issuedAt` (a Unix timestamp) where a duration is expected. With `exp` also set, the token lasts 1 h by accident, and the timestamp is carried as a junk JWT claim (node-sdk 0.4.26 does not strip it) [V].
5. Webhook `call.session_participant_left` calls `call.end()` whenever **any** participant leaves. With patient + physio + agent this kills the session when anyone drops.
6. `call-connect.tsx` unmount cleanup calls `_call.leave(); _call.endCall();`, so a patient refreshing the page ends the call for everyone. `call-ui.tsx` `handleLeave` also calls `call.endCall()`.
7. The Realtime agent runs inside a serverless webhook request (fragile). It is replaced by the Python worker.
8. `cancelled` is never set. `processing` can hang forever. `recordingUrl!` crashes when there is no recording.
9. `createTRPCContext` returns a fake `{ userId: 'user_123' }`.
10. Root metadata says "Create Next App". Providers wrap `<html>` instead of living inside `<body>`.
11. Duplicate `src/modules/agents/ui/components/data-pagination.tsx` (byte-identical to `src/components/data-pagination.tsx`).
12. Typo "a fews econds" in the agent loading text, and the same typo in other views.
13. `(dashboard)/agents/[agentId]/page.tsx` has no session check.
14. `meetings.create`/`update` accept any `agentId` without checking ownership.
15. The sign-up submit button says "Sign in".
16. The sidebar active state uses an exact path match, so detail pages are not highlighted.
17. `DashboardCommand` renders a `CommandEmpty` per group, so both empty messages show.
18. The `meeting-id-view` remove mutation has no `onError` toast.
19. The meetings `getMany` count query does an unnecessary `innerJoin(agents)`.
20. `globals.css` uses `--font-sans: var(--font-geist-sans)`, which is never defined.
21. Avatar generation is duplicated between `components/generated-avatar.tsx` and `lib/avatar.tsx`.
22. The Stream CSS is imported in both `call-connect.tsx` and `call-lobby.tsx`.
23. The webhook reads the meeting id inconsistently (`event.call.custom.meetingId` in some branches, `call_cid` in others) and returns 400/404 for unknown meetings, which triggers Stream retries.
24. No tests, no git.

---

## 3. Target architecture

### 3.1 Decision summary
- **Next.js stays at the repo root as the only product backend and the only database writer.** It keeps Better Auth (physio login and roles), tRPC + Drizzle/Neon (patients, prescriptions, sessions, results, analytics, notes), the Stream node SDK (creating calls, issuing tokens), the Stream webhook, the physio dashboard and the public patient join page.
- **A new Python uv project at `./agent` is the long-lived `agent-worker` service.** It contains:
  - a small **FastAPI control plane** (the supervisor) that starts **one OS process per call** and records it as `agent_pid`;
  - **Redis** for agent lifecycle state, heartbeats, the backup input inbox and the callback outbox;
  - the **Vision Agents** agent itself: pose processor, rep engine, coach, Malayalam voice and call-flow state machine.
- **The agent never touches Postgres.** It reports consent, set results, pain and safety events to Next.js over an HMAC-signed `POST /api/agent/events`.
- **Removed:** Stream Chat (from the app), OpenAI Realtime and GPT-4o, transcription, recording, "Ask AI", Inngest and `@inngest/agent-kit`.

### 3.2 Diagram
```
                         ┌──────────────────────────── Browser ────────────────────────────┐
                         │ Physio dashboard (Next.js, Better Auth session)                  │
                         │   tRPC + TanStack Query (poll 2 s while live)                    │
                         │   /call/[sessionId]  Stream Video React SDK (viewer="physio")    │
                         │ Patient join page /join/[token]  (no login, signed link)         │
                         │   Stream Video React SDK (viewer="patient"): agent tile, own PiP,│
                         │   captions, I agree, Stop, pain 0-10, symptom buttons            │
                         └───────┬───────────────────────────────┬───────────────────────────┘
                     tRPC/HTTPS  │                               │ WebRTC + coordinator WS
                                 ▼                               ▼
┌────────────────────────── web (Next.js, public) ───────────┐   ┌────────── Stream cloud ──────────┐
│ Better Auth · tRPC routers · Drizzle (SOLE DB WRITER)       │   │ Video edge/SFU, call type        │
│ lib/stream-video.ts: createGuidedCall, tokens               │──►│ "physio_session" (no recording,  │
│ /api/webhook  (Stream lifecycle, custom-event backstop)     │◄──│ no transcription), custom events │
│ /api/agent/events (HMAC, worker → web)                      │   └──────────────▲───────────────────┘
│ lib/agent-worker.ts → POST/DELETE worker /sessions (HMAC)   │                  │ joins as participant
└──────┬──────────────────────────────▲────────────────────────┘                  │ "physiocoach-agent"
       │ Drizzle (neon-http)          │ HMAC callbacks                            │
       ▼                              │                                           │
┌──────────────┐   ┌──────────────────┴──────────── agent-worker (internal) ──────┴───────────────┐
│ Neon Postgres│   │ FastAPI supervisor (control/api.py) ── Redis (pc:agent:*, pc:hb:*,           │
│ (system of   │   │   POST /sessions → spawn `python -m physiocoach.agent_main --session-id ..`  │
│  record)     │   │   pc:input:*, pc:outbox:*)                                                   │
└──────────────┘   │ ┌────────────── one agent process per call (Vision Agents 0.6.9) ──────────┐ │
                   │ │ Agent(edge=getstream.Edge(), llm=NoLLM(), tts=CachedMalayalamTTS,        │ │
                   │ │       processors=[PoseProcessor])                                        │ │
                   │ │ PoseProcessor (VideoPublisher only; subscribes to the PATIENT track)     │ │
                   │ │   frames → PoseBackend (MediaPipe | YOLO) → named joints → angle (px)    │ │
                   │ │   → EMA → RepEngine (pure) → events + set metrics                        │ │
                   │ │   → annotated frame → QueuedVideoTrack (skeleton, counter, gauge)        │ │
                   │ │ Flow FSM (consent → positioning → countdown → set → summary → pain)      │ │
                   │ │ Coach: templated cues + rule note ∥ Claude claude-sonnet-5-5 note        │ │
                   │ │ Voice: pre-rendered ml clips → disk cache → Sarvam bulbul:v3 → Google    │ │
                   │ │ Inputs: custom events (private _connection hook) + Redis backup inbox    │ │
                   │ │ Barge-in: Silero VAD on physio PCM → tts.interrupt + track.flush         │ │
                   │ │ Outbox: HMAC POST /api/agent/events, Redis retry                         │ │
                   │ └───────────────────────────────────────────────────────────────────────────┘ │
                   └───────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Services (Dokploy)
| Service | Image | Exposure | Responsibilities |
|---|---|---|---|
| `web` | root `Dockerfile`, `node:22-slim`, Next `output: "standalone"`; `drizzle-kit migrate` + `npm run db:seed` as a pre-deploy step | public HTTPS (Traefik) | UI, Better Auth, tRPC, Drizzle (sole writer), Stream node SDK, `/api/webhook`, `/api/agent/events` |
| `agent-worker` | `agent/Dockerfile`, build context = repo root (so `shared/` is copied), `python:3.13-slim` + `libgl1 libglib2.0-0` + uv; model weights and voice assets baked in | **internal only**; outbound to Stream SFU, Sarvam, Google, Anthropic | FastAPI supervisor + one child agent process per call |
| `redis` | `redis:7-alpine`, AOF on | internal | worker-only state |
| Postgres | Neon (existing) | external | system of record |

### 3.4 Deviations from the user's spec: DECISION (user may veto)
Implement these as written unless the user vetoes. At the end of Milestone 0, show this table to the user and ask for vetoes (this is part of the Milestone 0 checkpoint).

| # | Spec says | This design does | Rationale | If vetoed |
|---|---|---|---|---|
| **DEV-1** | "Backend (FastAPI): auth and roles, prescriptions, creates Stream calls and issues tokens, starts/stops agent processes, receives set results" | **Next.js** (tRPC, Better Auth, Drizzle) does auth, roles, prescriptions, Stream calls, tokens and receiving set results. **FastAPI is limited to the agent control plane** inside `agent-worker`: `POST /sessions`, `DELETE /sessions/{id}`, `GET /sessions/{id}`, `POST /sessions/{id}/input`, `GET /healthz`. | All of that already works in the repo. A FastAPI backend would duplicate auth, lose end-to-end tRPC types and create a second schema owner. Secrets stay server-side, the worker is long-lived, and FastAPI still exists. | Split-hybrid: FastAPI takes `call_sessions`/`set_results` writes and token issuing; Drizzle stays the schema owner; tRPC procedures proxy to FastAPI. |
| **DEV-2** | "Redis for session and agent lifecycle state" | Redis is used **only inside agent-worker** (lifecycle, heartbeat, input inbox, callback outbox). Next.js does not use Redis in v1. | Fewer credentials and moving parts in `web`. | Add ioredis to `web` for SSE (see DEV-4). |
| **DEV-3** | "Postgres" (on Dokploy) | **Keep Neon** with the existing `drizzle-orm/neon-http` driver. | No driver or code change. | Self-host Postgres on Dokploy and switch Drizzle to `postgres-js`. |
| **DEV-4** | "Dashboard updates live" | **In the call:** Stream custom events (`pc.*`, under 1 s). **Dashboard pages:** TanStack Query `refetchInterval` of 2000 ms while a session is `scheduled` or `live`. No SSE in v1. | Reuses existing query patterns, no new infrastructure; 2 s lag is fine for the demo. | Build SSE: Next.js `/api/live` + ioredis pub/sub. |
| **DEV-5** | Weekly summary (mechanism unspecified) | Computed **live in SQL on read**, with rule-based `{en, ml}` text in TypeScript. A "Generate AI summary" button calls `claude-sonnet-5-5` from a Next.js server mutation (rule fallback) and upserts `weekly_summaries`. **Inngest is removed** along with any cron. | The demo needs no scheduler, and all current Inngest code is meeting-specific. | Re-add an Inngest cron, or APScheduler in the worker. |
| **DEV-6** | Data model as listed | **Additive extensions:** `user.role`/`phone`/`preferredLanguage` (Better Auth `additionalFields`); `prescriptions.sessionsPerWeek` (adherence denominator); `exercises.cameraView`; `call_sessions.physioId/streamCallType/mode/startedAt/endedAt/failureReason/joinTokenHash/joinTokenExpiresAt`; `set_results.setIndex/targetAngle snapshot/side/stopReason/eventId/createdAt`; new tables `safety_events` and `weekly_summaries`; `agent_pid` stored as text `"host:pid"`. Also: `set_results.per_rep` items add `tooFast` (additive to the spec's `{peak, seconds}`), and `prescriptions.create` rejects `targetAngle < exercise.minPeak`, because reps below `minPeak` are never counted, so such a target could never be reached. | Needed for scoping, idempotency, adherence, safety audit and replay filtering. | Drop the individual columns the user rejects. Drop `tooFast` (recompute it from `seconds < minSecondsPerRep`), and allow any 10–180 target with a UI warning. |
| **DEV-7** | `User` with phone or email; patient joins by signed link | Patients are `user` rows with `role=patient` and **no `account` row** (they cannot log in). Phone-only patients get the placeholder email `p_<id>@patients.physiocoach.invalid`, because Better Auth requires a unique, non-null email. | Keeps Better Auth unchanged. | Make `email` nullable, which means patching the Better Auth schema. |
| **DEV-8** | "Reuse physiocoach.html logic" | The file is not in the workspace. Ask once (§0.3); otherwise implement from §8's formulas. | Nothing to reuse yet. | User provides the file; port it with golden tests. |
| **DEV-9** | One live depth cue, "കുറച്ചുകൂടി മടക്കൂ" (bend a little more) | Per mode: `cue.bend_more` (flex: knee, elbow) and `cue.raise_more`, "കുറച്ചുകൂടി ഉയർത്തൂ" (direct: shoulder_raise). The post-set note likewise uses "bent" vs "raised". | "Bend" is the wrong verb for a shoulder raise. | One cue for all exercises. |
| **DEV-10** | Patient UI: Stop and pain 0–10 | Adds **symptom buttons** (dizziness, chest pain, sharp pain) as the safety input, plus a consent button "ഞാൻ സമ്മതിക്കുന്നു / I agree". | The spec lists these symptoms as stop triggers, but Malayalam STT is unverified, so buttons are the reliable channel. | Remove the symptom buttons; safety relies on Stop and pain only. |
| **DEV-11** | The prescription has reps but no number of sets | Add `prescriptions.sets` (int, default 1, range 1–5). The agent runs up to `sets` sets per session with a 30 s rest between them; `setIndex` is 1-based. Prescription `reps` is limited to **1–30** (to match pre-rendered count clips). | The spoken note suggests "3 more reps", and the data model already has a per-session set list. | One set per session; drop the column. |
| **DEV-12** | Session store: `CallSession.agent_pid` | Kept as `agentPid` text `"host:pid"`. The worker uses a **subprocess per call** (not `Runner.serve()`), so a pid exists. | Matches the spec; a native-code crash takes down only one call. | `Runner.serve()` behind the same control API; store the Vision Agents `session_id` instead. |
| **DEV-13** | YOLO backend "via Vision Agents' built-in `YOLOPoseProcessor`"; `PoseProcessor` is a `VideoProcessorPublisher` (architecture diagram, Milestone 2) | `PoseProcessor` is a **`VideoPublisher` only** that subscribes to the patient's track itself (`TrackAddedEvent` + `edge.add_track_subscriber`), and the YOLO backend calls `ultralytics.YOLO` directly. | [V] The Agent routes only one source track (the first-added among equal priority) to all `VideoProcessor`s, so a physio who joins first with a camera starves the patient feed. [V] `YOLOPoseProcessor` discards keypoints, handles only person 0, has no participant filter and mislabels the wrists. Whether a publisher-only processor still receives video through `add_track_subscriber` is **[U]**: Spike A task 3a, with a fallback in §8.11. | Use `VideoProcessorPublisher` and require the patient to join before the physio (or the physio to join with camera off); fork `YOLOPoseProcessor` to expose keypoints. |
| **DEV-14** | Replay "through the same pipeline" (demo step 6) | Replay sessions (`mode = "replay"`) are **excluded** from `romTrend`, `adherence` and `weeklySummary` by default. The procedures take `includeReplay?: boolean`; the dashboard passes `true` when `NEXT_PUBLIC_DEMO_MODE=true` and draws replay points with a distinct marker and a "demo" badge. `db:seed --demo` also inserts 4–6 past sessions with `set_results` for a clearly labelled "Demo Patient", so the ROM trend shows a trend during the demo. | Real clinical data must not be polluted by recorded clips, but the demo must still show the dashboard updating if the presenter falls back to in-call replay. | Always include replay sessions (with the badge), or always exclude them. |
| **DEV-15** | `CallSession.scheduled_at` and status `scheduled` (implies booking sessions ahead) | v1 sessions start **immediately** on click. `scheduledAt` = creation time; `scheduled` means "waiting for the agent or the patient". | Future scheduling needs a scheduler, and Inngest is removed (DEV-5). | Add optional `scheduledAt` to `sessionsStartSchema`; create the call and link at creation, and start the agent from a scheduler (Inngest `step.sleepUntil` or APScheduler in the worker) 2 min before `scheduledAt`. |
| **DEV-16** | `User.preferred_language` (ml\|en); realtime models allowed for an "English fallback" | v1 **audio is always Malayalam** whatever `preferredLanguage` says. Patients with `preferredLanguage = "en"` additionally see English captions. The agent receives `patient.lang` and logs it; a flow test asserts the audio clip set is Malayalam for both values. | One reviewed voice catalogue is the riskiest and most valuable piece; a second language doubles native review and rendering. | Pre-render an English clip set from `shared/phrases.json` `en` fields (same pipeline, an `en-IN` voice); `Speaker` picks the clip set by `cfg.patient.lang`; the LLM note speaks `en` for English patients. |

Not deviations, just scope notes: patient voice input (STT) is deferred (the spec marks it as a stretch goal); realtime speech-to-speech models are not used and the `llm=` slot holds a `NoLLM` stub.

---

## 4. Reuse map (file by file)

Dispositions: **KEEP** (no change), **MODIFY** (edit in place), **RENAME** (move or rename with small edits), **RENAME+MODIFY**, **REPLACE** (same path, new content), **DELETE**, **NEW**.

**Rule for renames:** use a move (`git mv` once git exists) and then edit, so history and imports stay traceable. **Never delete a file before Milestone 5's "pre-delete" checkpoint** unless this table says DELETE *and* you have listed it to the user (see §16).

### 4.1 Root and config
| Current | Disposition | Target | Concrete changes |
|---|---|---|---|
| `package.json` | MODIFY | same | `name: "physiocoach"`. Add scripts: `db:generate` (`drizzle-kit generate`), `db:migrate` (`drizzle-kit migrate`), `db:seed` (`tsx src/db/seed.ts`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`). **Scripts that import `server-only` modules or `@/db` must run under the `react-server` condition** (the `server-only` package throws under the default export condition): `db:seed` = `tsx --conditions=react-server src/db/seed.ts`, `stream:call-type` = `tsx --conditions=react-server scripts/ensure-call-type.ts`, `dev:create-call` = `tsx --conditions=react-server scripts/dev-create-call.ts`. **[I]** tsx forwards `--conditions` to Node; if it rejects the flag, use `node --conditions=react-server --import tsx <script>`. Every script (and `seed.ts`) starts with `import "dotenv/config";` as its **first** import, as `drizzle.config.ts` already does (plain tsx does not load `.env`). Change `dev:webhook` to `node scripts/ngrok.mjs`: npm runs scripts through `cmd.exe` on this Windows machine, which does not expand `$VAR`. `scripts/ngrok.mjs` does `import "dotenv/config"` and then `spawn("ngrok", ["http", \`--url=${process.env.NGROK_DOMAIN}\`, "3000"], { stdio: "inherit", shell: true })`. Dependency changes are in §4.9. |
| `next.config.ts` | MODIFY | same | Delete the `redirects()` rule `/` → `/meetings`. Add `output: "standalone"`. Add `allowedDevOrigins: process.env.NGROK_DOMAIN ? [process.env.NGROK_DOMAIN] : []`. Add `headers()` returning `Referrer-Policy: no-referrer` (and `X-Robots-Tag: noindex`) for `source: "/join/:path*"`, because the join token is a bearer credential in the URL path (§7.2). |
| — | NEW | `vitest.config.ts`, `tests/stubs/empty.ts` | `resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/stubs/empty.ts") } }`; `tests/stubs/empty.ts` is an empty module. Without these, vitest cannot resolve `@/` and crashes on any `server-only` import. |
| — | NEW | `scripts/ngrok.mjs`, `scripts/dev-create-call.ts` | See the `package.json` row and Milestone 2 task 1. |
| `drizzle.config.ts` | KEEP | same | Already `out: "./drizzle"`. Move from `push` to `generate` + `migrate`. |
| `.env.example` | REPLACE | same | Placeholders only. Full variable list in §13.1. |
| `.env` | MODIFY (local only, never read it aloud or commit it) | same | The user rotates its secrets. You may add new variable names as placeholders. |
| `.gitignore` | MODIFY | same | Add `agent/.venv/`, `**/__pycache__/`, `agent/cache/`, `agent/replay/recordings/`, `agent/models/*.pt`, `agent/models/*.task`, `*.onnx` (except if the user wants weights committed), `.env*` except `.env.example`. |
| `tsconfig.json` | MODIFY | same | Add `"agent"` to `exclude`. |
| `README.md` | REPLACE | same | PhysioCoach setup: web, worker, Redis, Stream, demo script. |
| `APP_OVERVIEW.md` | KEEP | same | Historical reference. |
| `components.json`, `eslint.config.mjs`, `postcss.config.mjs` | KEEP | same | — |
| — | NEW | `shared/exercises.json` | Single source of truth for the exercise library (§6.3), read by both the TS seed and the Python loader. |
| — | NEW | `shared/phrases.json` | Phrase catalogue `id → {ml, en, category, params?}` (§9). |
| — | NEW | `shared/fixtures/events/*.json`, `shared/fixtures/agent-callbacks/*.json` | Contract fixtures parsed by both vitest and pytest (§7.7). |
| — | NEW | `scripts/ensure-call-type.ts` | One-off: create the `physio_session` call type (§7.3). |
| — | NEW | `Dockerfile`, `agent/Dockerfile`, `docker-compose.yml` | §13. |

### 4.2 `src/app`
| Current | Disposition | Target | Concrete changes |
|---|---|---|---|
| `app/layout.tsx` | MODIFY | same | Metadata `title: "PhysioCoach"`, `description: "Live supervised physiotherapy exercise"`. `const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })`; `const notoMl = Noto_Sans_Malayalam({ subsets: ["malayalam"], weight: ["400","600","700"], variable: "--font-noto-ml" })`; `<body className={\`${inter.variable} ${notoMl.variable} font-sans antialiased\`}>` (today only `inter.className` is applied, so CSS variables would be undefined). Move `NuqsAdapter` and `TRPCReactProvider` **inside** `<body>`. |
| `app/globals.css` | MODIFY | same | In `@theme inline`: `--font-sans: var(--font-inter), sans-serif;` and `--font-ml: var(--font-noto-ml), var(--font-inter), sans-serif;`. Delete the `--font-mono: var(--font-geist-mono)` line (undefined). Do **not** hand-write a `.font-ml` class: Tailwind v4 generates the `font-ml` utility from the `--font-*` theme namespace. Add `leading-relaxed` where Malayalam text needs it. Keep the green primary and sidebar tokens. Use `--chart-1` (actual) and `--chart-2` (target) for ROM charts. |
| `app/favicon.ico` | REPLACE | same | PhysioCoach icon (optional). |
| — | NEW | `app/page.tsx` | Server component: `auth.api.getSession({ headers: await headers() })`. Physio → `redirect("/overview")`, otherwise `redirect("/sign-in")`. |
| `(auth)/layout.tsx`, `sign-in/page.tsx`, `sign-up/page.tsx` | KEEP | same | — |
| `(dashboard)/layout.tsx` | MODIFY | same | Make it an `async` server component with **the single physio guard**: no session, or `session.user.role !== "physio"` → `redirect("/sign-in")`. Keep `SidebarProvider`/`DashboardSidebar`/`DashboardNavbar`. Remove the per-page session checks in child pages as you migrate them. |
| `(dashboard)/agents/page.tsx` | RENAME+MODIFY | `(dashboard)/patients/page.tsx` | `trpc.patients.getMany`, `loadSearchParams` from `@/modules/patients/params`, `PatientsListHeader`, `PatientsView`/`PatientsViewLoading`/`PatientsViewError`. |
| `(dashboard)/agents/[agentId]/page.tsx` | RENAME+MODIFY | `(dashboard)/patients/[patientId]/page.tsx` | Prefetch `patients.getOne`, `prescriptions.getMany({patientId})`, `sessions.getMany({patientId})`, `analytics.romTrend({patientId})`, `notes.getMany({patientId})`. |
| — | NEW | `(dashboard)/prescriptions/page.tsx`, `(dashboard)/prescriptions/[prescriptionId]/page.tsx` | Same prefetch/HydrationBoundary/Suspense/ErrorBoundary skeleton as the agents pages. |
| `(dashboard)/meetings/page.tsx` | RENAME+MODIFY | `(dashboard)/sessions/page.tsx` | `trpc.sessions.getMany`, `SessionsListHeader`, `SessionsView*`. |
| `(dashboard)/meetings/[meetingId]/page.tsx` | RENAME+MODIFY | `(dashboard)/sessions/[sessionId]/page.tsx` | Prefetch `sessions.getOne` and `sessions.getResults`. |
| — | NEW | `(dashboard)/overview/page.tsx` | Prefetch `analytics.overview`, `sessions.getMany({status:"live"})`, `analytics.painFlags`, `analytics.adherence`. Render `OverviewView`. |
| `call/layout.tsx` | MODIFY | same | `h-screen` → `h-dvh`. |
| `call/[meetingId]/page.tsx` | RENAME+MODIFY | `call/[sessionId]/page.tsx` | Physio in-call page: physio guard, prefetch `sessions.getOne`, render `<CallView viewer="physio" sessionId=… />`. |
| — | NEW | `join/layout.tsx` (copy of `call/layout.tsx`), `join/[token]/page.tsx` | Public patient entry. The server calls `verifyJoinToken(token)` and shows `ErrorState` ("This link has expired or is invalid. Ask your physiotherapist for a new link.", with a Malayalam line) if invalid. Prefetch `join.resolve({token})`, render `<CallView viewer="patient" joinToken=… />`. Add `export const dynamic = "force-dynamic"` and `robots: { index: false }` metadata. |
| `api/auth/[...all]/route.ts`, `api/trpc/[trpc]/route.ts` | KEEP | same | — |
| `api/inngest/route.ts` | DELETE (after the pre-delete checkpoint) | — | DEV-5. |
| `api/webhook/route.ts` | MODIFY (heavy) | same | §7.5. |
| — | NEW | `api/agent/events/route.ts` | Worker → web callbacks (§7.6). |

### 4.3 Shared code
| Current | Disposition | Target | Concrete changes |
|---|---|---|---|
| `components/command-select.tsx` | KEEP | same | Optional: drop the unused `isSearchable` prop. Reused for the patient, exercise, side and status pickers. |
| `components/data-pagination.tsx`, `data-table.tsx`, `empty-state.tsx`, `error-state.tsx`, `loading-state.tsx`, `responsive-dialog.tsx` | KEEP | same | Optional: render `TableHeader` in `DataTable`. |
| `components/generated-avatar.tsx` | MODIFY | same | Call `generateAvatarUri` from `lib/avatar` instead of duplicating `createAvatar`. `"initials"` for people; `"botttsNeutral"` only for the coach. |
| `components/ui/*` | KEEP | same | Planned uses: `chart.tsx` (ROM trend, per-rep chart), `progress.tsx` (adherence), `tabs.tsx`, `badge.tsx`, `switch.tsx` (prescription active), `select.tsx`/`radio-group.tsx` (side, language), `slider.tsx` (optional target angle), `tooltip.tsx`, `alert.tsx` (pain banner). |
| `constants.ts` | MODIFY | same | Keep pagination constants. Add `AGENT_USER_ID = process.env.NEXT_PUBLIC_STREAM_AGENT_USER_ID ?? "physiocoach-agent"`, `PAIN_ALERT_THRESHOLD = 7`, `LIVE_REFETCH_MS = 2000`, `JOIN_LINK_TTL_HOURS = 12`, `MAX_REPS = 30`. |
| `hooks/use-confirm.tsx`, `hooks/use-mobile.ts` | KEEP | same | — |
| `lib/auth.ts` | MODIFY | same | §6.2 (`additionalFields`, `trustedOrigins`). |
| `lib/auth-client.ts` | MODIFY | same | `createAuthClient({ plugins: [inferAdditionalFields<typeof auth>()] })` from `better-auth/client/plugins`. Import `auth` as a type only. |
| `lib/avatar.tsx` | KEEP (optional rename to `.ts`) | same | — |
| `lib/stream-chat.ts` | DELETE (pre-delete checkpoint) | — | Chat removed from the app. |
| `lib/stream-video.ts` | MODIFY | same | §7.3: `streamVideo` (with `{ timeout: 10_000 }`), `CALL_TYPE`, `AGENT_USER_ID`, `callCid`, `createGuidedCall`, `createPhysioUserToken`, `createPatientCallToken`, `endGuidedCall`. Upserts always use `role: "user"`. |
| — | NEW | `lib/join-token.ts` | §7.2. |
| — | NEW | `lib/signing.ts` | `signRequest(secret, method, pathWithQuery, body)` → `t=<ts>,v1=<hex HMAC-SHA256(secret, "<t>.<METHOD>.<pathWithQuery>.<sha256hex(body)>")>`; `verifySignedRequest(secret, method, pathWithQuery, body, header, maxAgeSec=300)` with `timingSafeEqual`. Binding the method and path stops a captured signed `GET /sessions/A` from being replayed as `DELETE /sessions/B` (empty bodies hash identically). Shared by the agent-worker client and the callback route; mirrored in Python `control/auth.py` and `call/outbox.py`. |
| — | NEW | `lib/agent-worker.ts` (`server-only`) | `startAgent(payload)`, `stopAgent(sessionId)`, `getAgent(sessionId)`, `forwardInput(sessionId, event)`. HMAC-signed fetch to `AGENT_WORKER_URL`. |
| — | NEW | `lib/rate-limit.ts` | In-memory token bucket keyed by `ip + tokenHash` (10 req / 10 s), used by `join.*`. |
| `lib/utils.ts` | KEEP (+add) | same | Add `formatDeg(n) => \`${Math.round(n)}°\``. |
| `db/index.ts` | MODIFY | same | Today it calls `drizzle(process.env.DATABASE_URL!)` at module load, and neon throws "No database connection string was provided" when the variable is undefined, which breaks `next build` in a Docker build without runtime env (route modules are imported while page data is collected). Make it lazy while keeping the `db` export name, e.g. `let _db: ReturnType<typeof make> \| undefined; const make = () => drizzle(process.env.DATABASE_URL!, { schema }); export const db = new Proxy({} as ReturnType<typeof make>, { get: (_t, p) => { const real = (_db ??= make()); const v = Reflect.get(real, p); return typeof v === "function" ? v.bind(real) : v; } });` (or pass dummy build-time env as Docker build args; the lazy client is preferred). Check that Better Auth's `drizzleAdapter(db, ...)` still works with the proxy; if not, export a `getDb()` and call it inside the adapter factory. Apply the same rule to any other module-scope SDK client built from non-null-asserted env (`lib/stream-video.ts`). `neon-http` has **no interactive transactions**; use `db.batch([...])` for multi-statement writes. |
| `db/schema.ts` | REPLACE | same | §6.1. |
| — | NEW | `db/seed.ts` | First line `import "dotenv/config";`. Reads `shared/exercises.json`, upserts `exercises` with `onConflictDoUpdate({ target: exercises.id, set: {...} })`. Optional `--demo` flag creates a demo physio-patient link for a patient named **"Demo Patient"**, a knee_bend prescription (target 60, 10 reps, 2 s), and 4–6 past `done` sessions over the last 2 weeks with `set_results` (derived numbers only, e.g. avg peak 38 → 44 → 47 → 50, `feedbackSource = "rules"`), so the ROM trend and adherence have history during the demo (DEV-14). |
| `trpc/init.ts` | MODIFY | same | `createTRPCContext` returns `{}`. Keep `protectedProcedure`. Add `physioProcedure` (FORBIDDEN unless `ctx.auth.user.role === "physio"`) and the helper `requireJoin(token)` (§7.2). |
| `trpc/routers/_app.ts` | MODIFY | same | `{ patients, exercises, prescriptions, sessions, join, analytics, notes }`. |
| `trpc/client.tsx`, `trpc/server.tsx`, `trpc/query-client.ts` | KEEP | same | — |
| `inngest/client.ts`, `inngest/functions.ts` | DELETE (pre-delete checkpoint) | — | DEV-5. |

### 4.4 `agents` module → `patients` module
| Current | Disposition | Target | Concrete changes |
|---|---|---|---|
| `agents/hooks/use-agents-filters.ts` | RENAME | `patients/hooks/use-patients-filters.ts` | `usePatientsFilters`, same `search` and `page`. |
| `agents/params.ts` | RENAME | `patients/params.ts` | Unchanged. |
| `agents/schemas.ts` | RENAME+MODIFY | `patients/schemas.ts` | A `.refine()` produces a `ZodEffects` in zod 3.25.7, which has no `.extend` (the repo's `agentsInsertSchema.extend({ id })` pattern would fail). Build from a base object: `const patientBase = z.object({ name: z.string().min(1).max(120), phone: z.string().regex(/^\+?[0-9]{8,15}$/).optional().or(z.literal("")), email: z.string().email().optional().or(z.literal("")), preferredLanguage: z.enum(["ml","en"]) })`; `const needsContact = (v: { phone?: string; email?: string }) => !!v.phone \|\| !!v.email`; `const contactMsg = { message: "Phone or email required", path: ["phone"] }`; `export const patientsInsertSchema = patientBase.refine(needsContact, contactMsg)`; `export const patientsUpdateSchema = patientBase.extend({ id: z.string().min(1) }).refine(needsContact, contactMsg)`. No `.default()` in form schemas: put `preferredLanguage: "ml"` in the form's `defaultValues` (see the §4.5 note on `@hookform/resolvers` 5.0.1). |
| `agents/server/procedures.ts` | RENAME+MODIFY | `patients/server/procedures.ts` | `patientsRouter` with the same five procedures (`getMany`, `getOne`, `create`, `update`, `remove`), now on `physioProcedure`. The `agents` table becomes `user` joined to `physioPatientLinks`, scoped by `eq(physioPatientLinks.physioId, ctx.auth.user.id)`. Replace `meetingCount` with `sessionCount: db.$count(callSessions, eq(callSessions.patientId, user.id))`. Add `activePrescriptionCount`, `lastSessionAt` and `latestPain` (correlated subqueries). `create` and `update`: **normalise `""` to `null`** for `phone` and `email` before writing (`phone: input.phone \|\| null`), because `user.phone` is unique and a second empty string would collide. `create`: in one `db.batch`, insert `user { id: nanoid(), role: "patient", email: input.email \|\| \`p_${id}@patients.physiocoach.invalid\`, phone: input.phone \|\| null, emailVerified: false }` and the link. Catch unique violations (Postgres code `23505`) and throw `TRPCError({ code: "CONFLICT", message: "A user with this email or phone already exists" })`. **In v1 each patient row belongs to exactly one physio**; never attach an existing user by email (that would let any physio claim another account). `update`: scoped through the link. `remove`: delete the link and the patient user in one `db.batch` (sessions cascade; `useConfirm` warns "…will remove N sessions"). Keep the `ilike` search (name or phone), `orderBy(desc(createdAt), desc(id))`, limit/offset, `totalPages`. |
| `agents/types.ts` | RENAME | `patients/types.ts` | `PatientsGetMany`, `PatientGetOne`. |
| `agents/ui/components/agent-form.tsx` | RENAME+MODIFY | `patients/ui/components/patient-form.tsx` | Fields `name`, `phone`, `email`, `preferredLanguage` (`Select`: മലയാളം / English). `GeneratedAvatar variant="initials"`. Keep the create/update mutations and the `getMany`/`getOne` invalidation. |
| `agents/ui/components/agent-id-view-header.tsx` | RENAME+MODIFY | `patients/ui/components/patient-id-view-header.tsx` | Breadcrumb "My Patients" → `/patients`. Dropdown: Edit, New prescription, Delete. |
| `agents/ui/components/agents-list-header.tsx` | RENAME+MODIFY | `patients/ui/components/patients-list-header.tsx` | "My Patients" + "New Patient" (`NewPatientDialog`). |
| `agents/ui/components/agents-search-filter.tsx` | RENAME | `patients/ui/components/patients-search-filter.tsx` | Placeholder "Filter by name or phone". |
| `agents/ui/components/columns.tsx` | RENAME+MODIFY | `patients/ui/components/columns.tsx` | Initials avatar + name; phone instead of `instructions`; `sessionCount` badge (`VideoIcon`); last session date; active prescription count; red pain badge when `latestPain >= 7`. |
| `agents/ui/components/data-pagination.tsx` | DELETE | — | Duplicate. Import `DataPagination` from `@/components/data-pagination`. |
| `agents/ui/components/new-agent-dialog.tsx` / `update-agent-dialog.tsx` | RENAME | `patients/ui/components/new-patient-dialog.tsx` / `update-patient-dialog.tsx` | Text only. |
| `agents/ui/views/agent-id-view.tsx` | RENAME+MODIFY | `patients/ui/views/patient-id-view.tsx` | Keep `useSuspenseQuery`, the remove mutation, `useConfirm` ("…will remove N sessions") and dialog wiring. Replace the instructions block with: profile card, prescriptions list (each row has `StartSessionButton`), `RomTrendChart`, recent sessions (`DataTable` with the sessions `columns`), `PhysioNotes`. Fix the typo. |
| `agents/ui/views/agents-view.tsx` | RENAME+MODIFY | `patients/ui/views/patients-view.tsx` | Rows link to `/patients/${row.id}`. New empty-state text. Fix the typo. |

### 4.5 New `prescriptions` module (built from the agents skeleton plus `meeting-form`)
| Current | Disposition | Target | Concrete changes |
|---|---|---|---|
| — | NEW | `prescriptions/params.ts`, `hooks/use-prescriptions-filters.ts` | `search`, `page`, `patientId`, `exerciseId`, `active` (`parseAsBoolean`). |
| — | NEW | `prescriptions/schemas.ts` | `prescriptionsInsertSchema = z.object({ patientId: z.string().min(1), exerciseId: z.enum(["knee_bend","elbow_bend","shoulder_raise"]), side: z.enum(["auto","left","right"]), targetAngle: z.coerce.number().int().min(10).max(180), reps: z.coerce.number().int().min(1).max(30), sets: z.coerce.number().int().min(1).max(5), minSecondsPerRep: z.coerce.number().min(0.5).max(10), sessionsPerWeek: z.coerce.number().int().min(1).max(14), active: z.boolean() })`. Update schema = `prescriptionsInsertSchema.extend({ id: z.string().min(1) })`. **Form-typing rules** (the existing forms only ever had text fields, so these problems do not show up today): (1) no `.default()` in form schemas, because with `@hookform/resolvers` 5.0.1 a schema whose input type differs from its output type breaks `useForm<z.infer<typeof s>>({ resolver: zodResolver(s) })`; put defaults in the form's `defaultValues` (`side: "auto"`, `sets: 1`, `minSecondsPerRep: 2`, `sessionsPerWeek: 5`, `active: true`) and in the DB columns; (2) shadcn `<Input type="number" {...field}>` emits strings, so use `z.coerce.number()` (as above) or bind with `onChange={(e) => field.onChange(e.target.valueAsNumber)}`; (3) if `z.coerce` makes the input type `unknown`/differ, type the form as `useForm<z.input<typeof s>, unknown, z.output<typeof s>>`. |
| — | NEW | `prescriptions/server/procedures.ts`, `types.ts` | §7.1. The server checks the physio–patient link and `targetAngle >= exercise.minPeak`. |
| `meetings/ui/components/meeting-form.tsx` | RENAME+MODIFY | `prescriptions/ui/components/prescription-form.tsx` | Swap `trpc.agents.getMany` for `trpc.patients.getMany` and keep the `CommandSelect` with `onSearch`. "Create new agent" becomes "Create new patient" (opens `NewPatientDialog`). Add a second `CommandSelect` fed by `trpc.exercises.getMany`; on pick, `form.setValue("targetAngle", ex.defaultTarget)`. Number `Input`s for `targetAngle`, `reps`, `sets`, `minSecondsPerRep`, `sessionsPerWeek`; `Select` for `side`; `Switch` for `active`. Optional `defaultPatientId` prop. Show the exercise's `howToEn` under the picker. |
| `meetings/ui/components/new-meeting-dialog.tsx` | RENAME+MODIFY | `prescriptions/ui/components/new-prescription-dialog.tsx` | `onSuccess(id)` → `router.push(\`/prescriptions/${id}\`)`; accepts `defaultPatientId`. |
| `meetings/ui/components/update-meeting-dialog.tsx` | RENAME | `prescriptions/ui/components/update-prescription-dialog.tsx` | — |
| — | NEW (cloned) | `prescriptions/ui/components/{columns, prescriptions-list-header, prescriptions-search-filter, prescription-id-view-header, exercise-filter}.tsx`, `ui/views/{prescriptions-view, prescription-id-view}.tsx` | Cloned from the matching agents/meetings files. Columns: patient (avatar + name), exercise (`nameEn` / `nameMl` in `font-ml`), target °, reps × sets, min s/rep, active badge, inline "Start" cell (`e.stopPropagation()`). The detail view has a large **"Start guided session"** button and lists that prescription's sessions. |
| — | NEW | `prescriptions/ui/components/start-session-button.tsx` | Calls `sessions.start({prescriptionId})`, then opens `JoinLinkDialog`. Disabled while pending; `onError` toast. |
| — | NEW | `exercises/server/procedures.ts`, `exercises/types.ts` | `getMany`, `getOne` (read-only). |

### 4.6 `meetings` module → `sessions` module
| Current | Disposition | Target | Concrete changes |
|---|---|---|---|
| `meetings/hooks/use-meetings-filters.ts`, `meetings/params.ts` | RENAME+MODIFY | `sessions/hooks/use-sessions-filters.ts`, `sessions/params.ts` | `status: parseAsStringEnum(Object.values(CallSessionStatus))`; `agentId` → `patientId`; add `prescriptionId`. |
| `meetings/schemas.ts` | REPLACE | `sessions/schemas.ts` | `sessionsStartSchema = z.object({ prescriptionId: z.string().min(1), mode: z.enum(["live","replay"]).default("live"), clip: z.string().regex(/^[a-z0-9_\-]+\.mp4$/).optional() })`. |
| `meetings/server/procedures.ts` | RENAME+MODIFY | `sessions/server/procedures.ts` | **Keep** the `getMany`/`getOne` structure, pagination and `duration: sql<number>\`EXTRACT(EPOCH FROM (ended_at - started_at))\``. Replace `innerJoin(agents)` with joins to `user` (patient), `prescriptions`, `exercises`; scope by `eq(callSessions.physioId, ctx.auth.user.id)`; count query without joins. `create` → `start` (§7.1, §7.4). `update` → DELETE. `remove` → `cancel`. New: `end`, `restartAgent`, `regenerateJoinLink`, `getResults`, `sendInput`, `acknowledgeSafety`; plus the lazy join-timeout check (§7.4). `generateToken` → `physioToken` (fixed token). **Delete** `generateChatToken`, `getTranscript`. |
| `meetings/types.ts` | MODIFY | `sessions/types.ts` | `SessionGetMany`, `SessionGetOne`, `SessionResults`; `enum CallSessionStatus { Scheduled="scheduled", Live="live", Done="done", Failed="failed" }`; `type PerRep = { peak: number; seconds: number; tooFast: boolean }`. Delete `StreamTranscriptItem` and `MeetingStatus`. |
| `meetings/ui/components/columns.tsx` | MODIFY | `sessions/ui/components/columns.tsx` | `statusIconMap`/`statusColorMap` keys: `scheduled` (ClockArrowUpIcon, yellow), `live` (LoaderIcon spinning, blue), `done` (CircleCheckIcon, emerald), `failed` (CircleXIcon, rose). Name cell: exercise name, patient avatar/name, `format(startedAt ?? scheduledAt, "MMM d")`. Keep the duration column. Add best score, "avg peak / target", pain badge, and a `replay` badge when `mode === "replay"`. |
| `meetings/ui/components/status-filter.tsx` | MODIFY | `sessions/ui/components/status-filter.tsx` | Four options from `CallSessionStatus`. |
| `meetings/ui/components/agent-id-filter.tsx` | RENAME+MODIFY | `patients/ui/components/patient-id-filter.tsx` | Today it is hard-wired to `useMeetingsFilters()`. Make it **controlled**: props `{ value: string; onChange: (id: string) => void }`; `trpc.patients.getMany({ pageSize: 100, search })`, initials avatar. The sessions header passes `filters.patientId` and `(id) => setFilters({ patientId: id, page: DEFAULT_PAGE })`; the prescriptions header does the same with `usePrescriptionsFilters`. |
| `meetings/ui/components/meetings-search-filter.tsx` | RENAME | `sessions/ui/components/sessions-search-filter.tsx` | Search by patient or exercise name. |
| `meetings/ui/components/meetings-list-header.tsx` | RENAME+MODIFY | `sessions/ui/components/sessions-list-header.tsx` | Title "Sessions". Remove "New Meeting" (sessions start from a prescription). Filters: search, `StatusFilter`, `PatientIdFilter`. Keep `isAnyFilterModified` and the clear logic. |
| `meetings/ui/components/meeting-id-view-header.tsx` | RENAME+MODIFY | `sessions/ui/components/session-id-view-header.tsx` | Breadcrumb "Sessions". Dropdown: **New patient link** (calls `sessions.regenerateJoinLink` and opens `JoinLinkDialog` with the returned URL; this revokes the old link), Join as physio (live), Restart coach (live), End session (live), Cancel (scheduled). No Edit. There is no "Copy patient link": only `sha256(token)` is stored (§7.2), so the raw URL exists only in the `start`/`regenerateJoinLink` response. Use `hasActiveJoinLink`/`joinTokenExpiresAt` from `getOne` only to show "link active until <time>". |
| `meetings/ui/components/upcoming-state.tsx` | RENAME+MODIFY | `sessions/ui/components/scheduled-state.tsx` | `/upcoming.svg`. Shows "Starting coach…" (`/processing.svg`) until `agentPid` is set, then "Waiting for patient". Actions: **New patient link** (as in the header), Join as physio, Cancel. |
| `meetings/ui/components/active-state.tsx` | RENAME+MODIFY | `sessions/ui/components/live-state.tsx` | "Session is live". `Link href=/call/${id}` "Join call". Live set feed (`sessions.getResults`, 2 s polling). Red alert banner from open `safety_events`. |
| `meetings/ui/components/processing-state.tsx` | DELETE | — | No processing phase. |
| `meetings/ui/components/cancelled-state.tsx` | RENAME+MODIFY | `sessions/ui/components/failed-state.tsx` | `/cancelled.svg`; text per `failureReason`, one line for every member of the `FailureReason` union defined once in `agent-bridge/schemas.ts` (§7.7): `cancelled`, `agent_start_failed`, `agent_join_timeout`, `patient_never_joined`, `patient_left`, `no_consent`, `no_sets`, `agent_crashed`. |
| `meetings/ui/components/completed-state.tsx` | RENAME+MODIFY | `sessions/ui/components/done-state.tsx` | Keep the `Tabs`/`ScrollArea` styling. Tabs: **Summary** (per-set score, avg/best/lowest peak vs target, fast reps, pain, `feedbackEn` with a `feedbackMl` toggle in `font-ml`, `feedbackSource` badge, duration, link to the patient), **Sets** (`SetResultsTable`), **Reps** (`RepChart`), **Notes** (`PhysioNotes`). Remove `react-markdown`, Recording and Ask AI. |
| `meetings/ui/components/transcript.tsx` | REPLACE | `sessions/ui/components/set-results-table.tsx` | Keep the card shell. Columns: #, reps done/planned, avg/best/lowest peak, avg rep s, fast reps, score, pain, stop reason. |
| `meetings/ui/components/chat-provider.tsx`, `chat-ui.tsx` | DELETE | — | Ask AI removed. |
| — | NEW | `sessions/ui/components/{rep-chart, set-result-card, pain-badge, join-link-dialog}.tsx` | `rep-chart`: `ChartContainer` + `BarChart` + `ReferenceLine y={targetAngle}`, too-fast reps in a different colour. `join-link-dialog`: copy, WhatsApp `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`, SMS, email, QR (`qrcode.react` `QRCodeSVG`), "Join as physio" → `/call/${id}` (details in §10.1). |
| `meetings/ui/views/meeting-id-view.tsx` | RENAME+MODIFY | `sessions/ui/views/session-id-view.tsx` | Switch on `isScheduled`/`isLive`/`isDone`/`isFailed`. `useSuspenseQuery(trpc.sessions.getOne.queryOptions({ id }, { refetchInterval: (q) => ["scheduled","live"].includes(q.state.data?.status ?? "") ? LIVE_REFETCH_MS : false }))`. `cancel`/`end`/`restartAgent` mutations with `onError` toasts. Keep `useConfirm`. |
| `meetings/ui/views/meetings-view.tsx` | RENAME+MODIFY | `sessions/ui/views/sessions-view.tsx` | Rows link to `/sessions/${row.id}`. |

### 4.7 `call` module (role-aware call UI)
| Current | Disposition | Target | Concrete changes |
|---|---|---|---|
| `call/ui/views/call-view.tsx` | MODIFY (split) | `PhysioCallView` + `PatientCallView` in the same folder | Split it so `useSuspenseQuery` is never called conditionally: `PhysioCallView({ sessionId })` reads `trpc.sessions.getOne`; `PatientCallView({ joinToken })` reads `trpc.join.resolve({ token })`. `status in ("done","failed")` → "Session has ended". Both pass `streamCallId`, `callType`, exercise, prescription, `patientId` and a computed label `${exercise.nameEn} · ${patient.name}` (with `nameMl` in `font-ml` for patients) down. There is no `name` column on call sessions, so the old `meetingName`/`data.name` goes away. |
| `call/ui/components/call-provider.tsx` | MODIFY | same | Physio: `authClient.useSession()` as now. Patient: the user comes from `join.resolve` (no Better Auth session). Builds `tokenProvider`: `sessions.physioToken` or `join.streamToken({ token })`. |
| `call/ui/components/call-connect.tsx` | MODIFY | same | New props `tokenProvider`, `streamCallId`, `callType`, `viewer`. `client.call(callType, streamCallId)`. **Keep the client effect's dependencies stable.** Today the effect is keyed on `[userId, userName, userImage, generateToken]` and only works because `generateToken` is a stable `mutateAsync`; a patient `tokenProvider` built as `() => streamToken({ token })` is a new closure every render and would disconnect and recreate the client in a loop. Hold it in a ref (`const tp = useRef(tokenProvider); tp.current = tokenProvider;` and pass `tokenProvider: () => tp.current()`) and key the effect only on `[userId, userName, userImage, apiKey]`. **Cleanup calls only `_call.leave()`** (guarded by `callingState !== LEFT`); remove `_call.endCall()`. Remove `_call.camera.disable()` (the lobby enables the camera). Optionally use `StreamVideoClient.getOrCreateInstance` [V in video-client 1.61.2; U in installed 1.23.2]. Keep the single Stream CSS import here. |
| `call/ui/components/call-ui.tsx` | MODIFY | same | Same `lobby`/`call`/`ended` states. `handleLeave` → `call.leave()`. The physio gets an extra "End session for all" that calls `sessions.end` (and so `call.end()` server-side). |
| `call/ui/components/call-lobby.tsx` | MODIFY | same | `DisabledVideoPreview` takes the user as a prop instead of `authClient.useSession()`. Cancel goes to `/sessions/${id}` for the physio; no link for the patient. Camera placement tip from `exercise.cameraView` (side-on for knee and elbow, front-on for shoulder, whole limb in frame, good light), bilingual. Large touch targets. Remove the duplicate Stream CSS import. |
| `call/ui/components/call-active.tsx` | REPLACE (keep the header pill and `CallControls`) | `call/ui/components/guided-call-layout.tsx` + thin `call-active.tsx` wrapper | §10.3. The header pill today wraps the logo in `<Link href="/">`. For `viewer="patient"` the logo is **not a link** (navigating to `/` redirects to `/sign-in` and unmounts the call); for the physio it links to `/sessions/${sessionId}`. Replace `meetingName` with the computed label from the call view. |
| `call/ui/components/call-ended.tsx` | MODIFY | same | Patient: bilingual thank-you, no dashboard link. Physio: "Back to session" → `/sessions/${id}`. |
| — | NEW | `call/hooks/use-agent-participant.ts`, `call/hooks/use-agent-events.ts`, `call/hooks/use-send-input.ts` | §10.3. |
| — | NEW | `call/ui/components/{consent-banner, stop-button, pain-scale, symptom-buttons, captions-panel, phase-indicator, rep-counter, physio-live-panel, autoplay-unblock}.tsx` | §10.3. |
| — | NEW | `call/contracts.ts` re-export of `@/modules/agent-bridge/schemas` | So client code imports the event types from one place. |

### 4.8 Dashboard shell, home, auth, public
| Current | Disposition | Target | Concrete changes |
|---|---|---|---|
| `dashboard/ui/components/dashboard-sidebar.tsx` | MODIFY | same | Items: Overview (`LayoutDashboardIcon`, `/overview`), Patients (`UsersIcon`), Prescriptions (`ClipboardListIcon`), Sessions (`VideoIcon`). Brand "PhysioCoach". `isActive={pathname.startsWith(item.href)}`. |
| `dashboard/ui/components/dashboard-command.tsx` | MODIFY | same | `trpc.patients.getMany({search, pageSize:100})` and `trpc.sessions.getMany({search, pageSize:100})`; groups "Patients" and "Sessions"; one list-level `CommandEmpty`; placeholder "Find a patient or session…". |
| `dashboard/ui/components/dashboard-navbar.tsx`, `dashboard-user-button.tsx` | KEEP | same | Optional "Physiotherapist" label. |
| `home/ui/views/home-view.tsx` | RENAME+REPLACE | `overview/ui/views/overview-view.tsx` (+ `OverviewViewLoading`, `OverviewViewError`) | §10.1. |
| — | NEW | `analytics/server/procedures.ts`, `analytics/lib/weekly-summary-rules.ts`, `analytics/ui/components/{rom-trend-chart, adherence-card, weekly-summary-card, pain-flags-list}.tsx` | §7.1, §10.1. |
| — | NEW | `notes/server/procedures.ts`, `notes/ui/components/physio-notes.tsx` | Note list + `Textarea` to add one. |
| — | NEW | `join/server/procedures.ts` | §7.1. |
| — | NEW | `agent-bridge/schemas.ts` | Zod contracts (§7.7). Authoritative for TS. |
| `auth/ui/views/sign-in-view.tsx` | MODIFY | same | "Meet.AI" → "PhysioCoach"; subtitle "Physiotherapist login"; fix the image `alt`. |
| `auth/ui/views/sign-up-view.tsx` | MODIFY | same | Brand; **submit label "Create account"**; role forced to physio server-side (`input: false`). |
| `public/logo.svg` | REPLACE | same | PhysioCoach mark. |
| `public/{empty,upcoming,processing,cancelled}.svg` | KEEP | same | Reused for the states. |
| `public/{file,globe,next,vercel,window}.svg` | DELETE | — | Unreferenced create-next-app leftovers (grep before deleting). |

### 4.9 Dependencies
**npm, remove:** `@stream-io/openai-realtime-api`, `openai`, `inngest`, `@inngest/agent-kit`, `stream-chat`, `stream-chat-react`, `jsonl-parse-stringify`, `react-markdown`, `react-highlight-words`, dev `@types/react-highlight-words`. Optional, together with their unused shadcn files (`carousel.tsx`, `input-otp.tsx`, `resizable.tsx`): `embla-carousel-react`, `input-otp`, `react-resizable-panels`.

**npm, keep:** everything else, including `@stream-io/video-react-sdk`, `@stream-io/node-sdk`, `better-auth`, `drizzle-orm`, `@neondatabase/serverless`, the tRPC and TanStack packages, `nuqs`, `zod`, `react-hook-form`, `@hookform/resolvers`, all `@radix-ui/*`, `cmdk`, `vaul`, `sonner`, `next-themes` (imported by `sonner.tsx`), `react-day-picker`, `@dicebear/*`, `date-fns`, `humanize-duration`, `recharts`, `nanoid`, `react-error-boundary`, `server-only`, `client-only`, `dotenv`, dev `drizzle-kit`, `tsx`.

**npm, add:** `@anthropic-ai/sdk` (weekly AI summary), `qrcode.react` (patient link QR for the second demo device), dev `vitest`.

**npm, optional bump (ask the user first):** `@stream-io/video-react-sdk` to the newest 1.4x release published **on or before 2026-09-26** (at least two weeks old), for `useIsAutoplayBlocked` and `call.resumeAudio()` [V in 1.43.4, U in 1.18]. These matter for iOS Safari audio. **Pin `@stream-io/node-sdk` to exactly 0.4.26** (`npm install --save-exact @stream-io/node-sdk@0.4.26`; the lockfile currently has 0.4.24) so §7.3 matches what was verified. The installed React stack is `video-react-sdk` 1.18.0 / `video-client` 1.23.2 / `video-react-bindings` 1.6.5: every hook and method used in §10 (`useCallCustomData`, `useCallMembers`, `getOrCreateInstance`, `useIsAutoplayBlocked`, `resumeAudio`) is **[U] until found** in `node_modules/@stream-io/video-react-bindings/dist/**/*.d.ts` and `node_modules/@stream-io/video-client/dist/src/Call.d.ts` (Milestone 0 task 4).

**Python (`agent/pyproject.toml`, uv, Python 3.13; fall back to 3.12 only if a `mediapipe` wheel is missing):**
- `vision-agents[getstream,sarvam,ultralytics,anthropic,redis]==0.6.9`. This pins `getstream[webrtc,telemetry]>=4.1.0,<5` [V]. **Never let `getstream` 5 or later into this environment** (PyPI has 6.1.1; the private hook in §8.12 depends on 4.x).
- `mediapipe`, `opencv-python-headless`, `numpy`, `fastapi`, `uvicorn[standard]`, `httpx`, `redis`, `pydantic>=2`, `google-cloud-texttospeech` (fallback TTS), `anthropic` (comes with the extra; pin a 0.x/1.x version that exists at install time).
- dev: `pytest`, `pytest-asyncio`. Local tools group (never installed in the production image): `sounddevice` (replay audio, needs PortAudio), `pyloudnorm` (clip normalisation).
- **Layout of `pyproject.toml`:** `[project] dependencies` = the light **core** set (numpy, pydantic, anthropic, httpx), which installs natively on Windows; `[dependency-groups]` `call = [vision-agents extras, mediapipe, opencv-python-headless, ultralytics, torch, torchvision, fastapi, uvicorn, redis, google-cloud-texttospeech]`, `dev = [pytest, pytest-asyncio]`, `tools = [sounddevice, pyloudnorm]`. Docker installs `--group call` (plus `--group dev` only in the test image).
- **CPU-only torch.** `vision-agents[ultralytics]` pulls `torch`, which on linux/x86_64 resolves to the multi-GB CUDA build. List `torch` and `torchvision` as **direct** dependencies in the `call` group (uv source pins apply to direct dependencies) and pin them to the CPU index: `[[tool.uv.index]] name = "pytorch-cpu"`, `url = "https://download.pytorch.org/whl/cpu"`, `explicit = true`, and `[tool.uv.sources] torch = { index = "pytorch-cpu" }`, `torchvision = { index = "pytorch-cpu" }`. **[U]** Confirm with `uv tree` inside the container that no CUDA wheels are resolved. Alternative if that fails: drop `ultralytics` from the default image and keep MediaPipe as the only backend.

---

## 5. Target repo layout

```
/                                           Next.js app (unchanged location)
├── src/
│   ├── app/
│   │   ├── layout.tsx                      Inter + Noto Sans Malayalam; providers inside <body>
│   │   ├── page.tsx                        NEW role router
│   │   ├── (auth)/{layout, sign-in/page, sign-up/page}.tsx
│   │   ├── (dashboard)/layout.tsx          single physio guard
│   │   ├── (dashboard)/overview/page.tsx
│   │   ├── (dashboard)/patients/{page.tsx,[patientId]/page.tsx}
│   │   ├── (dashboard)/prescriptions/{page.tsx,[prescriptionId]/page.tsx}
│   │   ├── (dashboard)/sessions/{page.tsx,[sessionId]/page.tsx}
│   │   ├── call/{layout.tsx,[sessionId]/page.tsx}       physio in-call
│   │   ├── join/{layout.tsx,[token]/page.tsx}           public patient entry
│   │   └── api/{auth/[...all], trpc/[trpc], webhook, agent/events}/route.ts
│   ├── components/ (+ ui/)                 KEEP
│   ├── constants.ts
│   ├── db/{index.ts, schema.ts, seed.ts}
│   ├── hooks/{use-confirm.tsx, use-mobile.ts}
│   ├── lib/{auth, auth-client, avatar, utils, stream-video, join-token, signing, agent-worker, rate-limit}.ts
│   ├── modules/
│   │   ├── agent-bridge/schemas.ts         zod: custom events + worker callbacks + control payloads (authoritative)
│   │   ├── analytics/{server, lib, ui}
│   │   ├── auth/ui/views
│   │   ├── call/{hooks, ui/components, ui/views, contracts.ts}
│   │   ├── dashboard/ui/components
│   │   ├── exercises/{server, types.ts}
│   │   ├── join/server
│   │   ├── notes/{server, ui}
│   │   ├── overview/ui/views
│   │   ├── patients/{hooks, params.ts, schemas.ts, server, types.ts, ui}
│   │   ├── prescriptions/{hooks, params.ts, schemas.ts, server, types.ts, ui}
│   │   └── sessions/{hooks, params.ts, schemas.ts, server, types.ts, ui}
│   └── trpc/{init.ts, client.tsx, server.tsx, query-client.ts, routers/_app.ts}
├── shared/
│   ├── exercises.json
│   ├── phrases.json
│   └── fixtures/{events,agent-callbacks,control}/*.json
├── scripts/{ensure-call-type.ts, dev-create-call.ts, ngrok.mjs}
├── drizzle/                                generated SQL migrations (committed; created by the first db:generate)
├── vitest.config.ts                        "@" alias + "server-only" stub
├── tests/ (vitest)                         join-token, signing, agent-events route, webhook routing, adherence, fixtures; stubs/empty.ts
├── agent/                                  uv project
│   ├── pyproject.toml, uv.lock, Dockerfile, README.md
│   ├── physiocoach/
│   │   ├── core/                           PURE: no vision_agents / aiortc / av imports (runs natively on Windows)
│   │   │   ├── exercises.py  angles.py  rep_engine.py  scoring.py  coach_rules.py
│   │   │   ├── note_llm.py   phrases.py contracts.py   safety.py   config.py
│   │   ├── pose/                           base.py  mediapipe_backend.py  yolo_backend.py  draw.py
│   │   ├── voice/                          cached_tts.py  google_tts.py  render_catalogue.py  wav.py
│   │   ├── call/                           processor.py  flow.py  inputs.py  bargein.py  outbox.py  no_llm.py  speaker.py
│   │   ├── control/                        api.py  supervisor.py  auth.py
│   │   ├── replay/                         cli.py  synthetic.py  player.py
│   │   └── agent_main.py                   explicit amain(cfg) → exit code (§8.14), run as `python -m physiocoach.agent_main --session-id <sid>`; Runner/AgentLauncher only as the documented alternative
│   ├── assets/voice/<voice_slug>/          manifest.json + {count,cue,cd,pos,intro,consent,note,pain,safety,misc}/*.wav
│   ├── models/                             pose_landmarker_*.task, yolo26n-pose.pt, silero_vad.onnx + SHA256SUMS (baked into the image)
│   ├── replay/clips/                       knee_test.mp4 (Milestone 2 test clip), knee_demo.mp4 (demo fallback); both recorded with consent
│   └── tests/{core, call, voice_contract, replay, contracts, smoke}/
├── Dockerfile                              web
├── docker-compose.yml                      dev: redis + agent-worker (+ optional web)
├── PHYSIOCOACH_MASTER_PROMPT.md            this file
└── APP_OVERVIEW.md
```

---

## 6. Data model

### 6.1 Full Drizzle schema (`src/db/schema.ts`, REPLACE)
Better Auth's `session`, `account` and `verification` tables are unchanged. `agents`, `meetings` and the `meeting_status` enum are dropped.

```ts
import { nanoid } from "nanoid";
import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, text, timestamp, boolean, integer, real, jsonb, date,
  primaryKey, index, uniqueIndex, check,
} from "drizzle-orm/pg-core";

/* ---------- enums ---------- */
export const userRole = pgEnum("user_role", ["patient", "physio"]);
export const preferredLanguage = pgEnum("preferred_language", ["ml", "en"]);
export const exerciseMode = pgEnum("exercise_mode", ["flex", "direct"]);
export const cameraView = pgEnum("camera_view", ["side", "front"]);
export const prescriptionSide = pgEnum("prescription_side", ["auto", "left", "right"]);
export const bodySide = pgEnum("body_side", ["left", "right"]);
export const callSessionStatus = pgEnum("call_session_status", ["scheduled", "live", "done", "failed"]);
export const callSessionMode = pgEnum("call_session_mode", ["live", "replay"]);
export const feedbackSource = pgEnum("feedback_source", ["rules", "llm"]);
export const setStopReason = pgEnum("set_stop_reason", ["completed", "idle", "stop_pressed", "pain", "symptom", "disconnected"]);
export const safetyKind = pgEnum("safety_kind", ["stop", "pain", "symptom", "agent_down"]);
export const safetySource = pgEnum("safety_source", ["agent", "ui", "webhook"]);

/* ---------- Better Auth: user extended via additionalFields ---------- */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(), // phone-only patients: p_<id>@patients.physiocoach.invalid (DEV-7)
  emailVerified: boolean("email_verified").$defaultFn(() => false).notNull(),
  image: text("image"),
  role: userRole("role").notNull().default("physio"),
  phone: text("phone").unique(),                             // NULL when absent, never "" (§4.4)
  preferredLanguage: preferredLanguage("preferred_language").notNull().default("ml"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()).notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
});

/* ---------- PhysioCoach domain ---------- */
export const physioPatientLinks = pgTable("physio_patient_links", {
  physioId: text("physio_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  patientId: text("patient_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.physioId, t.patientId] }),
  index("ppl_patient_idx").on(t.patientId),
]);

export const exercises = pgTable("exercises", {
  id: text("id").primaryKey(),                         // "knee_bend" | "elbow_bend" | "shoulder_raise"
  nameEn: text("name_en").notNull(),
  nameMl: text("name_ml").notNull(),
  joints: text("joints").array().notNull().$type<[string, string, string]>(), // [a, b(vertex), c]
  mode: exerciseMode("mode").notNull(),                // flex => value = 180 - angle; direct => value = angle
  rest: real("rest").notNull(),
  start: real("start").notNull(),
  minPeak: real("min_peak").notNull(),
  defaultTarget: integer("default_target").notNull(),
  cameraView: cameraView("camera_view").notNull().default("side"),
  howToEn: text("how_to_en").notNull(),
  howToMl: text("how_to_ml").notNull(),
});

export const prescriptions = pgTable("prescriptions", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  patientId: text("patient_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  physioId: text("physio_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  exerciseId: text("exercise_id").notNull().references(() => exercises.id, { onDelete: "restrict" }),
  side: prescriptionSide("side").notNull().default("auto"),
  targetAngle: integer("target_angle").notNull(),
  reps: integer("reps").notNull(),
  sets: integer("sets").notNull().default(1),                         // DEV-11
  minSecondsPerRep: real("min_seconds_per_rep").notNull().default(2),
  sessionsPerWeek: integer("sessions_per_week").notNull().default(5), // DEV-6
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("rx_patient_active_idx").on(t.patientId, t.active),
  index("rx_physio_idx").on(t.physioId),
  check("rx_target_range", sql`${t.targetAngle} between 10 and 180`),
  check("rx_reps_range", sql`${t.reps} between 1 and 30`),
  check("rx_sets_range", sql`${t.sets} between 1 and 5`),
]);

export const callSessions = pgTable("call_sessions", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),      // == streamCallId (pattern kept from meetings)
  patientId: text("patient_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  physioId: text("physio_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  prescriptionId: text("prescription_id").notNull().references(() => prescriptions.id, { onDelete: "cascade" }),
  streamCallId: text("stream_call_id").notNull().unique(),
  streamCallType: text("stream_call_type").notNull().default("default"),
  mode: callSessionMode("mode").notNull().default("live"),
  scheduledAt: timestamp("scheduled_at").notNull().defaultNow(),
  status: callSessionStatus("status").notNull().default("scheduled"),
  consentGivenAt: timestamp("consent_given_at"),
  agentPid: text("agent_pid"),                                 // "<worker-host>:<pid>"
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  failureReason: text("failure_reason"),                       // FailureReason union, agent-bridge/schemas.ts (§7.7)
  joinTokenHash: text("join_token_hash"),
  joinTokenExpiresAt: timestamp("join_token_expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("cs_patient_idx").on(t.patientId, t.scheduledAt),
  index("cs_physio_status_idx").on(t.physioId, t.status),
  index("cs_prescription_idx").on(t.prescriptionId),
]);

export type PerRep = { peak: number; seconds: number; tooFast: boolean };

export const setResults = pgTable("set_results", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  callSessionId: text("call_session_id").notNull().references(() => callSessions.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull().unique(),              // idempotency key from the agent
  setIndex: integer("set_index").notNull(),                  // 1-based
  repsDone: integer("reps_done").notNull(),
  repsPlanned: integer("reps_planned").notNull(),
  targetAngle: integer("target_angle").notNull(),            // snapshot of the prescription
  side: bodySide("side"),
  avgPeak: real("avg_peak").notNull(),
  bestPeak: real("best_peak").notNull(),
  lowestPeak: real("lowest_peak").notNull(),
  avgRepSeconds: real("avg_rep_seconds").notNull(),
  fastReps: integer("fast_reps").notNull().default(0),
  score: real("score").notNull(),                            // 0..100
  pain: integer("pain"),                                     // 0..10, null until entered
  feedbackMl: text("feedback_ml").notNull(),
  feedbackEn: text("feedback_en").notNull(),
  feedbackSource: feedbackSource("feedback_source").notNull().default("rules"),
  perRep: jsonb("per_rep").$type<PerRep[]>().notNull().default(sql`'[]'::jsonb`),
  stopReason: setStopReason("stop_reason").notNull().default("completed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("sr_session_set_idx").on(t.callSessionId, t.setIndex),
  check("sr_pain_range", sql`${t.pain} is null or ${t.pain} between 0 and 10`),
  check("sr_score_range", sql`${t.score} between 0 and 100`),
]);

export const safetyEvents = pgTable("safety_events", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  callSessionId: text("call_session_id").notNull().references(() => callSessions.id, { onDelete: "cascade" }),
  patientId: text("patient_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: safetyKind("kind").notNull(),
  symptom: text("symptom"),                                  // dizziness | chest_pain | sharp_pain
  painScore: integer("pain_score"),
  setIndex: integer("set_index"),
  source: safetySource("source").notNull(),
  clientEventId: text("client_event_id").notNull().unique(), // dedupes UI / agent / webhook copies: the triggering client eventId,
                                                             // or "agent_down:<sessionId>:<agentPid>" for agent_down (§7.6)
  acknowledgedAt: timestamp("acknowledged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("se_session_idx").on(t.callSessionId), index("se_patient_idx").on(t.patientId, t.createdAt)]);

export const physioNotes = pgTable("physio_notes", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  patientId: text("patient_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  physioId: text("physio_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("pn_patient_idx").on(t.patientId, t.createdAt)]);

export const weeklySummaries = pgTable("weekly_summaries", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  patientId: text("patient_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  weekStart: date("week_start").notNull(),                   // Monday, Asia/Kolkata
  sessionsDone: integer("sessions_done").notNull(),
  sessionsPlanned: integer("sessions_planned").notNull(),
  adherencePct: real("adherence_pct").notNull(),
  avgPeak: real("avg_peak"),
  bestPeak: real("best_peak"),
  maxPain: integer("max_pain"),
  textEn: text("text_en").notNull(),
  textMl: text("text_ml").notNull(),
  source: feedbackSource("source").notNull().default("rules"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("ws_patient_week_idx").on(t.patientId, t.weekStart)]);
```

**Spec field mapping** (spec name → column): `User.role/phone/email/preferred_language` → `user.*`; `PhysioPatientLink` → `physio_patient_links`; `Prescription.{side,target_angle,reps,min_seconds_per_rep,active,created_at}` → `prescriptions.*`; `Exercise.{joints,mode,rest,start,min_peak,default_target,how_to_en,how_to_ml}` → `exercises.*`; `CallSession.{stream_call_id,scheduled_at,status,consent_given_at,agent_pid}` → `call_sessions.*`; `SetResult.{reps_done,reps_planned,avg_peak,best_peak,lowest_peak,avg_rep_seconds,fast_reps,score,pain,feedback_ml,feedback_en,feedback_source,per_rep}` → `set_results.*`; `PhysioNote` → `physio_notes`.

### 6.2 Better Auth `additionalFields` (`src/lib/auth.ts`)
```ts
export const auth = betterAuth({
  emailAndPassword: { enabled: true },
  database: drizzleAdapter(db, { provider: "pg", schema: { ...schema } }),
  trustedOrigins: [process.env.NEXT_PUBLIC_APP_URL!, ...(process.env.NGROK_DOMAIN ? [`https://${process.env.NGROK_DOMAIN}`] : [])],
  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "physio", input: false }, // sign-up can never set it
      phone: { type: "string", required: false },
      preferredLanguage: { type: "string", required: false, defaultValue: "ml", input: false },
    },
  },
});
```
- Better Auth stores `role` as a string. The Postgres enum column accepts only `patient|physio`, so a bad value fails loudly. **[U]** Confirm that Better Auth's Drizzle adapter writes to a `pgEnum` column without complaint; if it does not, change `role` and `preferred_language` to `text` with a `check` constraint.
- Physios sign up through the existing form; `role` defaults to `physio`. Patients are created **only** by `patients.create` (no `account` row, so they can never log in). Optional: gate sign-up with `ALLOW_SIGNUP=true`.

### 6.3 Exercise seed (`shared/exercises.json`)
Exact numbers from the spec. Angles in degrees; `rest`, `start` and `minPeak` apply to the **mode-adjusted value** (flex: `180 − angle`; direct: `angle`).

```json
[
  {
    "id": "knee_bend",
    "nameEn": "Knee bend",
    "nameMl": "കാൽമുട്ട് മടക്കൽ",
    "joints": ["hip", "knee", "ankle"],
    "mode": "flex",
    "rest": 15, "start": 25, "minPeak": 35, "defaultTarget": 60,
    "cameraView": "side",
    "howToEn": "Stand side-on to the camera, holding a chair for support. Slowly bend your knee, then straighten it fully.",
    "howToMl": "ഒരു കസേരയിൽ പിടിച്ച് ക്യാമറയിലേക്ക് വശം തിരിഞ്ഞ് നിൽക്കുക. പതുക്കെ കാൽമുട്ട് മടക്കുക, പിന്നെ പൂർണ്ണമായി നിവർത്തുക."
  },
  {
    "id": "elbow_bend",
    "nameEn": "Elbow bend",
    "nameMl": "കൈമുട്ട് മടക്കൽ",
    "joints": ["shoulder", "elbow", "wrist"],
    "mode": "flex",
    "rest": 20, "start": 30, "minPeak": 45, "defaultTarget": 100,
    "cameraView": "side",
    "howToEn": "Sit or stand side-on to the camera with your arm by your side. Bend your elbow to bring your hand up, then lower it fully.",
    "howToMl": "കൈ വശത്ത് വെച്ച് ക്യാമറയിലേക്ക് വശം തിരിഞ്ഞ് ഇരിക്കുക അല്ലെങ്കിൽ നിൽക്കുക. കൈമുട്ട് മടക്കി കൈ ഉയർത്തുക, പിന്നെ പൂർണ്ണമായി താഴ്ത്തുക."
  },
  {
    "id": "shoulder_raise",
    "nameEn": "Shoulder raise",
    "nameMl": "തോൾ ഉയർത്തൽ",
    "joints": ["hip", "shoulder", "elbow"],
    "mode": "direct",
    "rest": 30, "start": 40, "minPeak": 50, "defaultTarget": 90,
    "cameraView": "front",
    "howToEn": "Stand facing the camera. Keep your elbow straight and slowly raise your arm out to the side, then lower it.",
    "howToMl": "ക്യാമറയ്ക്ക് അഭിമുഖമായി നിൽക്കുക. കൈമുട്ട് നിവർത്തി പിടിച്ച് പതുക്കെ കൈ വശത്തേക്ക് ഉയർത്തുക, പിന്നെ താഴ്ത്തുക."
  }
]
```
**Native-speaker review required** for every `nameMl` and `howToMl` (draft wordings). `cameraView` is the DEV-6 extension.

### 6.4 Migration steps from the current schema
The repo has **no `./drizzle` folder and no migration history**; it has only ever used `db:push`. So the first `drizzle-kit generate` emits a single migration that **creates every table from scratch**, including Better Auth's `user`, `session`, `account` and `verification`. It will not emit any DROP or ALTER statements. Running it on a Neon branch that copied the current data would fail with `relation "user" already exists`.
1. Ask the user for an **EMPTY** Postgres database: a new Neon database, or a Neon branch created with the "schema only / empty" option. **Do not use a data-copy child branch.** Set `DATABASE_URL` to it. Never run DDL against the current Meet.AI database.
2. Replace `src/db/schema.ts` with §6.1.
3. `npm run db:generate` → commit the SQL under `./drizzle`. Read the first migration (`0000_*.sql`) and confirm it creates `user` with `role`, `phone` and `preferred_language`, the Better Auth tables, all new tables and all enums.
4. `npm run db:migrate`, then `npm run db:seed` (exercises), then `npm run db:seed -- --demo` (optional demo data, DEV-14).
5. On the empty database, physios sign up again. The old Meet.AI database is left untouched and is not migrated. **If the user wants to keep existing users, STOP AND REPORT instead:** generating a baseline from the current schema and marking it applied in `drizzle.__drizzle_migrations` is a separate, manual task.

---

## 7. API surface and contracts

### 7.1 tRPC routers
`appRouter = { patients, exercises, prescriptions, sessions, join, analytics, notes }`. Every list returns `{ items, total, totalPages }` with the existing `DEFAULT_PAGE`/`DEFAULT_PAGE_SIZE`/`MIN_PAGE_SIZE`/`MAX_PAGE_SIZE` pattern. **Every physio query is scoped to `ctx.auth.user.id`**: through `physio_patient_links` for patients, and through `physioId` columns for everything else. Every mutation that takes an id re-checks ownership and throws `NOT_FOUND` (not `FORBIDDEN`) for rows the physio does not own.

**`patients`** (`physioProcedure`)
| Procedure | Type | Input | Output |
|---|---|---|---|
| `getMany` | query | `{page, pageSize, search?}` | items: `User & {sessionCount, activePrescriptionCount, lastSessionAt: Date\|null, latestPain: number\|null}` |
| `getOne` | query | `{id}` | the same single row |
| `create` | mutation | `patientsInsertSchema` | `User` (user + link inserted with `db.batch`) |
| `update` | mutation | `patientsUpdateSchema` | `User` |
| `remove` | mutation | `{id}` | `{id}` |

**`exercises`** (`protectedProcedure`)
| `getMany` | query | — | `Exercise[]` |
|---|---|---|---|
| `getOne` | query | `{id}` | `Exercise` |

**`prescriptions`** (`physioProcedure`)
| Procedure | Type | Input | Output |
|---|---|---|---|
| `getMany` | query | `{page, pageSize, search?, patientId?, exerciseId?, active?}` | items: `Prescription & {patient:{id,name,image}, exercise:{id,nameEn,nameMl}, sessionCount, lastScore: number\|null}` |
| `getOne` | query | `{id}` | the same row plus the full `exercise` |
| `create` | mutation | `prescriptionsInsertSchema` | `Prescription` (checks the link and `targetAngle >= exercise.minPeak`, else `BAD_REQUEST` "Target must be at least {minPeak}°") |
| `update` | mutation | `prescriptionsUpdateSchema` | `Prescription` |
| `remove` | mutation | `{id}` | `{id, deactivated: boolean}` (soft-deactivates when sessions exist) |

**`sessions`** (`physioProcedure`)
| Procedure | Type | Input | Output |
|---|---|---|---|
| `getMany` | query | `{page, pageSize, search?, patientId?, prescriptionId?, status?}` | items: `CallSession & {patient, exercise:{id,nameEn,nameMl}, prescription:{targetAngle,reps,sets,minSecondsPerRep}, duration: number\|null, setCount, bestScore, maxPain}` (applies the lazy join-timeout check, §7.4) |
| `getOne` | query | `{id}` | the same row plus `hasActiveJoinLink`, `joinTokenExpiresAt`, `openSafetyEvents: SafetyEvent[]` (applies the lazy join-timeout check, §7.4) |
| `getResults` | query | `{id}` | `SetResult[]` ordered by `setIndex` |
| `start` | mutation | `sessionsStartSchema` | `{ session: CallSession, joinUrl: string }` (§7.4) |
| `regenerateJoinLink` | mutation | `{id}` | `{ joinUrl, expiresAt }` (new hash; the old link stops working) |
| `cancel` | mutation | `{id}` | `CallSession` (`scheduled` → `failed`, `failureReason="cancelled"`; also `stopAgent` + `call.end()`) |
| `end` | mutation | `{id}` | `CallSession` (`stopAgent`, then `endGuidedCall`; status settles via the callback/webhook) |
| `restartAgent` | mutation | `{id}` | `{ agentPid }`. Only while `live`. Worker `DELETE` (with `reason: "restart"`, so the old agent skips `bye`), then **poll `GET /sessions/{id}` until 404** (up to 12 s; the worker SIGKILLs after 10 s), then `POST`. Otherwise two agents with the same user id are briefly in the call. `startSetIndex = max(setIndex)+1`; `consentGiven = consentGivenAt != null`, so the new agent goes straight to positioning (it announces that it is resuming). |
| `acknowledgeSafety` | mutation | `{safetyEventId}` | `SafetyEvent` |
| `sendInput` | mutation | `{id, event: ClientToAgentEvent}` (only `pc.stop` accepted) | `{ ok: true }`: physio-authenticated twin of `join.sendInput`. Writes `safety_events{kind:"stop", source:"ui", clientEventId: event.eventId}` immediately (`onConflictDoNothing`), then forwards to the worker `POST /sessions/{id}/input`. |
| `physioToken` | mutation | — | `string` (Stream user token, 3600 s, app role `user`) |

**`join`** (`baseProcedure` + `requireJoin(token)` + rate limit; public, for patients)
| Procedure | Type | Input | Output |
|---|---|---|---|
| `resolve` | query | `{token}` | `{ sessionId, streamCallId, callType, status, patient:{id,name,image,preferredLanguage}, exercise:{id,nameEn,nameMl,howToEn,howToMl,cameraView,mode}, prescription:{targetAngle,reps,sets,minSecondsPerRep} }` |
| `streamToken` | mutation | `{token}` | `string`: `generateCallToken` scoped to this call, role `call_member`, 7200 s; only while status is `scheduled` or `live` |
| `sendInput` | mutation | `{token, event: ClientToAgentEvent}` | `{ ok: true }`: writes `safety_events` immediately for stop, symptom and pain ≥ 7 (source `ui`, `clientEventId = event.eventId`, `onConflictDoNothing`), then forwards to the worker `POST /sessions/{id}/input` (redundant input path, §7.8) |

**`analytics`** (`physioProcedure`)
| Procedure | Type | Input | Output |
|---|---|---|---|
| `overview` | query | — | `{ liveSessions, sessionsThisWeek, openPainFlags, activePatients }` |
| `romTrend` | query | `{patientId, prescriptionId?, days?: number = 30, includeReplay?: boolean = false}` | `{ targetAngle, points: {date, sessionId, avgPeak, bestPeak, score, isReplay}[] }` (excludes `mode = "replay"` unless `includeReplay`; DEV-14) |
| `adherence` | query | `{patientId?, weekStart?, includeReplay?: boolean = false}` | `{ patientId, name, planned, done, pct }[]` (done = sessions this week with ≥ 1 set, live mode only unless `includeReplay`; planned = Σ `sessionsPerWeek` of active prescriptions) |
| `painFlags` | query | `{days?: number = 7}` | `{ id, sessionId, patient:{id,name}, kind, symptom, painScore, at, acknowledgedAt }[]` from `safety_events` |
| `weeklySummary` | query | `{patientId, weekStart?, includeReplay?: boolean = false}` | `{ sessionsDone, sessionsPlanned, adherencePct, avgPeak, avgPeakDeltaVsLastWeek, bestPeak, maxPain, fastRepPct, textEn, textMl, source }` (stored row if present, otherwise computed live with rule text) |
| `generateWeeklySummary` | mutation | `{patientId, weekStart?}` | the same, after calling `claude-sonnet-5-5` with rule fallback and upserting `weekly_summaries` (§8.9) |

**`notes`** (`physioProcedure`)
| `getMany` | query | `{patientId}` | `PhysioNote[]` |
|---|---|---|---|
| `create` | mutation | `{patientId, text: z.string().min(1).max(4000)}` | `PhysioNote` |
| `remove` | mutation | `{id}` | `{id}` |

The dashboard passes `includeReplay: true` only when `NEXT_PUBLIC_DEMO_MODE=true` (DEV-14) and draws replay points with a distinct marker and a "demo" badge.

**Week boundaries:** weeks start Monday 00:00 in `Asia/Kolkata`. Compute them in SQL with `date_trunc('week', (ts AT TIME ZONE 'Asia/Kolkata'))`.

### 7.2 Signed patient link (`src/lib/join-token.ts`)
- URL: `${NEXT_PUBLIC_APP_URL}/join/<token>`.
- Token: `base64url(JSON{sub: patientId, csid: callSessionId, exp, v: 1}) + "." + base64url(HMAC-SHA256(JOIN_LINK_SECRET, body))`, built with `node:crypto` (no new dependency).
- Only `sha256(token)` is stored, in `call_sessions.joinTokenHash` (plus `joinTokenExpiresAt`). Regenerating overwrites the hash, which revokes the old link.
- Lifetime `JOIN_LINK_TTL_HOURS = 12`. The link only works while the session is `scheduled` or `live`.
- `requireJoin(token)` checks, in order: shape → HMAC with `timingSafeEqual` → `v === 1` → not expired → session exists → `sha256(token) === joinTokenHash` → `patientId === sub` → status in (`scheduled`,`live`). Any failure → `UNAUTHORIZED` with a generic message.

```ts
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const SECRET = () => {
  const s = process.env.JOIN_LINK_SECRET;
  if (!s || s.length < 32) throw new Error("JOIN_LINK_SECRET missing or too short");
  return s;
};
export type JoinClaims = { sub: string; csid: string; exp: number; v: 1 };
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (body: string) => createHmac("sha256", SECRET()).update(body).digest();
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createJoinToken(patientId: string, callSessionId: string, ttlSec: number) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = b64u(JSON.stringify({ sub: patientId, csid: callSessionId, exp, v: 1 } satisfies JoinClaims));
  const token = `${body}.${b64u(sign(body))}`;
  return { token, hash: hashToken(token), expiresAt: new Date(exp * 1000) };
}

export function verifyJoinToken(token: string): JoinClaims | null {
  if (token.length > 1024) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString()) as JoinClaims;
    if (c.v !== 1 || typeof c.exp !== "number" || c.exp < Math.floor(Date.now() / 1000)) return null;
    return c;
  } catch { return null; }
}
```
The token is a bearer credential. Never log it. Rate-limit `join.*` (`lib/rate-limit.ts`). Because it sits in the URL path, it can leak through the `Referer` header and request logs: serve `/join/*` with `Referrer-Policy: no-referrer` (`next.config.ts` `headers()`, §4.1), load no third-party resources on that page other than Stream, and configure Traefik/Dokploy access logs to drop or redact paths matching `/join/` (§13.2). Optional hardening: on first load exchange the path token for an httpOnly cookie and redirect to `/join` with no token in the URL.

### 7.3 Stream: call type, call creation, tokens (`src/lib/stream-video.ts`)
Verified facts [V] (for node-sdk **0.4.26**; the lockfile has 0.4.24, so pin 0.4.26 in Milestone 0 before relying on them): node-sdk 0.4.26 has `getOrCreate({ data: { created_by_id, members: [{user_id, role, custom}], custom, settings_override } })`; `RecordSettingsRequest.mode` and `TranscriptionSettingsRequest.mode`/`closed_caption_mode` take `'available'|'disabled'|'auto-on'`; `LimitsSettingsRequest { max_duration_seconds, max_participants }`; `generateUserToken({ user_id, validity_in_seconds?, exp?, iat? })` (an explicit `exp` wins); `generateCallToken({ user_id, call_cids, role?, validity_in_seconds? })`; `call.end()` needs the `end-call` capability; `streamVideo.verifyWebhook(body, signature)`; `createCallType({ name, grants, settings })`. Stream's transcription language enum has no `ml`, so native captions cannot do Malayalam anyway [V].

```ts
import "server-only";
import { StreamClient } from "@stream-io/node-sdk";

export const streamVideo = new StreamClient(
  process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY!,
  process.env.STREAM_VIDEO_SECRET_KEY!,
  { timeout: 10_000 },
);

export const CALL_TYPE = process.env.STREAM_CALL_TYPE ?? "default"; // "physio_session" once verified
export const AGENT_USER_ID = process.env.NEXT_PUBLIC_STREAM_AGENT_USER_ID ?? "physiocoach-agent";
export const callCid = (callId: string, type = CALL_TYPE) => `${type}:${callId}`;

/** Spec: store no media. Applied per call AND on the call type. */
const NO_MEDIA_STORAGE = {
  recording: { mode: "disabled" as const },
  transcription: { mode: "disabled" as const, closed_caption_mode: "disabled" as const },
  individual_recording: { mode: "disabled" as const },
  raw_recording: { mode: "disabled" as const },
  // frame_recording requires capture_interval_in_seconds even when disabled [V type]; disable it on the call type.
};

type Person = { id: string; name: string; image?: string | null };

export async function upsertStreamUsers(people: (Person & { appRole: "physio" | "patient" | "agent" })[]) {
  await streamVideo.upsertUsers(people.map((p) => ({
    id: p.id, name: p.name, image: p.image ?? undefined,
    role: "user",                                   // NEVER "admin"
    custom: { app_role: p.appRole },
  })));
}

export async function createGuidedCall(o: {
  callId: string; callSessionId: string; prescriptionId: string; exerciseId: string;
  physio: Person; patient: Person; mode: "live" | "replay";
}) {
  await upsertStreamUsers([
    { ...o.physio, appRole: "physio" },
    { ...o.patient, appRole: "patient" },
    { id: AGENT_USER_ID, name: "PhysioCoach", appRole: "agent" },
  ]);
  const call = streamVideo.video.call(CALL_TYPE, o.callId);
  const res = await call.getOrCreate({
    data: {
      created_by_id: o.physio.id,
      members: [
        { user_id: o.physio.id, role: "admin", custom: { app_role: "physio" } },   // call-level admin → can end the call
        { user_id: o.patient.id, role: "call_member", custom: { app_role: "patient" } },
        { user_id: AGENT_USER_ID, role: "call_member", custom: { app_role: "agent" } },
      ],
      custom: {
        app: "physiocoach", callSessionId: o.callSessionId, prescriptionId: o.prescriptionId,
        exerciseId: o.exerciseId, patientId: o.patient.id, physioId: o.physio.id, mode: o.mode,
      },
      settings_override: {
        ...NO_MEDIA_STORAGE,
        limits: { max_duration_seconds: 60 * 60, max_participants: 4 },
      },
    },
  });
  return res.call;
}

export const createPhysioUserToken = (userId: string) =>
  streamVideo.generateUserToken({ user_id: userId, validity_in_seconds: 60 * 60 }); // fixes the timestamp-as-duration bug

export const createPatientCallToken = (patientId: string, callId: string, type = CALL_TYPE) =>
  streamVideo.generateCallToken({ user_id: patientId, call_cids: [callCid(callId, type)], role: "call_member", validity_in_seconds: 2 * 60 * 60 });

export const endGuidedCall = (callId: string, type = CALL_TYPE) => streamVideo.video.call(type, callId).end();
```
- **[U]** Whether `settings_override` accepts `individual_recording`/`raw_recording` keys in node-sdk 0.4.26 typings. If the type checker rejects them, drop them from the per-call override and rely on the call type. Do **not** cast to `any` to silence a real API rejection: run a real `getOrCreate` and read the response's `settings`.
- `scripts/ensure-call-type.ts` (run once, `npm run stream:call-type`):
```ts
await streamVideo.video.createCallType({
  name: "physio_session",
  grants: {
    user: ["read-call"],
    call_member: ["read-call", "join-call", "send-audio", "send-video"],
    admin: ["read-call", "join-call", "send-audio", "send-video", "end-call", "update-call-member"],
  },
  settings: {
    recording: { mode: "disabled" },
    transcription: { mode: "disabled", closed_caption_mode: "disabled" },
    frame_recording: { mode: "disabled", capture_interval_in_seconds: 5 },  // [U] server validation
    individual_recording: { mode: "disabled" },
    raw_recording: { mode: "disabled" },
    backstage: { enabled: false },
  },
});
```
- **[U] The grant list above is hand-written.** Whether patient `call.sendCustomEvent` and the agent's server-side `send_call_event` need a capability this replacement set removes is unverified; if one is needed, consent, Stop and pain would all fail with 403 after the switch and only the backup tRPC path would work. Before writing the script's final grant list, read the current `call_member`/`user` grants with `streamVideo.video.getCallType({ name: "default" })` and copy every event/reaction-related capability into the new grants. Before switching `STREAM_CALL_TYPE`, run the Spike A custom-event smoke test (browser → agent and agent → browser) on a `physio_session` call.
- **[I]/[U]** Grants semantics: `createCallType` grants replace the grants for the listed roles. **Call tokens grant access; they do not restrict it** [V docs]. Until the user confirms in the Stream dashboard (Video & Audio → Roles & Permissions) that `user` lacks `join-call` and `create-call` on `physio_session`, keep `STREAM_CALL_TYPE=default`. On `default`, the protection is only the unguessable nanoid call id. **STOP AND REPORT** after running the script (Milestone 5 checkpoint).
- Stream custom events are **max 5 KB** and are delivered to clients **watching** the call [V].

### 7.4 "Start guided session" sequence (`sessions.start`)
Total time ≈ 1–2 s. Must be idempotent per click (disable the button while pending).
1. Load the prescription with its exercise and patient. Check the physio–patient link, `active = true`, and `targetAngle >= exercise.minPeak`. If `mode = "replay"`, check that `clip` is in the allow-list `AGENT_REPLAY_CLIPS` (comma-separated env).
2. `const id = nanoid()`. Insert `call_sessions { id, streamCallId: id, streamCallType: CALL_TYPE, status: "scheduled", mode, physioId, patientId, prescriptionId }`.
3. `createGuidedCall(...)`. **The call must exist before the agent starts**, otherwise the agent's own `get_or_create` would create it with the type defaults [V].
4. `startAgent({...})`: HMAC-signed `POST {AGENT_WORKER_URL}/sessions` (body = `StartAgentRequest`, §7.7), idempotent on `sessionId`. The worker returns `{ pid, host }`; write `agentPid = "host:pid"`. On failure: status `failed`, `failureReason = "agent_start_failed"`, `endGuidedCall(id)`, throw `INTERNAL_SERVER_ERROR` with "Could not start the coach. Try again." (the UI shows a toast).
5. `createJoinToken(patientId, id, JOIN_LINK_TTL_HOURS * 3600)`; store `joinTokenHash` and `joinTokenExpiresAt`.
6. Return `{ session, joinUrl }`. The UI opens `JoinLinkDialog`.

The status changes to `live` when the agent posts `agent_joined` (or when Stream sends `call.session_started`, whichever comes first; both are idempotent).

**Join-timeout producer (no scheduler in v1):** if `agent_joined` has not arrived within **90 s**, the session becomes `failed`/`agent_join_timeout` and `endGuidedCall` runs. This is checked lazily in `sessions.getOne`/`getMany` (a `scheduled` row whose `createdAt` is more than 90 s ago and whose `startedAt` is still null; the agent posts `agent_joined` as soon as it is in the call, before the patient arrives), and by the worker reaper reporting the child as exited. Without it, a session whose agent never joins would stay `scheduled` forever.

### 7.5 Stream webhook (`src/app/api/webhook/route.ts`, MODIFY)
**Keep:** `verifySignatureWithSDK(body, signature)`, the missing-header check, JSON parsing, and the `call_cid.split(":")[1]` pattern.
**Add:** reject with 401 when `x-api-key !== process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY`. Derive `callId = event.call?.id ?? event.call_cid?.split(":")[1]`. Look up `call_sessions` by `streamCallId`. **Return 200 `{status:"ignored"}` for unknown calls and unhandled events** (today's 400/404 responses trigger retries).
**Remove:** the `OpenAI` import and client, `connectOpenAi`/`updateSession`, `message.new` + GPT-4o, `call.transcription_ready`, `call.recording_ready`, `streamChat`, `generateAvatarUri`, `inngest.send`, and the unconditional `call.end()`.

| Event | Action |
|---|---|
| `call.session_started` | If `scheduled` → `live`, `startedAt = now` (idempotent). |
| `call.session_participant_joined` | Record only (optional log). |
| `call.session_participant_left` | **Never end the call.** If the participant is `AGENT_USER_ID` while `live`, call `getAgent(sessionId)`; if the worker reports it dead, write a `safety_events{kind:"agent_down", source:"webhook", clientEventId: \`agent_down:${sessionId}:${agentPid}\`}` row (`onConflictDoNothing`; the exit handler uses the same key, so only one row exists) so the physio sees "Coach disconnected – Restart". Patient leaving is handled by the agent's own timeout (exit 4). |
| `custom` | Backstop: if `custom.type` is `pc.stop`, `pc.symptom`, or `pc.pain_score` with `score >= 7`, insert `safety_events` with `source: "webhook"` and `clientEventId = custom.eventId` (`onConflictDoNothing`). **[U]** Whether `custom` events reach webhooks needs a live payload check; treat this as a backstop only. |
| `call.session_ended`, `call.ended` | If not already final: `done` if any `set_results` exist, else `failed` (`failureReason ??= "no_sets"`); `endedAt = now`; `stopAgent(sessionId)` (ignore 404). |

### 7.6 Worker → web callbacks (`src/app/api/agent/events/route.ts`, NEW)
- Header `x-pc-signature: t=<unix>,v1=<hex HMAC-SHA256(AGENT_CALLBACK_SECRET, "<t>.POST./api/agent/events.<sha256hex(rawBody)>")>` (the canonical form from `lib/signing.ts`, §4.3). Reject if missing, invalid, or `|now − t| > 300 s`. Compare with `timingSafeEqual`.
- Body: `AgentCallback` zod discriminated union (§7.7). Every event carries `eventId` and `sessionId`. Handlers are idempotent.

| `type` | Effect |
|---|---|
| `agent_joined` | `agentPid = host:pid` (if given); status `scheduled` → `live`; `startedAt ??= now`. |
| `consent_given` | `consentGivenAt ??= at`. |
| `set_result` | Upsert `set_results` on `(callSessionId, setIndex)` (`eventId` unique). |
| `pain_recorded` | `set_results.pain = score` for `(sessionId, setIndex)`. **No safety insert here**: for score ≥ 7 the agent also posts `safety_alert` with the same `clientEventId`, which is the single writer of that row. |
| `safety_alert` | Insert `safety_events` (`onConflictDoNothing` on `clientEventId`); update the current set's `stopReason` if the set row exists. `clientEventId` is **always the triggering client `eventId`** (the patient's `pc.stop`/`pc.symptom`/`pc.pain_score` event), never a new id, so the UI, webhook and agent copies dedupe to one row. |
| `agent_exited` | Map the exit code (§8.14) to the final status/`failureReason`, unless already final. For a crash, insert `safety_events{kind:"agent_down", source:"agent", clientEventId: \`agent_down:${sessionId}:${agentPid}\`}` (`onConflictDoNothing`). |
| `heartbeat` | Optional; no DB write (used only in dev logging). |

Return `200 {ok:true}` for success and for duplicates; `400` for a schema failure (the worker moves it to its dead-letter list and does **not** retry); `401` for a bad signature (the worker re-signs and retries a few times, §8.16); `5xx` only for real DB failures (the worker retries).

### 7.7 Shared contracts: custom events, callbacks and control payloads
**Single source:** `src/modules/agent-bridge/schemas.ts` (zod) is authoritative. `agent/physiocoach/core/contracts.py` (pydantic v2) mirrors it. `shared/fixtures/**.json` holds at least one valid and one invalid example per type; **both** vitest and pytest parse every fixture, so drift fails CI. When you change a contract, change zod, pydantic and fixtures in the same step.

**Custom-event envelope** (Stream `call.sendCustomEvent(payload)` / `agent.send_custom_event(payload)`): every payload is a flat object `{ type, v: 1, eventId, ts, ...fields }`, under 5 KB. `eventId` is a client-generated `nanoid()`/`uuid4().hex`; `ts` is epoch ms.

Client → agent (sent by the patient UI, or by the physio for `pc.stop`):
| type | fields | rules |
|---|---|---|
| `pc.consent` | `{ agreed: true }` | Patient only. Re-sent every 2 s until `pc.state.phase` moves past `await_consent`. |
| `pc.stop` | `{ reason: "button" }` | Patient or physio. Always accepted, in any phase. |
| `pc.pain_score` | `{ score: 0..10 (int), setIndex: int ≥ 1 }` | Patient only. Accepted in any phase; ≥ 7 triggers the safety stop. |
| `pc.symptom` | `{ kind: "dizziness" \| "chest_pain" \| "sharp_pain" }` | Patient only. Always triggers the safety stop. |

Agent → all clients:
| type | fields | when |
|---|---|---|
| `pc.ready` | `{ agentVersion: string }` | Once after join, and re-sent every 5 s until the first client input arrives (handshake). |
| `pc.state` | `{ phase, setIndex, setsPlanned, reason?: string }` | On every phase change. `phase ∈ greeting \| await_consent \| positioning \| countdown \| set \| summary \| await_pain \| rest \| done \| halted`. |
| `pc.rep` | `{ setIndex, n, peak, seconds, tooFast, target, repsPlanned }` | One per counted rep. **Never per frame.** |
| `pc.caption` | `{ id, ml (≤ 400 chars), en (≤ 400 chars), kind: "count" \| "cue" \| "note" \| "prompt" \| "safety" }` | Every time the agent speaks (sent just before the audio, fire-and-forget, §8.10). Malayalam is 3 bytes per character in UTF-8, so before sending check `len(json.dumps(payload, ensure_ascii=False).encode()) <= 4800`; if it is over, send `ml` and `en` as two caption events with the same `id`. |
| `pc.set_summary` | `{ setIndex, repsDone, repsPlanned, avgPeak, bestPeak, target, fastReps, score, feedbackSource }` | After each set (the full row goes to the DB through the callback, not over the event). |
| `pc.request_pain` | `{ setIndex }` | When the agent asks for the pain score. The UI highlights the pain scale. |
| `pc.safety_alert` | `{ reason: "pain" \| "stop" \| "symptom" \| "agent_down", score?: int, symptom?: string, setIndex?: int }` | On any safety stop. Physio UI shows a red banner. |

**Validation on receipt (both sides):** check the envelope and `v === 1`; ignore unknown types; **check the sender** (`e.user.id`): clients accept agent types only from `AGENT_USER_ID`; the agent accepts `pc.consent`/`pc.pain_score`/`pc.symptom` only from `call.custom.patientId` and `pc.stop` from the patient or `call.custom.physioId`; the agent drops its own events. The agent dedupes inputs by `eventId` (LRU of the last 512).

```ts
// src/modules/agent-bridge/schemas.ts (excerpt; write the full file)
import { z } from "zod";
const env = { v: z.literal(1), eventId: z.string().min(8).max(64), ts: z.number().int() };
export const Phase = z.enum(["greeting","await_consent","positioning","countdown","set","summary","await_pain","rest","done","halted"]);

export const ClientToAgentEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pc.consent"), ...env, agreed: z.literal(true) }),
  z.object({ type: z.literal("pc.stop"), ...env, reason: z.literal("button") }),
  z.object({ type: z.literal("pc.pain_score"), ...env, score: z.number().int().min(0).max(10), setIndex: z.number().int().min(1) }),
  z.object({ type: z.literal("pc.symptom"), ...env, kind: z.enum(["dizziness","chest_pain","sharp_pain"]) }),
]);
export const AgentToClientEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pc.ready"), ...env, agentVersion: z.string() }),
  z.object({ type: z.literal("pc.state"), ...env, phase: Phase, setIndex: z.number().int().min(0), setsPlanned: z.number().int().min(1), reason: z.string().optional() }),
  z.object({ type: z.literal("pc.rep"), ...env, setIndex: z.number().int(), n: z.number().int().min(1), peak: z.number(), seconds: z.number(), tooFast: z.boolean(), target: z.number(), repsPlanned: z.number().int() }),
  z.object({ type: z.literal("pc.caption"), ...env, id: z.string(), ml: z.string().max(400), en: z.string().max(400), kind: z.enum(["count","cue","note","prompt","safety"]) }),
  z.object({ type: z.literal("pc.set_summary"), ...env, setIndex: z.number().int(), repsDone: z.number().int(), repsPlanned: z.number().int(), avgPeak: z.number(), bestPeak: z.number(), target: z.number(), fastReps: z.number().int(), score: z.number().min(0).max(100), feedbackSource: z.enum(["rules","llm"]) }),
  z.object({ type: z.literal("pc.request_pain"), ...env, setIndex: z.number().int() }),
  z.object({ type: z.literal("pc.safety_alert"), ...env, reason: z.enum(["pain","stop","symptom","agent_down"]), score: z.number().int().optional(), symptom: z.string().optional(), setIndex: z.number().int().optional() }),
]);
export type ClientToAgentEvent = z.infer<typeof ClientToAgentEvent>;
export type AgentToClientEvent = z.infer<typeof AgentToClientEvent>;

const cb = { eventId: z.string().min(8).max(64), sessionId: z.string().min(1) };
export const PerRepSchema = z.object({ peak: z.number(), seconds: z.number(), tooFast: z.boolean() });
export const AgentCallback = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent_joined"), ...cb, pid: z.number().int(), host: z.string() }),
  z.object({ type: z.literal("consent_given"), ...cb, at: z.string().datetime() }),
  z.object({ type: z.literal("set_result"), ...cb, setIndex: z.number().int().min(1), repsDone: z.number().int().min(0), repsPlanned: z.number().int(),
    targetAngle: z.number().int(), side: z.enum(["left","right"]).nullable(), avgPeak: z.number(), bestPeak: z.number(), lowestPeak: z.number(),
    avgRepSeconds: z.number(), fastReps: z.number().int(), score: z.number().min(0).max(100), perRep: z.array(PerRepSchema).max(60),
    feedbackMl: z.string().max(2000), feedbackEn: z.string().max(2000), feedbackSource: z.enum(["rules","llm"]),
    stopReason: z.enum(["completed","idle","stop_pressed","pain","symptom","disconnected"]) }),
  z.object({ type: z.literal("pain_recorded"), ...cb, setIndex: z.number().int().min(1), score: z.number().int().min(0).max(10),
    clientEventId: z.string() }),                         // the patient's original pc.pain_score eventId
  z.object({ type: z.literal("safety_alert"), ...cb, kind: z.enum(["stop","pain","symptom","agent_down"]), symptom: z.string().optional(),
    painScore: z.number().int().optional(), setIndex: z.number().int().optional(),
    clientEventId: z.string() }),                         // ALWAYS the triggering client eventId, never a new id
  z.object({ type: z.literal("agent_exited"), ...cb, code: z.number().int(), signal: z.string().nullable(), setsCompleted: z.number().int() }),
  z.object({ type: z.literal("heartbeat"), ...cb }),
]);

export const FailureReason = z.enum(["cancelled","agent_start_failed","agent_join_timeout","patient_never_joined",
  "patient_left","no_consent","no_sets","agent_crashed"]);   // the ONLY values ever written to call_sessions.failure_reason

export const StartAgentRequest = z.object({
  sessionId: z.string(), callType: z.string(), callId: z.string(), agentUserId: z.string(),
  patient: z.object({ id: z.string(), name: z.string(), lang: z.enum(["ml","en"]) }),
  physioId: z.string(),
  exercise: z.object({ id: z.string(), joints: z.tuple([z.string(), z.string(), z.string()]), mode: z.enum(["flex","direct"]),
    rest: z.number(), start: z.number(), minPeak: z.number(), cameraView: z.enum(["side","front"]) }),
  prescription: z.object({ side: z.enum(["auto","left","right"]), targetAngle: z.number().int(), reps: z.number().int(), sets: z.number().int(), minSecondsPerRep: z.number() }),
  mode: z.enum(["live","replay"]), clip: z.string().optional(), startSetIndex: z.number().int().min(1).default(1),
  consentGiven: z.boolean().default(false),                // true on restartAgent when consentGivenAt is set
});
```
The Python mirror uses `pydantic.BaseModel` with `Literal` discriminators and `TypeAdapter(Annotated[Union[...], Field(discriminator="type")])`.

### 7.8 Redundant input path
Every patient input is sent **twice**: as a Stream custom event (primary, low latency) and through `join.sendInput({ token, event })` (backup). Next.js writes `safety_events` right away for stop, symptom and pain ≥ 7 (so the physio is alerted even if the agent is dead), then forwards the event to the worker `POST /sessions/{id}/input`, which publishes it on Redis `pc:input:{sessionId}`. The agent subscribes and dedupes by `eventId`; whichever copy arrives first wins. The physio's Stop button does the same through `sessions.sendInput` (physio-authenticated, §7.1) instead of `join.sendInput`; `useSendInput({ viewer, sessionId?, joinToken? })` picks the right backup procedure.

### 7.9 Agent-worker control API (FastAPI, internal only)
Auth: `x-pc-signature: t=<ts>,v1=HMAC-SHA256(AGENT_CONTROL_SECRET, "<t>.<METHOD>.<pathWithQuery>.<sha256hex(body)>")` (body = empty bytes for GET/DELETE), max age 300 s, verified in `control/auth.py` with `hmac.compare_digest`. Binding method and path means a captured `GET /sessions/A` signature is useless for `DELETE /sessions/B`. Optional: reject replays with a nonce stored in Redis for 300 s. Bind on the internal network only.

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| `POST` | `/sessions` | `StartAgentRequest` | `201 {pid, host}`; `200` same if already running; `429` above `MAX_SESSIONS` | Spawns a child process (§8.14). |
| `DELETE` | `/sessions/{sessionId}?reason=end\|restart` | — | `202 {stopping: true}`; `404` if unknown | Writes `pc:stop_reason:{sid}`, then SIGTERM to the process group, SIGKILL after 10 s. With `reason=restart` the agent skips `bye`. |
| `GET` | `/sessions/{sessionId}` | — | `200 {pid, host, status, startedAt, lastHeartbeatAt}`; `404` | — |
| `POST` | `/sessions/{sessionId}/input` | `ClientToAgentEvent` | `202` | Publishes to Redis `pc:input:{sessionId}`. |
| `GET` | `/healthz` | — | `200 {ok, sessions, maxSessions, redis: bool}` | Docker healthcheck. |

---

## 8. Agent worker specification (Python, Vision Agents)

### 8.1 Layering rules
- `physiocoach/core/` is **pure Python + numpy + pydantic + anthropic/httpx**. It has **no** `vision_agents`, `aiortc`, `av`, `cv2` or `mediapipe` imports. It must run and test natively on Windows (`cd agent && uv run pytest tests/core`). It holds the single implementation of angles, the rep engine, scoring, rule coaching, phrases, the LLM note, safety rules and contracts.
- `physiocoach/pose/` may import `cv2`, `mediapipe`, `ultralytics`, `numpy`. No Vision Agents imports.
- `physiocoach/call/` and `physiocoach/agent_main.py` are the only places that import `vision_agents` and `getstream`.
- `physiocoach/control/` imports FastAPI and Redis, never `vision_agents` (the supervisor stays light).
- Every time-dependent function takes timestamps as arguments (seconds, float). Never call `time.time()` inside `core/` logic, so synthetic tests are deterministic.
- **Do not use `from __future__ import annotations`** in `physiocoach/call/*.py`, `agent_main.py` or any module that registers `agent.events` subscribers: Vision Agents routes handlers by resolving their type hints, and string annotations on locally defined handlers may fail to resolve or silently skip routing. (It is fine in `core/`.) `tests/smoke/` asserts that the processor's `TrackAddedEvent` handler fires for a synthetic event.

### 8.2 Config and exercise loading (`core/exercises.py`, `core/config.py`)
- `load_exercises(path = <repo>/shared/exercises.json) -> dict[str, Exercise]`. `Exercise` is a frozen dataclass with `id, name_en, name_ml, joints: tuple[str,str,str], mode: Literal["flex","direct"], rest, start, min_peak, default_target, camera_view`. Resolve the path from `PC_SHARED_DIR` (default: `../shared` relative to `agent/`, `/app/shared` in Docker).
- `SessionConfig` (pydantic) mirrors `StartAgentRequest` (§7.7) and is read from the env var `PC_SESSION_JSON` that the supervisor sets for each child.

### 8.3 Pose backends (`pose/base.py`, `pose/mediapipe_backend.py`, `pose/yolo_backend.py`)
```python
# pose/base.py
from typing import Protocol, Mapping
import numpy as np

JOINTS = ("shoulder", "elbow", "wrist", "hip", "knee", "ankle")
# Named joint keys: "left_knee", "right_hip", ... → (x_px, y_px, confidence 0..1)
Keypoints = Mapping[str, tuple[float, float, float]]

COCO_INDEX = {   # Ultralytics YOLO pose, 17 COCO keypoints [V spec + Ultralytics docs]
    "left_shoulder": 5,  "right_shoulder": 6,  "left_elbow": 7,  "right_elbow": 8,
    "left_wrist": 9,     "right_wrist": 10,    "left_hip": 11,   "right_hip": 12,
    "left_knee": 13,     "right_knee": 14,     "left_ankle": 15, "right_ankle": 16,
}
MEDIAPIPE_INDEX = {  # MediaPipe Pose, 33 landmarks [V spec]
    "left_shoulder": 11, "right_shoulder": 12, "left_elbow": 13, "right_elbow": 14,
    "left_wrist": 15,    "right_wrist": 16,    "left_hip": 23,   "right_hip": 24,
    "left_knee": 25,     "right_knee": 26,     "left_ankle": 27, "right_ankle": 28,
}
SKELETON_EDGES = [("shoulder","elbow"),("elbow","wrist"),("shoulder","hip"),("hip","knee"),("knee","ankle")]  # per side, plus shoulder-shoulder and hip-hip

class PoseBackend(Protocol):
    name: str
    def infer(self, rgb: np.ndarray, t_ms: int) -> Keypoints | None:
        """One person (the most confident / largest). Pixel coordinates in the INPUT frame. None if nobody."""
    def close(self) -> None: ...
```
- **"Left"/"right" are the subject's anatomical sides** in both models. Do not mirror coordinates in the backend. The patient's self-view in the UI may be mirrored; the agent's frames are not.
- **MediaPipe backend (default, `POSE_BACKEND=mediapipe`):** PoseLandmarker in `VIDEO` running mode, `num_poses=1`, model file baked at `agent/models/pose_landmarker_full.task` (or `_lite` if Spike A shows CPU pressure). Landmarks are normalised; convert with `x_px = lm.x * W`, `y_px = lm.y * H` (spec: compute angles in pixel space). Confidence = `min(lm.visibility, lm.presence)` when `presence` is available; set confidence to **0** for any landmark whose `x` or `y` lies outside [0, 1], because MediaPipe extrapolates off-frame joints (for example an ankle cut off at the bottom) with deceptively usable values. Verify that both fields exist in the installed version in Spike A. **[U]** The PyPI `mediapipe` version is 1.1.0; the Tasks API names (`mp.tasks.vision.PoseLandmarker`, `PoseLandmarkerOptions`, `RunningMode.VIDEO`, `detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), t_ms)`, `result.pose_landmarks[0][i].visibility`) are from the 0.10.x line. Verify them against the installed version in Spike A before writing the backend; adjust if they moved. `t_ms` must be strictly increasing.
- **YOLO backend (`POSE_BACKEND=yolo`):** `from ultralytics import YOLO; model = YOLO("agent/models/yolo26n-pose.pt")`; `r = model(frame, verbose=False, device="cpu", imgsz=640)[0]`; `r.keypoints.data` is `(N, 17, 3)` = `(x_px, y_px, conf)` [V Ultralytics docs]. Pick the person with the highest box confidence × box area. **[U]** Ultralytics treats numpy input as BGR (OpenCV convention); pass `rgb[..., ::-1]` and verify with a test image in Spike A. Do **not** use Vision Agents' `YOLOPoseProcessor` (DEV-13, user may veto): it discards keypoints, handles only the first person, has no participant filter and mislabels the wrists (COCO 9 is the left wrist, the plugin labels it "R Wrist") [V]. Use it only as drawing/thread-pool reference code.
- CPU figures: YOLO26n-pose ≈ 40 ms/frame on CPU (ONNX, 640 px) [V docs]. MediaPipe full on CPU: [U], measured in Spike A. Target **10–12 fps inference** per session.

### 8.4 Angle math (`core/angles.py`), port exactly
```python
from __future__ import annotations
import math
from dataclasses import dataclass
from typing import Literal, Mapping, Optional

CONF_MIN = 0.5            # ignore frames whose minimum joint confidence is below this
EMA_OLD, EMA_NEW = 0.6, 0.4
Side = Literal["left", "right"]
Mode = Literal["flex", "direct"]

def joint_angle(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> Optional[float]:
    """Interior angle ABC at vertex b, in degrees, 0..180. Inputs MUST be pixel coordinates."""
    v1x, v1y = a[0] - b[0], a[1] - b[1]
    v2x, v2y = c[0] - b[0], c[1] - b[1]
    n1, n2 = math.hypot(v1x, v1y), math.hypot(v2x, v2y)
    if n1 < 1e-6 or n2 < 1e-6:
        return None
    cos = max(-1.0, min(1.0, (v1x * v2x + v1y * v2y) / (n1 * n2)))
    return math.degrees(math.acos(cos))

def normalised_to_px(x: float, y: float, width: int, height: int) -> tuple[float, float]:
    return x * width, y * height   # avoids aspect distortion (spec)

def mode_value(angle: float, mode: Mode) -> float:
    return 180.0 - angle if mode == "flex" else angle   # flex: straight limb = 0, bent = larger

def side_confidence(kp: Mapping[str, tuple[float, float, float]], joints: tuple[str, str, str], side: Side) -> float:
    return sum(kp.get(f"{side}_{j}", (0, 0, 0.0))[2] for j in joints)

class SideSelector:
    """Pick the side with the higher SUMMED confidence unless the prescription fixes it.
    Implementation choice (prototype unavailable): accumulate over the first `window` usable frames
    (positioning phase), then LOCK for the whole set so the side never flips mid-rep."""
    def __init__(self, fixed: Literal["auto", "left", "right"], window: int = 30):
        self.fixed, self.window = fixed, window
        self.totals = {"left": 0.0, "right": 0.0}; self.n = 0
        self.locked: Optional[Side] = None if fixed == "auto" else fixed  # type: ignore[assignment]
    def observe(self, kp, joints) -> Optional[Side]:
        if self.locked: return self.locked
        for s in ("left", "right"): self.totals[s] += side_confidence(kp, joints, s)  # type: ignore[arg-type]
        self.n += 1
        if self.n >= self.window:
            self.locked = "left" if self.totals["left"] >= self.totals["right"] else "right"
        return self.locked or ("left" if self.totals["left"] >= self.totals["right"] else "right")
    def force_lock(self) -> Side:                    # end of positioning: lock with current totals even if window not full
        if not self.locked:
            self.locked = "left" if self.totals["left"] >= self.totals["right"] else "right"
        return self.locked
    def reset(self): self.__init__(self.fixed, self.window)  # ONLY when re-entering positioning (e.g. patient rejoined)

class Ema:
    def __init__(self): self.value: Optional[float] = None
    def update(self, x: float) -> float:
        self.value = x if self.value is None else EMA_OLD * self.value + EMA_NEW * x
        return self.value
    def reset(self): self.value = None

@dataclass(frozen=True)
class Sample:
    t: float            # seconds
    raw_angle: float    # joint angle, degrees
    value: float        # EMA-smoothed mode value fed to the RepEngine
    side: Side
    min_conf: float

class AngleTracker:
    """keypoints (pixel space) → Sample, or None when the frame is gated out."""
    def __init__(self, joints: tuple[str, str, str], mode: Mode, side: Literal["auto", "left", "right"]):
        self.joints, self.mode = joints, mode
        self.sides = SideSelector(side); self.ema = Ema()
        self.last_ok_t: Optional[float] = None
    def update(self, t: float, kp) -> Optional[Sample]:
        side = self.sides.observe(kp, self.joints)
        pts = [kp.get(f"{side}_{j}") for j in self.joints]
        if any(p is None for p in pts): return None
        min_conf = min(p[2] for p in pts)  # type: ignore[index]
        if min_conf < CONF_MIN: return None          # gate: ignore the frame entirely (no EMA update)
        ang = joint_angle(pts[0][:2], pts[1][:2], pts[2][:2])  # type: ignore[index]
        if ang is None: return None
        self.last_ok_t = t
        return Sample(t, ang, self.ema.update(mode_value(ang, self.mode)), side, min_conf)
```
Rules:
- **Side lock lifecycle:** the side locks at the end of `positioning` (`force_lock()` if the 30-frame window has not filled). `countdown` resets only the `Ema` and creates a new `RepEngine`; it **never** resets the `SideSelector`, so the side can never change during the first rep of a set. `SideSelector.reset()` is called only when re-entering `positioning` (after the patient rejoins). Unit-tested.
- Gated frames (confidence < 0.5 or missing joints) are **skipped**: no EMA update, no rep engine update. The rep engine holds its state across a short dropout; a dropout longer than 3 s while `moving` aborts the in-progress rep (§8.5).
- If no valid sample arrives for **> 2.0 s** while in `positioning` or `set`, the flow emits a "can't see you" prompt (`pos.cant_see`, at most once per 10 s). This does not change the rep engine state. (Implementation choice; flag it in your Milestone 1 report.)
- `joint_angle` for `shoulder_raise` (joints hip, shoulder, elbow; vertex = shoulder; direct mode): arm down ≈ 0–20°, arm horizontal ≈ 90°.
- `knee_bend` (hip, knee, ankle; flex): straight leg ≈ 180° → value ≈ 0; knee bent to 120° → value 60.

### 8.5 Rep engine (`core/rep_engine.py`), port exactly
State machine on the smoothed mode value `v` (degrees):
- **Arming (implementation choice, report it at Checkpoint 1):** the engine starts **disarmed** and arms on the first sample with `v < rest`. `rest` → `moving` is allowed only while armed. Without this, a patient who is already bent when the set starts (or when tracking resumes mid-bend) would enter `moving` at once and count a phantom rep on straightening.
- `rest` → `moving` when armed and `v > start`; record `t0 = t`, `peak = v`.
- While `moving`: `peak = max(peak, v)`.
- `moving` → `rest` when `v < rest`; `duration = t − t0`.
- **Count the rep only if `peak >= minPeak` and `duration > 0.6 s`.** Otherwise emit a rejection (`shallow` if `peak < minPeak`, else `too_short`).
- A counted rep is **too fast** if `duration < minSecondsPerRep`.
- **Long dropout:** if the gap since the previous valid sample exceeds `MAX_GAP_S = 3.0` while `moving`, the in-progress rep is discarded (`abort_in_progress()`), and the engine disarms until the next `v < rest`.

```python
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal, Optional

MIN_REP_SECONDS = 0.6
MAX_GAP_S = 3.0           # implementation choice: a longer dropout while moving discards the rep

@dataclass(frozen=True)
class Rep:
    n: int
    peak: float
    seconds: float
    too_fast: bool

@dataclass(frozen=True)
class RepRejected:
    peak: float
    seconds: float
    reason: Literal["shallow", "too_short"]

class RepEngine:
    def __init__(self, rest: float, start: float, min_peak: float, min_seconds_per_rep: float):
        assert rest < start <= min_peak, "exercise thresholds must satisfy rest < start <= minPeak"
        self.rest, self.start, self.min_peak, self.min_spr = rest, start, min_peak, min_seconds_per_rep
        self.state: Literal["rest", "moving"] = "rest"
        self.armed = False                       # arms on the first sample below `rest`
        self.t0 = 0.0; self.peak = 0.0
        self.last_t: Optional[float] = None
        self.reps: list[Rep] = []
        self.current_value: Optional[float] = None

    def update(self, t: float, v: float) -> Rep | RepRejected | None:
        gap = None if self.last_t is None else t - self.last_t
        self.last_t, self.current_value = t, v
        if self.state == "moving" and gap is not None and gap > MAX_GAP_S:
            self.abort_in_progress()             # also disarms
        if self.state == "rest":
            if v < self.rest:
                self.armed = True
            elif self.armed and v > self.start:
                self.state, self.t0, self.peak = "moving", t, v
            return None
        self.peak = max(self.peak, v)
        if v < self.rest:
            self.state = "rest"
            dur = t - self.t0
            if self.peak >= self.min_peak and dur > MIN_REP_SECONDS:
                rep = Rep(len(self.reps) + 1, self.peak, dur, dur < self.min_spr)
                self.reps.append(rep)
                return rep
            return RepRejected(self.peak, dur, "shallow" if self.peak < self.min_peak else "too_short")
        return None

    def abort_in_progress(self) -> None:   # on stop/safety/long dropout: a half-done rep is never counted
        self.state, self.armed = "rest", False
```
Optional: reset the `Ema` after a gap longer than 1.0 s so stale values are not blended in; if you add it, the `dropout` synthetic test (§8.17) must stay green.

### 8.6 Set metrics and score (`core/scoring.py`), port exactly
`Score = 100 × (0.6 × min(1, avgPeak/target) + 0.25 × (1 − fast/reps) + 0.15 × min(1, reps/planned))`.
```python
from dataclasses import dataclass
from statistics import fmean

@dataclass(frozen=True)
class SetMetrics:
    reps_done: int; reps_planned: int; target: float
    avg_peak: float; best_peak: float; lowest_peak: float
    avg_rep_seconds: float; fast_reps: int; score: float
    per_rep: list[dict]          # [{"peak": float, "seconds": float, "tooFast": bool}]

def compute_score(avg_peak: float, target: float, fast: int, reps: int, planned: int) -> float:
    if reps <= 0 or target <= 0 or planned <= 0:
        return 0.0                                   # defined: no reps → score 0 (spec formula divides by reps)
    s = 100 * (0.6 * min(1.0, avg_peak / target) + 0.25 * (1 - fast / reps) + 0.15 * min(1.0, reps / planned))
    return round(max(0.0, min(100.0, s)), 1)

def set_metrics(reps: list, planned: int, target: float) -> SetMetrics:
    if not reps:
        return SetMetrics(0, planned, target, 0.0, 0.0, 0.0, 0.0, 0, 0.0, [])
    peaks = [r.peak for r in reps]; secs = [r.seconds for r in reps]
    fast = sum(1 for r in reps if r.too_fast)
    avg = fmean(peaks)
    return SetMetrics(len(reps), planned, target, round(avg, 1), round(max(peaks), 1), round(min(peaks), 1),
                      round(fmean(secs), 2), fast, compute_score(avg, target, fast, len(reps), planned),
                      [{"peak": round(r.peak, 1), "seconds": round(r.seconds, 2), "tooFast": r.too_fast} for r in reps])
```
Worked example (must be a unit test): 10 reps, all peak 48, 2.5 s each, target 60, planned 10 → `0.6×0.8 + 0.25×1 + 0.15×1 = 0.88` → **score 88.0**.

### 8.7 Coaching rules (`core/coach_rules.py`)
**Live cue per counted rep** (templated, spoken, at most one cue per rep):
```python
def live_cue_ids(rep, target: float, mode: str) -> list[str]:
    ids = [f"count.{rep.n:02d}"]                        # always the count word
    if rep.peak < target - 8:
        ids.append("cue.bend_more" if mode == "flex" else "cue.raise_more")   # DEV-9
    elif rep.too_fast:
        ids.append("cue.slow")
    return ids                                          # depth cue wins over tempo (implementation choice)
```
Rejected reps get no count. At most one `cue.slow`/depth cue per rep, and the speaker drops cues (never counts) if the audio backlog exceeds 1.5 s (§8.10).

**Rule-based post-set note** (always computed, instantly, before the LLM is called). The spec requires **2–3 sentences** covering achieved vs target angle, tempo only if too fast, and one concrete next step. So the opener, the achieved clause and the target clause are **clauses that join into one sentence** (the opener and achieved phrases end with a comma, not a full stop); tempo and the next step are one sentence each.
```python
def next_more_reps(m) -> int:
    return min(10, m.reps_planned - m.reps_done) if m.reps_done < m.reps_planned else 3

def next_step_id(m, short: bool) -> str:
    if short or m.fast_reps or m.reps_done < m.reps_planned:
        return f"note.more_reps.{next_more_reps(m)}"          # "Next: do K more reps, slowly."
    return f"note.keep_reps.{m.reps_planned}"                 # "Next time, do N reps the same way, slowly."

def rule_note_ids(m, mode: str) -> list[str]:
    if m.reps_done == 0:
        return ["note.no_reps"]                               # 2 sentences
    n, t = round(m.avg_peak), int(m.target)
    achieved = f"note.achieved_{'bend' if mode == 'flex' else 'raise'}.{n}"
    short = m.avg_peak < m.target - 8
    if short:
        ids = ["note.good_effort", achieved, f"note.target.{t}"]            # sentence 1 (clauses)
    elif m.avg_peak < m.target:
        ids = ["note.well_done", achieved, f"note.target.{t}"]              # near target: "…, but the target is T°."
    else:
        ids = ["note.well_done", achieved, f"note.target_reached.{t}"]      # "…, and you reached the target of T°."
    if m.fast_reps:
        ids.append("note.too_fast")                                         # sentence 2 (only if too fast)
    ids.append(next_step_id(m, short))                                      # last sentence: one concrete step
    return ids
```
`render_note(ids) -> {"ml": " ".join(phrase.ml), "en": " ".join(phrase.en)}` (the punctuation lives in the phrases). Every branch renders to **2–3 sentences** in both `ml` and `en` (unit test over the demo, near-target, reached, reached + fast, short + fast and zero-reps branches, counting sentences with the same splitter as `validate_note`).

Demo check (unit test): knee_bend, avg peak 48, target 60, 10/10 reps, no fast reps → ids `["note.good_effort","note.achieved_bend.48","note.target.60","note.more_reps.3"]` → en "Good effort, you bent to 48° on average, but the target is 60°. Next: do 3 more reps, slowly." → ml "നല്ല ശ്രമം, നിങ്ങൾ ശരാശരി 48 ഡിഗ്രി വരെ മടക്കി, പക്ഷേ ലക്ഷ്യം 60 ഡിഗ്രി ആണ്. ഇനി 3 തവണ കൂടി പതുക്കെ ചെയ്യൂ." (2 sentences). Every piece is a pre-rendered clip and the `Speaker` plays it id by id (§8.10), so the demo line needs no LLM and no network. **Native review of the joined wording is required.**

### 8.8 Phrase catalogue (`core/phrases.py`, `shared/phrases.json`)
```json
{ "version": 1,
  "phrases": [
    { "id": "count.01", "category": "count", "ml": "ഒന്ന്", "en": "one", "review": "pending" },
    { "id": "note.achieved_bend", "category": "note", "ml": "നിങ്ങൾ ശരാശരി {N} ഡിഗ്രി വരെ മടക്കി,", "en": "you bent to {N}° on average,",
      "params": { "N": [0, 180] }, "review": "pending" }
  ] }
```
- Parametrised entries expand to concrete ids `"<id>.<N>"` over the inclusive range (`note.achieved_bend.48`). `expand_all()` yields every concrete phrase the coach can emit; the voice contract test (§12.3) and the renderer (§9.3) both use it.
- `get(id) -> Phrase(ml, en, category)`. Raises `KeyError` on unknown ids; a unit test asserts every id produced by `live_cue_ids`, `rule_note_ids` and the flow exists.
- Text is Unicode **NFC**-normalised on load (`unicodedata.normalize("NFC", s).strip()`), because Malayalam chillu letters and ZWJ/ZWNJ variants otherwise hash differently.
- The full catalogue content is §9.1.

### 8.9 LLM post-set note (`core/note_llm.py`) and weekly summary
**Contract:** input = JSON of set metrics only (no name, phone or any personal data). Output = ONLY `{"ml": "...", "en": "..."}`. Validate shape and semantics; on **any** failure, timeout, refusal or invalid JSON, use the rule note. Called directly with the Anthropic Python SDK, **not** through the Vision Agents `llm=` slot. Model: **`claude-sonnet-5-5`** (the user's choice).

```python
import asyncio, json, os, re
import anthropic
from pydantic import BaseModel, ConfigDict, Field

MODEL = "claude-sonnet-5-5"
TIMEOUT_S = float(os.getenv("NOTE_LLM_TIMEOUT_S", "3.5"))
SERVER_FALLBACK = os.getenv("NOTE_LLM_SERVER_FALLBACK", "true") == "true"
_client = anthropic.AsyncAnthropic(timeout=TIMEOUT_S, max_retries=0)   # reads ANTHROPIC_API_KEY

class NoteOut(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)   # spec: output is ONLY {"ml","en"}
    ml: str = Field(min_length=1, max_length=400)
    en: str = Field(min_length=1, max_length=400)

NOTE_SCHEMA = {"type": "object", "properties": {"ml": {"type": "string"}, "en": {"type": "string"}},
               "required": ["ml", "en"], "additionalProperties": False}

SYSTEM = (
    "You write a short spoken note for a patient who just finished one set of an exercise prescribed by their "
    "physiotherapist, supervised by an AI exercise coach. The input is JSON metrics for that set. "
    "Return JSON with two fields that say the same thing: 'ml' in natural, simple spoken Malayalam (Malayalam script; "
    "write numbers as digits) and 'en' in plain English for the physiotherapist. Each is 2-3 short sentences. "
    "Cover: the achieved angle versus the target angle; tempo ONLY if fastReps > 0; and exactly one concrete next step, "
    "taken from suggestedNextStep. Use only numbers that appear in the input. Never diagnose, never name a condition, "
    "injury, cause of pain or medication, never suggest changing the target, reps, sets or frequency, and never give "
    "medical advice beyond doing the prescribed exercise."
)

async def _call_llm(metrics: dict) -> NoteOut:
    req = dict(
        model=MODEL, max_tokens=600, system=SYSTEM,
        thinking={"type": "between_tools"},                  # thinking off on Sonnet 5.5; "disabled" is a 400
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": NOTE_SCHEMA}},
        messages=[{"role": "user", "content": json.dumps(metrics, ensure_ascii=False)}],
    )
    if SERVER_FALLBACK:                                      # Claude API only; "default" is the only form Sonnet 5.5 takes
        resp = await _client.beta.messages.create(**req, betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    else:
        resp = await _client.messages.create(**req)
    if resp.stop_reason != "end_turn":                       # "refusal", "max_tokens", ... → rules
        raise ValueError(f"stop_reason={resp.stop_reason}")
    text = next(b.text for b in resp.content if b.type == "text")
    return NoteOut.model_validate_json(text)

async def post_set_note(metrics: dict, rule_note: dict) -> tuple[dict, str]:
    """Returns (note, source). rule_note is already computed (instant fallback)."""
    if os.getenv("NOTE_LLM_ENABLED", "true") != "true" or not os.getenv("ANTHROPIC_API_KEY"):
        return rule_note, "rules"
    try:
        note = await asyncio.wait_for(_call_llm(metrics), TIMEOUT_S)
        validate_note(note, metrics)                         # raises on any violation
        return note.model_dump(), "llm"
    except Exception:                                        # timeout, network, refusal, JSON, validation
        return rule_note, "rules"
```
- The API shapes above (`thinking: {"type": "between_tools"}`, `output_config.effort`, `output_config.format` with `json_schema`, `stop_reason`) are from Anthropic's current SDK documentation for `claude-sonnet-5-5`. `between_tools` turns thinking off, is accepted only at effort `high` or below (`low` is fine), and takes no other field. Keep `max_retries=0` so the wall-clock stays inside the timeout.
- **Refusal fallback (enabled by default, `NOTE_LLM_SERVER_FALLBACK=true`):** following Anthropic's guidance for `claude-sonnet-5-5`, the call opts into server-side fallbacks with `betas=["server-side-fallback-2026-07-01"]` + `fallbacks="default"` (Claude API only; for Sonnet 5.5 only the `"default"` form is accepted). **`between_tools` is accepted only by Claude Sonnet 5.5.** At Milestone 6, verify with a forced-refusal test that a fallback-served request still succeeds with `between_tools` in the body. If it does not, drop `between_tools` on the fallback-enabled path and rely on `output_config.effort="low"` with default adaptive thinking (re-measure latency against the 3.5 s budget). Either way the local rule note remains the final fallback, and the `stop_reason` check still applies (the fallback model can refuse too). Tell the user at Checkpoint 6 that this is on; set the variable to `false` if they decline.
- **Input metrics JSON:** `{exerciseId, mode, verb: "bend"|"raise", targetAngle, repsPlanned, repsDone, avgPeak (rounded int), bestPeak, lowestPeak, avgRepSeconds, minSecondsPerRep, fastReps, suggestedNextStep}`, where `suggestedNextStep` mirrors `next_step_id` (§8.7): `{moreReps: k, slowly: true}` or `{keepReps: repsPlanned, slowly: true}`, with `k = next_more_reps(m)`. The prompt states that `minSecondsPerRep` is the only tempo number to use.
- **`validate_note(note, metrics)` (semantic checks on top of the pydantic shape):**
  1. `ml` is mostly Malayalam: letters in U+0D00–U+0D7F make up ≥ 60 % of all letters.
  2. Sentence count **2–3** in each field (split on `.`, `!`, `?`, `।`; ignore empty fragments), matching the spec and the rule note.
  3. Every number in `ml` and `en` (extract with `\d+(?:\.\d+)?`) is in the allowed set `{round(avgPeak), round(bestPeak), round(lowestPeak), targetAngle, repsDone, repsPlanned, fastReps, k, 0, 1, minSecondsPerRep, round(minSecondsPerRep), round(avgRepSeconds, 1), round(avgRepSeconds)}` (so correct tempo sentences such as "aim for 2 seconds per rep" or "one more set" pass).
  4. `en` contains none of the deny-list (case-insensitive substrings): `diagnos`, `injur`, `tear`, `arthritis`, `fracture`, `surgery`, `medicat`, `medicine`, `painkiller`, `ibuprofen`, `paracetamol`, `inflamm`, `condition`, `prescription`, `increase your target`, `change your`, `dose`, `ice pack`, `heat pack`, `see a doctor`.
  5. `ml` contains none of: `രോഗ` (disease), `മരുന്ന്` (medicine), `ശസ്ത്രക്രിയ` (surgery), `പരിക്ക്` (injury). **Native-speaker review required** for this list.
- **Speaking it (prefetch, then commit):** what the patient hears, what they read and what the physio reads must always be the same note. `agent.say()` synthesises and plays in one call, so the `Speaker` cannot know in advance whether audio will arrive. Therefore:
  1. **Prefetch:** `pcm = await asyncio.wait_for(_collect(await agent.tts.stream_audio(note_ml)), NOTE_TTS_TIMEOUT_S)` with a **whole-note** timeout (default 3.0 s). Because `CachedMalayalamTTS` tees runtime audio into its memory/disk cache when the generator completes (§8.10), the following `agent.say(note_ml)` is a cache hit and plays instantly.
  2. **Commit (only after the prefetch succeeds):** send `pc.caption` with the LLM `{ml, en}`, `agent.say(note_ml)`, and record `feedbackSource = "llm"` in `pc.set_summary` and the `set_result` callback.
  3. **On timeout or any exception:** `await primary.stop_audio()`, then speak the **rule** ids (clips), send the **rule** caption and record `feedbackSource = "rules"`.
  The worst-case time from set end to the start of the note is therefore the LLM budget (3.5 s) plus the TTS budget (3.0 s); `set.done` is spoken immediately to cover the gap.
- **Weekly summary (TypeScript, `analytics.generateWeeklySummary`):** the same contract and validation, ported to TS in `analytics/lib/weekly-summary-llm.ts`. Use `new Anthropic({ timeout: 8000, maxRetries: 0 })` (TS timeouts are milliseconds) and `client.messages.create({ model: "claude-sonnet-5-5", max_tokens: 800, thinking: { type: "between_tools" }, output_config: { effort: "low", format: { type: "json_schema", schema } }, system, messages })`. Input: the computed weekly numbers only. Validate the output with `z.object({ ml: z.string().min(1).max(600), en: z.string().min(1).max(600) }).strict()` (extra keys → rules) plus the same semantic checks. Apply the same server-side `fallbacks: "default"` opt-in and `between_tools` caveat as the Python note (`client.beta.messages.create({ ..., betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })`). Fallback: `analytics/lib/weekly-summary-rules.ts` (deterministic bilingual sentences: adherence `done/planned`, average peak vs target and the change vs last week, max pain, fast-rep percentage). Note: `between_tools` may be missing from older `@anthropic-ai/sdk` typings; if the type checker rejects it, upgrade the SDK rather than casting.

### 8.10 Voice (`voice/cached_tts.py`, `voice/google_tts.py`, `call/speaker.py`)
**One TTS slot for all speech.** `Agent(tts=CachedMalayalamTTS(...))` and the coach only ever calls `agent.say(text)` with catalogue strings or the validated LLM `ml` text. `agent.say(text)` goes straight to TTS without the LLM [V] (it also appends an assistant message to the agent's conversation; see §8.13 about the chat side effect).

Vision Agents TTS contract [V] (`agents-core/vision_agents/core/tts/tts.py`): subclass `vision_agents.core.tts.TTS`; set `streaming = False` for whole utterances; implement `async stream_audio(text, *args, **kwargs)` returning `PcmData`, an iterator or an async iterator of `PcmData` (raw bytes are rejected); implement `async stop_audio()`. `interrupt()` bumps an epoch and calls `stop_audio()` so stale chunks are dropped. `PcmData` comes from `getstream.video.rtc.track_util`: `PcmData.from_bytes(b, sample_rate=..., format=AudioFormat.S16, channels=1)`, `.resample(rate, channels)`, `.append(other)`, `.to_wav_bytes()`, `.duration_ms` [V]. The outbound track is `AudioStreamTrack(sample_rate=48000, channels=1, audio_buffer_size_ms=300_000)`; its `write(pcm, final=...)` resamples internally per stream-py source [V], but resample to 48 kHz yourself anyway (one research note marks it [U]).

Resolution order inside `CachedMalayalamTTS.stream_audio(text)`:
1. **In-memory clip**: catalogue phrases loaded from `assets/voice/<voice_slug>/manifest.json` at start-up and pre-resampled once to 48 kHz mono. Key: `sha256(f"{voice_slug}|{nfc(text)}")[:16]`.
2. **Disk cache**: `agent/cache/voice/<voice_slug>/<hash>.wav`.
3. **Primary runtime TTS: Sarvam `bulbul:v3`, `ml-IN`** through the existing Vision Agents plugin `vision_agents.plugins.sarvam.TTS(model="bulbul:v3", language="ml-IN", speaker=<chosen>, sample_rate=24000, pace=0.9)` [V signature]. First-chunk timeout 1.5 s. Tee the audio into the disk cache.
4. **Fallback runtime TTS: Google Cloud TTS Chirp 3 HD `ml-IN`** (custom ~40-line `tts.TTS` subclass using `google.cloud.texttospeech.TextToSpeechAsyncClient().synthesize_speech(...)` with `LINEAR16`, 24 kHz). **[I]** The sync `LINEAR16` response carries a WAV header; parse it with `wave`.
5. **Raise.** The coach catches it and plays the rule clips (all pre-rendered).

**The runtime provider and speaker must match the pre-rendered clips** (same provider, model, voice, pace), so the voice never changes mid-session. If the native-speaker A/B (§9.3) picks Google, swap the order of 3 and 4.

```python
# voice/cached_tts.py (skeleton; based on verified APIs)
class CachedMalayalamTTS(tts.TTS):
    streaming = False
    def __init__(self, assets_dir: Path, cache_dir: Path, voice_slug: str, primary: tts.TTS,
                 fallback: tts.TTS | None = None, first_chunk_timeout: float = 1.5):
        super().__init__(provider_name="physiocoach-ml")
        ...  # load manifest, wav_to_pcm(...).resample(48000, 1) for every phrase, key by text_hash
    async def stream_audio(self, text: str, *_, **__):
        k = text_hash(text, self.voice_slug)
        if k in self._mem: return self._mem[k]
        f = self.cache_dir / f"{k}.wav"
        if f.exists():
            self._mem[k] = wav_to_pcm(f.read_bytes()).resample(48000, 1); return self._mem[k]
        return self._synth_and_tee(text, k, f)          # async generator: primary (timeout) → fallback → raise;
                                                        # writes the WAV + _mem entry when the generator completes
    async def start(self):                              # warm the Sarvam WebSocket before the greeting
        await self.primary.start()
        if self.fallback: await self.fallback.start()
    async def stop_audio(self):
        await self.primary.stop_audio()
        if self.fallback: await self.fallback.stop_audio()
    async def close(self):
        await self.primary.close()
        if self.fallback: await self.fallback.close()
        await super().close()
```
- The inner `primary` (Sarvam) and `fallback` are Components with their own lifecycle; the wrapper must forward `start`/`close` or the persistent WebSocket leaks or is never warmed. **[U]** Whether the base `tts.TTS`/`Component` defines `start()` and whether the Agent calls it; check the source in Spike B and call `await agent.tts.start()` yourself before the greeting if it does not.
- The Sarvam server closes an idle WebSocket after 60 s [V]; the plugin's `idle_timeout=5.0` reconnects often [I]. Either set `idle_timeout` above 60 or send a keep-alive every 30–45 s, and measure the reconnect cost in Spike B.
- **Language (DEV-16):** audio is always the Malayalam clip set in v1, whatever `cfg.patient.lang` says.
Rendering helpers live in `voice/wav.py` (`wav_to_pcm`, `pcm_to_wav`, `trim_and_fade`, `loudnorm(-16 LUFS, -1 dBTP)` with `pyloudnorm`).

**`Speaker` (`call/speaker.py`)**: the only code that calls `agent.say`.
- An `asyncio.Queue` of utterances `{phrase_ids | text, ml, en, kind, priority}`.
- **Phrase-id utterances (counts, cues, prompts, rule notes, countdown):** send **one** `pc.caption` with the joined `ml`/`en`, then call `await agent.say(phrases.get(id).ml)` **once per id, in order**. Each call is then an exact catalogue string and hits the in-memory clip. Never pass a joined multi-phrase string to `say()`: its hash is not in the catalogue, so it would go to runtime TTS and break the offline guarantee. Unit test: rendering any rule note or `live_cue_ids` output makes **zero** calls to the primary/fallback TTS.
- **Free-text utterances:** only the validated, prefetched LLM `ml` (§8.9) goes to `say(text)` as a whole.
- **Captions and `pc.rep` are fire-and-forget:** `send_custom_event` is a REST round trip (≈ 100–300 ms), so send them with `asyncio.create_task(agent.send_custom_event(...))` (keep task references in a set; log failures) and call `say()` right away. Await the send only for `pc.safety_alert` and `pc.state` transitions, where ordering matters.
- **Pacing:** track `busy_until = now + clip_duration` (durations from the manifest; for runtime TTS, estimate 80 ms per Malayalam character until measured). **[U]** Whether `agent.say` returns when audio is written to the track or when playback ends; Spike B measures this. If the backlog exceeds 1.5 s, drop queued `cue` utterances (never drop counts, prompts, notes or safety).
- **Priority:** `safety` utterances flush the queue, interrupt current audio (`await agent.tts.interrupt(); await agent.audio_track.flush()` [V public methods]) and play immediately, **unless the physio gate is closed** (next bullet).
- **Physio gate:** while `bargein.physio_speaking` is true, nothing is played; captions and `pc.rep` events still go out; queued counts collapse to the latest one; resume 800 ms after the physio stops. **Safety precedence:** a safety stop is never delayed by the gate. The halt, `pc.safety_alert`, the `safety_alert` callback and the safety caption all go out immediately; only the `safety.stop` audio waits until the gate releases (it then plays first, before anything else queued). Tested in `tests/call/test_flow.py`.
- **Runtime TTS failure for a note:** fall back to the rule-note ids (all clips) and report `feedbackSource="rules"` (§8.9 prefetch rule).

Malayalam is **NOT** available on ElevenLabs `eleven_multilingual_v2` (the Vision Agents plugin default), `eleven_flash_v2_5`, `eleven_turbo_v2_5`, Deepgram Aura, or AWS Polly [V]. Do not use them.

### 8.11 Pose processor and annotated tile (`call/processor.py`, `pose/draw.py`)
**Do not use `VideoProcessor` routing.** The Agent forwards **only one** source track (highest priority, first-added among ties) to all `VideoProcessor`s; if the physio's camera joins first, the patient's track never reaches the processor [V `agents.py:_on_track_change`]. Instead, make `PoseProcessor` a **`VideoPublisher` only** (then the agent subscribes to no video itself) and subscribe to the patient's track yourself (DEV-13, user may veto).

**[U] — Spike A task 3a.** Only the existence of `edge.add_track_subscriber(track_id)` is verified. Whether the SFU `subscription_config` the agent passes to `rtc.join` still delivers video tracks when **no** processor needs video is not verified; if video is excluded at join time, `add_track_subscriber` may return `None` or a track that never produces frames. Spike A logs whether it returns a track and whether the forwarder receives frames. **Fallback ladder:** (1) also implement `VideoProcessor.process_video` on `PoseProcessor` as a no-op that ignores the routed track, which forces the agent to subscribe to video, and keep the per-participant `add_track_subscriber` path for the patient; (2) if that also fails, pass a custom `subscription_config` to the edge after reading `StreamEdge.join`; (3) last resort: the vetoed-path behaviour of DEV-13 (patient joins first or physio joins with camera off).

```python
# call/processor.py (skeleton; APIs [V] unless marked)
import asyncio, time
from concurrent.futures import ThreadPoolExecutor
import av
from vision_agents.core.processors import VideoPublisher
from vision_agents.core.edge.events import TrackAddedEvent, TrackRemovedEvent
from vision_agents.core.edge.types import TrackType
from vision_agents.core.utils.video_forwarder import VideoForwarder
from vision_agents.core.utils.video_track import QueuedVideoTrack

class PoseProcessor(VideoPublisher):
    name = "physio_pose"
    def __init__(self, backend_factory, fps: int = 12, out_w: int = 960, out_h: int = 540):
        super().__init__()
        self.fps, self.out_w, self.out_h = fps, out_w, out_h
        self.out = QueuedVideoTrack(width=out_w, height=out_h, fps=fps)   # first frame is solid blue [V]
        self.patient_user_id: str | None = None
        self.enabled = False                       # NO inference before consent
        self.on_keypoints = None                   # async cb(t, keypoints|None, frame_meta) → flow
        self.overlay = lambda: OverlayState.idle() # replaced by the flow; never None (TypeError on first frame)
        self._last_t: float | None = None
        self._backend_factory = backend_factory; self._backend = None
        self._pool = ThreadPoolExecutor(max_workers=1)
        self._fwd: VideoForwarder | None = None; self._track_id: str | None = None

    def publish_video_track(self): return self.out

    def attach_agent(self, agent) -> None:
        self._agent = agent
        @agent.events.subscribe
        async def _tracks(e: TrackAddedEvent | TrackRemovedEvent):
            if not e.participant or e.participant.user_id != self.patient_user_id: return
            if e.track_type != TrackType.VIDEO: return           # ignore audio and screenshare
            if isinstance(e, TrackRemovedEvent):
                if e.track_id == self._track_id: await self._detach()
            else:
                await self._attach_track(self._agent.edge.add_track_subscriber(e.track_id), e.track_id)

    async def warmup(self):                        # call before join (cold start 3-6 s)
        self._backend = await asyncio.get_running_loop().run_in_executor(self._pool, self._backend_factory)

    async def _attach_track(self, track, track_id: str):
        if track is None: return
        await self._detach()
        self._track_id = track_id
        self._fwd = VideoForwarder(track, max_buffer=3, fps=self.fps, name=f"pose-{track_id}")
        self._fwd.add_frame_handler(self._on_frame, fps=self.fps, name="pose")

    async def attach_file(self, path: str):        # replay mode: same pipeline
        from vision_agents.core.utils.video_track import VideoFileTrack   # [U] confirm module path: grep "class VideoFileTrack"
        await self._attach_track(VideoFileTrack(path, fps=30), f"file:{path}")

    async def _detach(self):
        if self._fwd: await self._fwd.remove_frame_handler(self._on_frame)
        self._fwd, self._track_id = None, None

    def _frame_time(self, frame: av.VideoFrame) -> float:
        # Prefer the frame's own timestamp: arrival time adds forwarder/drop jitter to rep durations
        t = float(frame.pts * frame.time_base) if frame.pts is not None and frame.time_base else time.monotonic()
        if self._last_t is not None and t <= self._last_t:
            t = self._last_t + 1e-3                 # MediaPipe VIDEO mode needs strictly increasing t_ms
        self._last_t = t
        return t

    async def _on_frame(self, frame: av.VideoFrame):
        loop = asyncio.get_running_loop()
        if not (self.enabled and self._backend):    # before consent (or before warmup): NO inference, NO raw video
            await self.out.add_frame(placeholder_frame(self.out_w, self.out_h, self.overlay()))   # logo + bilingual banner
            return
        rgb = frame.to_ndarray(format="rgb24")
        t = self._frame_time(frame)
        kp = await loop.run_in_executor(self._pool, self._backend.infer, rgb, int(t * 1000))
        if self.on_keypoints: await self.on_keypoints(t, kp, rgb.shape)
        annotated = await loop.run_in_executor(self._pool, draw_overlay, rgb, kp, self.overlay(), self.out_w, self.out_h)
        await self.out.add_frame(av.VideoFrame.from_ndarray(annotated, format="rgb24"))

    async def close(self):
        await self._detach(); self.out.stop(); self._pool.shutdown(wait=False)
```
- `participant_id` in Vision Agents is actually `participant.user_id` [V]. The agent's own published track is never treated as a source [V].
- `VideoForwarder` handler fps cannot exceed the forwarder fps [V]. If inference falls behind, the forwarder buffer (max 3) drops old frames: this is intended.
- **Before consent** the tile shows a **static placeholder** (`placeholder_frame`: PhysioCoach logo plus the banner "Waiting for consent", rendered with PIL + Noto Sans Malayalam if you want the Malayalam line "സമ്മതത്തിനായി കാത്തിരിക്കുന്നു"; cache the frame) instead of the patient's raw video. No inference runs. The physio already sees the patient's own tile directly. The placeholder may be pushed at 1–2 fps.
- In replay and tests, `warmup()` may be skipped; the `self._backend` guard keeps `_on_frame` from crashing.
- **`draw_overlay(rgb, kp, overlay, W, H)`** (pure function, unit-testable, cv2 on RGB):
  1. Letterbox the input into W×H (keep aspect, black bars). Map keypoints with the same transform.
  2. Skeleton: thin white lines for all available edges with conf ≥ 0.5; the three exercise joints on the active side drawn thick (6 px) in the primary green, joint dots 8 px.
  3. Angle arc at the vertex joint with the current angle in degrees next to it.
  4. **Rep counter**, top-left: large `3 / 10`, and `Set 1/2` below.
  5. **Angle gauge**, bottom-right: semicircle 0–180 for the mode value; a **target tick/line** at `target` (green); a dashed `target − 8` tick (amber); the needle at the current smoothed value; a small marker at this rep's peak; the value as text, e.g. `48°`.
  6. Phase banner, top-centre, in **English and numbers only**: OpenCV Hershey fonts have no Malayalam glyphs. (Malayalam appears in the web captions. If the user wants Malayalam on the tile, render text with PIL + Noto Sans Malayalam; optional.)
  7. A red full-width banner "STOPPED – physio alerted" when `halted`.
- Publish at 960×540 @ 12 fps by default. If Spike A measures < 8 fps end to end, drop to 640×360 @ 8 fps (`POSE_FPS`, `POSE_OUT_W`, `POSE_OUT_H` env).

### 8.12 Inputs (`call/inputs.py`)
- **Primary: Stream custom events.** Vision Agents has **no public API** for receiving custom events [V]. The underlying stream-py `ConnectionManager` re-emits coordinator `"custom"` events as raw dicts with `ev["custom"]` and `ev["user"]["id"]` (getstream 4.3.0 `connection_manager.py:318`) [V]. Reach it through the **private** edge attribute after join: `StreamEdge._connection` is a property that returns `_real_connection` and raises before join [V `stream_edge_transport.py:184`].
```python
def hook_custom_events(agent, on_event):
    edge = agent.edge
    conn = getattr(edge, "_real_connection", None) or edge._connection     # private; pinned vision-agents==0.6.9
    loop = asyncio.get_running_loop()
    def _on_custom(ev: dict):
        sender = (ev.get("user") or {}).get("id")
        data = ev.get("custom") or {}
        loop.create_task(on_event(sender, data))
    conn.on("custom", _on_custom)
```
- **Race [V]:** the coordinator WebSocket and call watch start in a background task after join, so events sent before that are lost. Hence the `pc.ready` handshake (§7.7) and the client re-sending `pc.consent` every 2 s until the phase changes.
- **Backup: Redis** `SUBSCRIBE pc:input:{sessionId}` (`redis.asyncio`), fed by `join.sendInput` → worker `/input` (§7.8).
- `on_event(sender, data)`: parse with the pydantic `ClientToAgentEvent`; drop invalid or unknown; check the sender (§7.7); dedupe by `eventId`; dispatch to the flow (`flow.on_consent()`, `flow.on_pain(score, set_index, event_id)`; every safety trigger (`pc.stop`, `pc.symptom`, `pc.pain_score` ≥ 7) calls `flow.halt(reason, event_id)` synchronously in the handler, so the halt never waits behind a queue).
- **Smoke test (Spike A):** a browser sends `pc.consent`; the agent logs receipt within 1 s. If this fails, the Redis path becomes primary (and the UI always uses `join.sendInput`).

### 8.13 Barge-in (`call/bargein.py`) and other call details
- The built-in barge-in fires only from STT/turn detection, so it does nothing with `stt=None` [V]. The default `multi_speaker_filter=FirstSpeakerWinsFilter()` drops audio from everyone except the first speaker before it reaches `AudioProcessor`s [V]. **Do not rely on either.**
- Subscribe to `AudioReceivedEvent` on `agent.events` (it carries `participant` and `pcm_data`, before any filtering) [V]. Only for `participant.user_id == physio_id`:
  - `pcm16k = e.pcm_data.resample(16000, 1)`; `prob = vad.predict_speech(pcm16k)` where `pool = await SileroVADSessionPool.load(model_dir)` and `vad = pool.session()` (`vision_agents.core.vad.silero`) [V]. **[U]** Exact input expectations of `predict_speech` (chunk size, rate); check the source in Spike B.
  - Energy gate: RMS of the chunk ≥ `BARGEIN_MIN_RMS` (default 0.02 full scale), to avoid the agent's own voice echoing through the physio's speakers.
  - Speech when `prob > 0.5` and the energy gate passes for ≥ 2 consecutive chunks → `physio_speaking = True`; `await agent.tts.interrupt(); await agent.audio_track.flush()` [V]; publish `pc.state` unchanged (the UI shows "Physio speaking – coach paused" from `participant.isSpeaking`).
  - Release after 800 ms with `prob < 0.3`.
- Fallback signal: SFU `"audio_level_changed"` events on the same private connection (`conn.on("audio_level_changed", ...)`, payload `audio_levels: [{user_id, level, is_speaking}]`) [V emitted; U cadence and latency].
- Silero downloads `silero_vad.onnx` from GitHub at runtime [V]; bake it into the image at `agent/models/`.
- **Chat side effect [V]:** after join, Vision Agents calls `edge.create_conversation()`, which creates the Stream Chat channel `messaging:{callId}` on the **Video app key** and writes `agent.say()` text into it. **Spike A must implement the no-op path:** subclass `StreamEdge` and override `create_conversation` as a no-op (**[U]** whether a no-op conversation is safe for the agent's internal flow). **If that is unsafe, STOP AND REPORT** (Checkpoint A item): keeping the Chat channel would store agent utterance text (including LLM notes) at Stream, which conflicts with §1.4 #2 and needs the user's explicit approval as an exception. Do not choose it yourself. Patient STT stays off either way, so no patient speech is ever stored.

### 8.14 Process model: supervisor and agent entry point
**Supervisor (`control/api.py` + `control/supervisor.py`; FastAPI, `uvicorn --workers 1`, internal network only):**
- `POST /sessions` (idempotent): if Redis `pc:agent:{sid}` has a live pid, return it; if `len(running) >= MAX_SESSIONS` return 429; otherwise:
```python
proc = await asyncio.create_subprocess_exec(
    sys.executable, "-m", "physiocoach.agent_main", "--session-id", sid,
    env={**os.environ, "PC_SESSION_JSON": body_json}, start_new_session=True)   # own process group (POSIX)
await redis.hset(f"pc:agent:{sid}", mapping={"pid": proc.pid, "host": HOST, "status": "starting", "startedAt": now_iso})
asyncio.create_task(wait_child(sid, proc))
```
- `wait_child`: `code = await proc.wait()`; map the exit code; post `agent_exited{code, signal, setsCompleted}` to web through the outbox; delete the Redis keys.
- `DELETE /sessions/{sid}?reason=end|restart`: store the reason in `pc:stop_reason:{sid}`, `os.killpg(pid, SIGTERM)`; after 10 s, `SIGKILL`. On SIGTERM the agent (handler installed explicitly with `loop.add_signal_handler(signal.SIGTERM, ...)`) cancels the flow, posts any partial set with `stopReason="disconnected"`, says `bye` **unless the reason is `restart`**, flushes its outbox and exits 0.
- **Reaper** every 30 s and at start-up: any `pc:agent:*` whose pid is dead or whose heartbeat key `pc:hb:{sid}` (TTL 15 s, refreshed by the agent every 5 s) is missing is reported as exited (code −1 → `agent_crashed`).
- **Exit-code contract:**

| Code | Meaning | Web sets |
|---|---|---|
| 0 | Normal end (all sets done, or the physio ended the session) | `done` if sets exist, else `failed`/`no_sets` |
| 3 | Patient never joined within `PATIENT_JOIN_TIMEOUT_S` (900 s) | `failed`/`patient_never_joined` |
| 4 | Patient left and did not return within 60 s | `done` if sets exist, else `failed`/`patient_left` |
| 5 | No consent within 5 min of the patient joining | `failed`/`no_consent` |
| other / signal / reaper | Crash | `done` if sets exist, else `failed`/`agent_crashed`; plus `safety_events{kind:"agent_down", clientEventId: "agent_down:<sessionId>:<agentPid>"}` (same key as the webhook, `onConflictDoNothing`) and a server-side `pc.safety_alert{reason:"agent_down"}` sent with `streamVideo.video.call(type,id).sendCallEvent({ user_id: AGENT_USER_ID, custom })` [V `sendCallEvent`], so both UIs show "Coach disconnected – Restart". |

**Agent entry point (`agent_main.py`):** prefer a small explicit `main()` built from verified primitives, so the process controls its own exit code:
```python
async def amain(cfg: SessionConfig) -> int:
    agent = Agent(
        edge=getstream.Edge(),                       # or the no-chat subclass (Spike A)
        llm=NoLLM(),                                 # llm= is mandatory [V]; stub with a no-op simple_response
        agent_user=User(id=cfg.agentUserId, name="PhysioCoach"),
        instructions="Deterministic exercise coach. Never used for generation.",
        tts=build_tts(), processors=[pose := PoseProcessor(backend_factory_from_env())],
    )
    pose.patient_user_id = cfg.patient.id
    await pose.warmup()
    await agent.tts.start()                                         # warm Sarvam (see §8.10 [U] on lifecycle)
    call = await agent.create_call(cfg.callType, cfg.callId)        # get_or_create: existing call OK [V]
    async with agent.join(call, participant_wait_timeout=None):     # default 10 s; None = wait [V]
        flow = Flow(agent, pose, cfg, Speaker(agent), Outbox(cfg), inputs=...)
        loop = asyncio.get_running_loop()
        loop.add_signal_handler(signal.SIGTERM, lambda: flow.cancel("sigterm"))   # POSIX (Docker)

        @agent.events.subscribe
        async def _ended(e: CallEndedEvent):                       # physio ended the session [V edge event]
            flow.cancel("call_ended")                               # partial set → "disconnected", flush outbox, exit 0

        return await flow.run()                                     # returns the exit code
```
The **only** entry point is `python -m physiocoach.agent_main --session-id <sid>` with the config in env `PC_SESSION_JSON` (the supervisor in this section, the diagram in §3.2 and §13.3 all use it).
- `class NoLLM(vision_agents.core.llm.llm.LLM)`: implement the abstract `simple_response` as a no-op [V: it is the only abstract method]. With `stt=None` and a TTS set, the agent skips STT safely [V].
- **Alternative (only if Spike A shows it is needed):** `Runner(AgentLauncher(create_agent=..., join_call=..., agent_idle_timeout=900)).cli()` run as `python -m physiocoach.agent_main run --call-type T --call-id ID --no-demo` [V]. `AgentLauncher` passes **no per-call kwargs** to `create_agent` [V], so read `PC_SESSION_JSON`. **[U]** Whether `Runner.cli` calls `sys.exit` itself; if you use it, write the intended exit code to Redis `pc:exit:{sid}` and have the supervisor prefer it. Use the Runner only if Spike A shows plain construction misses required warm-up.
- The launcher's default `agent_idle_timeout=60` would make the agent leave after 60 s alone [V]; the explicit `main()` has no idle timeout, so the flow enforces its own: patient join 900 s, patient-gone 60 s, hard cap 60 min.

### 8.15 Call-flow state machine (`call/flow.py`)
Owned by one `asyncio` task. Inputs arrive as method calls (`on_consent`, `on_pain`, `on_patient_joined/left`, `on_keypoints`, and `halt(reason, event_id)` for every safety trigger; `cancel(reason)` for call end / SIGTERM). Safety handlers can interrupt **any** state by cancelling the state-machine task (skeleton below).

| State (`pc.state.phase`) | Entry actions | Leaves when | Timeouts / notes |
|---|---|---|---|
| (waiting) | Post `agent_joined`; send `pc.ready` (repeat every 5 s until the first client input) | Patient's participant joins | 900 s → exit 3 |
| `greeting` | Speak `intro.greet`, `intro.watch` (+ `physio.joined` later if the physio joins) | Speech done | — |
| `await_consent` | Speak `consent.ask`; `pose.enabled = False` | `pc.consent` from the patient → speak `consent.thanks`, post `consent_given` | Re-ask every 45 s; 5 min → exit 5. **No pose inference in this state or before it.** Skipped when `cfg.consentGiven` is true (agent restart after consent; the agent says it is resuming). |
| `positioning` | `pose.enabled = True`; speak `pos.side` or `pos.front` (from `cameraView`) and `pos.leg_in_frame`/`pos.arm_in_frame` | The three exercise joints on one side have conf ≥ 0.5 for **2 s continuously** → speak `pos.ok`; then `SideSelector.force_lock()` | Every 8 s without success, speak one targeted prompt: joints missing → `pos.cant_see`; joints near the frame edge (within 3 % of W/H) → `pos.step_back`; mean luma < 60/255 → `pos.light`. After 90 s, continue anyway (the physio can intervene). Side selection window runs here and the side locks on exit (§8.4). |
| `countdown` | Speak `cd.ready`, `count.03`, `count.02`, `count.01`, `cd.start` (≈ 4 s); reset `Ema` and create a new `RepEngine` (disarmed, §8.5). **Never reset the `SideSelector` here.** | Countdown done | — |
| `set` | Feed samples to the `RepEngine`; on each `Rep`: send `pc.rep`, queue `live_cue_ids` | `repsDone == reps` → `completed`; no rep for **20 s** after the first rep (or 30 s with no rep at all) → `idle`; hard cap `reps × max(6, 3 × minSecondsPerRep) + 30` s → `idle` | Rejected reps are logged, not spoken. |
| `summary` | `metrics = set_metrics(...)`; `rule = rule_note(...)`; speak `set.done`; `note, source = await post_set_note(...)`; if `source == "llm"`, prefetch its audio (§8.9) and fall back to the rule note on failure; speak the chosen note; send `pc.set_summary`; post `set_result` (with the final `feedbackSource`) | Note spoken | LLM bounded at 3.5 s; note TTS prefetch bounded at 3.0 s → rule clips |
| `await_pain` | Speak `pain.ask`; send `pc.request_pain` | `pc.pain_score` → speak `pain.thanks`; post `pain_recorded`; `score >= 7` → `halted` | Re-ask once at 30 s; 60 s → continue with `pain = null` |
| `rest` | If `setIndex < sets`: speak `set.rest`; wait 30 s; `setIndex += 1` | Rest done → `countdown` | Skipped after the last set |
| `done` | Speak `bye`; send `pc.state{phase:"done"}` | — | Exit 0 after the outbox flushes (≤ 5 s) |
| `halted` | `rep_engine.abort_in_progress()`; send `pc.safety_alert` (awaited) and post `safety_alert` with `clientEventId` = the triggering input's `eventId`; post a partial `set_result` with `stopReason` if a set was running; `Speaker` priority-plays `safety.stop` (after the physio gate releases, §8.10) | Physio ends the session, or the patient leaves | The agent stays in the call, silent, and runs no new set. |

**Safety triggers (from any state):** `pc.stop` (patient or physio) → reason `stop`; `pc.pain_score` with score ≥ 7 → `pain`; `pc.symptom` (any kind) → `symptom`. Each takes effect within one event-loop tick through **task cancellation** (skeleton below): the input handler sets `self._halt_reason` and calls `self._main.cancel()`, so a stop that arrives during a 3.5 s LLM call, a TTS prefetch or a 30 s rest is not held until that await finishes. Unit-test with a fake agent and a virtual clock: `pc.stop` during a mocked 3 s LLM call reaches `halted` in under 50 ms of virtual time.

**Patient leaves:** pause the current state (no speech); if they return within 60 s, call `SideSelector.reset()` and re-enter `positioning` (or `await_consent` if consent was never given); otherwise post the partial set with `stopReason="disconnected"` and exit 4 (`failureReason = "patient_left"` if no sets exist).

**Call ended / SIGTERM:** `flow.cancel("call_ended" | "sigterm")` posts any running partial set with `stopReason="disconnected"`, flushes the outbox and returns 0.

**Physio joins:** speak `physio.joined` once at the next gap. **Physio Stop** behaves like the patient's Stop.

Skeleton:
```python
class Flow:
    async def run(self) -> int:
        self._halt_reason: str | None = None       # "stop" | "pain" | "symptom"
        self._cancel_reason: str | None = None     # "call_ended" | "sigterm"
        self._main = asyncio.create_task(self._run_states())
        try:
            return await self._main
        except asyncio.CancelledError:
            if self._halt_reason:
                await self._halted(self._halt_reason)    # abort rep, events, partial set, safety.stop audio
                await self._halted_wait(); return 0      # stays silent until the physio ends the call
            if self._cancel_reason:
                await asyncio.shield(self._post_partial_and_flush("disconnected")); return 0
            raise

    def halt(self, reason: str, event_id: str) -> None:   # called by inputs.py for safety triggers, from any state
        if self._halt_reason is None:
            self._halt_reason, self._halt_event_id = reason, event_id   # event_id → clientEventId of safety_alert
            self._main.cancel()

    def cancel(self, reason: str) -> None:         # CallEndedEvent / SIGTERM
        self._ended.set()                          # asyncio.Event created in __init__; releases _halted_wait()
        if self._cancel_reason is None and self._halt_reason is None:
            self._cancel_reason = reason; self._main.cancel()

    async def _run_states(self) -> int:
        try:
            await self._wait_patient()
            await self._greeting()
            if not self.cfg.consentGiven: await self._await_consent()
            await self._positioning()
            for self.set_index in range(self.cfg.startSetIndex, self.cfg.prescription.sets + 1):
                await self._countdown(); stop_reason = await self._run_set()
                await self._summary(stop_reason); await self._await_pain()
                if self.set_index < self.cfg.prescription.sets: await self._rest()
            await self._done(); return 0
        except PatientNeverJoined: return 3
        except PatientLeft: return 4
        except NoConsent: return 5
```
Any cleanup inside a state that must not be cut short by cancellation (an outbox post, writing the partial set) is wrapped in `asyncio.shield(...)`.
The heartbeat task (`SET pc:hb:{sid} 1 EX 15` every 5 s) runs alongside.

### 8.16 Outbox (`call/outbox.py`)
- `await outbox.post(event: dict)`: add `eventId` (if missing; generated **once, at enqueue time**, so retries stay idempotent) and `sessionId`; serialise the body once. Store the **unsigned** body in Redis (`RPUSH pc:outbox:{sid}`) before the first attempt.
- **Sign on every attempt**: `t = now`, `v1 = hex(HMAC-SHA256(AGENT_CALLBACK_SECRET, f"{t}.POST./api/agent/events.{sha256hex(body)}"))` (canonical form, §4.3), then `httpx.AsyncClient(timeout=5).post(f"{WEB_INTERNAL_URL}/api/agent/events", content=body, headers=...)`. A signature computed at enqueue time would be stale (> 300 s) after a longer outage and every retry would get 401.
- On a network error or 5xx: retry with exponential backoff (1, 2, 4, … 30 s). On **401**: retry up to 5 times (clock skew or secret rotation). On 400 or after the 401 attempts: move the message to `pc:outbox:dead:{sid}` and log it (never silently drop set results or safety alerts). On 2xx: `LREM` it.
- On SIGTERM or `done`: drain the outbox within 5 s, then exit. The supervisor retries any remaining `pc:outbox:{sid}` entries after the child exits.

### 8.17 Replay mode (demo step 6 and the test harness)
1. **In-call replay:** `sessions.start({ prescriptionId, mode: "replay", clip: "knee_demo.mp4" })`. The worker resolves the clip under `agent/replay/clips/` (allow-list only), and the flow calls `pose.attach_file(path)` instead of waiting for the patient track. Consent is auto-granted and logged as `consent_given` with a `replay` note; the greeting is shortened. The annotated tile, Malayalam audio, set results and dashboard behave exactly as in a live session; the session row has `mode = "replay"` and is excluded from analytics unless `includeReplay` is set (the dashboard sets it in `NEXT_PUBLIC_DEMO_MODE`, DEV-14), so the ROM trend and adherence still update during a demo fallback.
2. **Offline replay (no call, no internet):**
   `uv run python -m physiocoach.replay.cli agent/replay/clips/knee_demo.mp4 --exercise knee_bend --target 60 --reps 10 --min-seconds 2 --play-audio [--out annotated.mp4] [--backend mediapipe|yolo] [--post-to http://localhost:3000]`
   - Reads frames with `cv2.VideoCapture`, uses the video's own timestamps (`CAP_PROP_POS_MSEC`), and **downsamples by timestamp to `--fps` (default `POSE_FPS` = 12)**: keep a frame only when `t − last_t >= 1/fps`. The EMA (0.6/0.4 per sample) has a different time constant at 30 fps than at 12 fps, so offline results must use the live rate to validate the live pipeline. Then it runs the same `PoseBackend` → `AngleTracker` → `RepEngine` → `coach_rules` → phrase ids.
   - `--play-audio`: plays the pre-rendered clips through `sounddevice` in order, paced like the live `Speaker`. Shows an OpenCV preview window with the same `draw_overlay`.
   - Prints the cue sequence as JSON lines (`{"t": 12.4, "ids": ["count.03","cue.bend_more"]}`) and the final `SetMetrics` and note.
   - `--synthetic clean|fast|shallow|jitter|dropout|prebent` skips video and feeds `replay/synthetic.py` angle signals straight into the tracker. Synthetic runs test the rep engine and coach only; the pose-backend-to-coach path is covered by the mandatory video golden test on `knee_test.mp4` (§12.1).
3. **Synthetic generators (`replay/synthetic.py`)**, used by pytest:
   - `clean(n=10, peak=65, rep_s=2.5, fps=12)`: sinusoid-like rep shapes from value 5 to `peak` and back, with 1 s rests.
   - `fast(n=10, peak=65, rep_s=1.2)`: valid but too fast for `min_seconds=2`.
   - `shallow(n=10, peak=30)`: below `minPeak=35` → 0 reps counted for knee_bend.
   - `jitter(base=clean, amp=6, seed=42)`: adds ±6° noise to raw angles (the EMA must keep the count at exactly 10).
   - `dropout(base=clean, gaps=[(4.0,0.4),(11.0,1.5)])`: low-confidence frames (conf 0.3) inside reps; the count must stay correct.
   - `too_short`: excursions above `start` lasting 0.5 s → rejected `too_short`.
   - `prebent`: the signal starts at value 50 and returns to 5 → **0** reps (arming rule, §8.5).
   - `long_dropout`: a 3.5 s gap while moving → the in-progress rep is discarded.
   - `demo_shallow(n=10, peak=48, rep_s=2.5)`: the rehearsal movement (§14) → note ids `[note.good_effort, note.achieved_bend.<N>, note.target.60, note.more_reps.3]`, where `<N>` is the EMA-smoothed average peak (a little below the raw 48; record it in the golden file), always `< 52`.
4. **Last resort:** a pre-recorded screen capture of a full successful run, kept on the presenter's laptop.

---

## 9. Malayalam phrase catalogue and voice plan

### 9.1 Phrase table
**NATIVE SPEAKER REVIEW REQUIRED FOR EVERY LINE.** These are draft wordings by a non-native author. A native Malayalam-speaking physiotherapist must sign off every line, especially the physiotherapy terms and the number forms (for example ഒമ്പത് vs ഒൻപത്). Each phrase starts with `"review": "pending"` in `shared/phrases.json`; the manifest records `review.status` per clip, and the demo build requires `approved` (§12.3).

Audio file naming: `agent/assets/voice/<voice_slug>/<category>/<id>.wav` (for example `count/count.07.wav`, `note/note.achieved_bend.48.wav`). Example `voice_slug`: `sarvam-bulbul-v3-<speaker>-p090`.

**Numbers** (counts and countdown share one clip set; `count.01`–`count.30` are required because `reps ≤ 30`):
| id | ml | en | | id | ml | en |
|---|---|---|---|---|---|---|
| count.01 | ഒന്ന് | one | | count.16 | പതിനാറ് | sixteen |
| count.02 | രണ്ട് | two | | count.17 | പതിനേഴ് | seventeen |
| count.03 | മൂന്ന് | three | | count.18 | പതിനെട്ട് | eighteen |
| count.04 | നാല് | four | | count.19 | പത്തൊമ്പത് (alt. പത്തൊൻപത്) | nineteen |
| count.05 | അഞ്ച് | five | | count.20 | ഇരുപത് | twenty |
| count.06 | ആറ് | six | | count.21 | ഇരുപത്തിയൊന്ന് | twenty-one |
| count.07 | ഏഴ് | seven | | count.22 | ഇരുപത്തിരണ്ട് | twenty-two |
| count.08 | എട്ട് | eight | | count.23 | ഇരുപത്തിമൂന്ന് | twenty-three |
| count.09 | ഒമ്പത് (alt. ഒൻപത്) | nine | | count.24 | ഇരുപത്തിനാല് | twenty-four |
| count.10 | പത്ത് | ten | | count.25 | ഇരുപത്തിയഞ്ച് | twenty-five |
| count.11 | പതിനൊന്ന് | eleven | | count.26 | ഇരുപത്തിയാറ് | twenty-six |
| count.12 | പന്ത്രണ്ട് | twelve | | count.27 | ഇരുപത്തിയേഴ് | twenty-seven |
| count.13 | പതിമൂന്ന് | thirteen | | count.28 | ഇരുപത്തിയെട്ട് | twenty-eight |
| count.14 | പതിനാല് | fourteen | | count.29 | ഇരുപത്തിയൊമ്പത് | twenty-nine |
| count.15 | പതിനഞ്ച് | fifteen | | count.30 | മുപ്പത് | thirty |
| zero | പൂജ്യം | zero (pain scale) | | | | |

**Intro and consent**
| id | ml | en | file |
|---|---|---|---|
| intro.greet | നമസ്കാരം! ഞാൻ ഫിസിയോകോച്ച്, നിങ്ങളുടെ വ്യായാമ സഹായി. | Hello! I am PhysioCoach, your exercise assistant. | intro/intro.greet.wav |
| intro.watch | ആവർത്തനങ്ങൾ എണ്ണാൻ ഞാൻ നിങ്ങളുടെ വീഡിയോ ശ്രദ്ധിക്കും. വീഡിയോ റെക്കോർഡ് ചെയ്യുകയോ സൂക്ഷിക്കുകയോ ഇല്ല. | I will watch your video to count the repetitions. The video is not recorded or stored. | intro/intro.watch.wav |
| consent.ask | തുടരാൻ സമ്മതമാണെങ്കിൽ, സ്ക്രീനിലെ "ഞാൻ സമ്മതിക്കുന്നു" ബട്ടൺ അമർത്തുക. | If you agree to continue, press the "I agree" button on the screen. | consent/consent.ask.wav |
| consent.thanks | നന്ദി. നമുക്ക് തുടങ്ങാം. | Thank you. Let's begin. | consent/consent.thanks.wav |

The UI consent button label must match exactly: **ഞാൻ സമ്മതിക്കുന്നു / I agree**.

**Camera positioning**
| id | ml | en | file |
|---|---|---|---|
| pos.side | ദയവായി ക്യാമറയിലേക്ക് വശം തിരിഞ്ഞ് നിൽക്കൂ. | Please stand side-on to the camera. (knee, elbow) | pos/pos.side.wav |
| pos.front | ദയവായി ക്യാമറയ്ക്ക് അഭിമുഖമായി നിൽക്കൂ. | Please stand facing the camera. (shoulder) | pos/pos.front.wav |
| pos.leg_in_frame | നിങ്ങളുടെ കാൽ മുഴുവനും സ്ക്രീനിൽ കാണണം. | Your whole leg must be visible on screen. | pos/pos.leg_in_frame.wav |
| pos.arm_in_frame | നിങ്ങളുടെ കൈ മുഴുവനും സ്ക്രീനിൽ കാണണം. | Your whole arm must be visible on screen. | pos/pos.arm_in_frame.wav |
| pos.step_back | ക്യാമറ അൽപ്പം പിന്നിലേക്ക് മാറ്റൂ. | Move the camera back a little. | pos/pos.step_back.wav |
| pos.light | വെളിച്ചം കുറവാണ്. കുറച്ചുകൂടി വെളിച്ചമുള്ള സ്ഥലത്തേക്ക് മാറൂ. | The light is low. Please move somewhere brighter. | pos/pos.light.wav |
| pos.cant_see | എനിക്ക് നിങ്ങളെ വ്യക്തമായി കാണാൻ കഴിയുന്നില്ല. | I can't see you clearly. | pos/pos.cant_see.wav |
| pos.ok | ശരി, ഇപ്പോൾ നന്നായി കാണാം. | Good, I can see you well now. | pos/pos.ok.wav |

**Countdown and set**
| id | ml | en | file |
|---|---|---|---|
| cd.ready | തയ്യാറാകൂ. | Get ready. | cd/cd.ready.wav |
| (3, 2, 1) | reuse count.03 / count.02 / count.01 | three / two / one | — |
| cd.start | തുടങ്ങൂ! | Start! | cd/cd.start.wav |
| cue.bend_more | കുറച്ചുകൂടി മടക്കൂ. | Bend a little more. (flex mode: knee, elbow) | cue/cue.bend_more.wav |
| cue.raise_more | കുറച്ചുകൂടി ഉയർത്തൂ. | Raise a little more. (direct mode: shoulder_raise; DEV-9) | cue/cue.raise_more.wav |
| cue.slow | പതുക്കെ. | Slowly. | cue/cue.slow.wav |
| cue.good | നന്നായി! | Good! (optional, unused by default) | cue/cue.good.wav |
| set.done | സെറ്റ് പൂർത്തിയായി. | Set complete. | misc/set.done.wav |
| set.rest | ഇനി വിശ്രമിക്കൂ. | Now rest. | misc/set.rest.wav |

**Summary, pain and safety**
| id | ml | en | file |
|---|---|---|---|
| note.good_effort | നല്ല ശ്രമം, | Good effort, | note/note.good_effort.wav |
| note.well_done | വളരെ നന്നായി, | Well done, | note/note.well_done.wav |
| note.achieved_bend.{N} (N = 0–180) | നിങ്ങൾ ശരാശരി {N} ഡിഗ്രി വരെ മടക്കി, | you bent to {N}° on average, | note/note.achieved_bend.{N}.wav |
| note.achieved_raise.{N} (N = 0–180) | നിങ്ങൾ ശരാശരി {N} ഡിഗ്രി വരെ ഉയർത്തി, | you raised to {N}° on average, | note/note.achieved_raise.{N}.wav |
| note.target.{T} (T = 10–180) | പക്ഷേ ലക്ഷ്യം {T} ഡിഗ്രി ആണ്. | but the target is {T}°. | note/note.target.{T}.wav |
| note.target_reached.{T} (T = 10–180) | ലക്ഷ്യമായ {T} ഡിഗ്രി എത്തി. | and you reached the target of {T}°. | note/note.target_reached.{T}.wav |
| note.too_fast | കുറച്ച് വേഗത കൂടുതലായിരുന്നു. | It was a little too fast. | note/note.too_fast.wav |
| note.more_reps.{K} (K = 1–10) | ഇനി {K} തവണ കൂടി പതുക്കെ ചെയ്യൂ. | Next: do {K} more reps, slowly. | note/note.more_reps.{K}.wav |
| note.keep_reps.{N} (N = 1–30) | അടുത്ത തവണയും {N} തവണ ഇതുപോലെ പതുക്കെ ചെയ്യൂ. | Next time, do {N} reps the same way, slowly. | note/note.keep_reps.{N}.wav |

The `note.*` opener, achieved and target clips are **clauses**: a rule note joins opener + achieved + target into one sentence (§8.7), so they carry commas, not full stops. `note.next_same` from earlier drafts is replaced by `note.keep_reps.{N}` (a concrete next step). **Native review must check the joined sentences, not only the single clips.**
| note.no_reps | ആവർത്തനങ്ങൾ ഒന്നും എണ്ണാൻ കഴിഞ്ഞില്ല. നമുക്ക് വീണ്ടും ശ്രമിക്കാം. | I could not count any repetitions. Let's try again. | note/note.no_reps.wav |
| deg.{N} (optional) | {N} ഡിഗ്രി | {N} degrees | deg/deg.{N}.wav |
| pain.ask | ഇപ്പോൾ എത്ര വേദനയുണ്ട്? പൂജ്യം മുതൽ പത്ത് വരെയുള്ള ബട്ടണുകളിൽ ഒന്ന് അമർത്തുക. | How much pain do you have now? Press one of the buttons from zero to ten. | pain/pain.ask.wav |
| pain.thanks | നന്ദി, രേഖപ്പെടുത്തി. | Thank you, noted. | pain/pain.thanks.wav |
| safety.stop | സെറ്റ് നിർത്തുകയാണ്. നിങ്ങളുടെ ഫിസിയോതെറാപ്പിസ്റ്റിനെ അറിയിച്ചിട്ടുണ്ട്. ദയവായി വിശ്രമിക്കൂ. | Stopping the set. Your physiotherapist has been alerted. Please rest. | safety/safety.stop.wav |
| physio.joined | നിങ്ങളുടെ ഫിസിയോതെറാപ്പിസ്റ്റ് കോളിൽ ചേർന്നു. | Your physiotherapist has joined the call. | misc/physio.joined.wav |
| bye | ഇന്നത്തെ സെഷൻ കഴിഞ്ഞു. നന്ദി! | Today's session is over. Thank you! | misc/bye.wav |

Numbers inside templates are written as digits (`48 ഡിഗ്രി`) and normalised by Bulbul's text preprocessing, which is always on for v3 [V]. **A native speaker must listen to every number clip**, because digit normalisation may pick a different form than the speaker expects. If it is wrong, spell the number out in the template text for that clip only.

### 9.2 TTS provider findings (as of 2026-10-10)
| Provider | Malayalam | Vision Agents plugin | Status |
|---|---|---|---|
| **Sarvam Bulbul v3** (`bulbul:v3`) | Yes, `ml-IN` [V docs]. 37 cross-lingual speakers; docs highlight `shubh` (male) and `ishita` (female) [V]. Which sounds most native: [U]. REST up to 48 kHz; streaming 8/16/22.05/24 kHz [V]. ₹3 per 1,000 characters [V]. | **Yes**: `vision-agents-plugins-sarvam` 0.6.9, `sarvam.TTS(api_key=None\|SARVAM_API_KEY, model="bulbul:v3", language="hi-IN", speaker="shubh", sample_rate=24000, pace=None, ...)` with a persistent WebSocket and cancel support [V]. | **Primary.** Two doc/plugin mismatches to test in Spike B: the plugin sends `target_language_code` while the WebSocket docs say `language_code`; the plugin requests `linear16` while the streaming docs say "MP3 only" [V both sides]. If either breaks, subclass the plugin and override its connection/config method. `bulbul:v4-flash` has **no** Malayalam voices [V]. Latency unpublished [U]: measure. The WebSocket closes after 60 s idle [V]; the plugin's `idle_timeout=5.0` reconnects often [I]. |
| **Google Cloud TTS Chirp 3 HD** | Yes, `ml-IN`, 30 voices, e.g. `ml-IN-Chirp3-HD-Kore` (F), `ml-IN-Chirp3-HD-Charon` (M) [V]. Also `ml-IN-Wavenet-A..D`, `ml-IN-Standard-A..D` [V]. | No; custom ~40-line subclass. | **Fallback**, and a second candidate set for the A/B. Pricing [U] (search summaries conflict; Chirp 3 HD ≈ $30 per 1M chars after 1M free). |
| Azure Speech | Yes: `ml-IN-SobhanaNeural` (F), `ml-IN-MidhunNeural` (M); Central India region [V]. | No | Optional third A/B set. |
| ElevenLabs `eleven_v4_turbo` / v4 / v3 | Yes [V]. | Plugin exists, but defaults to `eleven_multilingual_v2` (**no Malayalam**) and fixed `pcm_16000` [V]. | Optional A/B candidate only. |
| ElevenLabs `eleven_multilingual_v2`, `flash_v2_5`, `turbo_v2_5`; Deepgram Aura; AWS Polly | **No** [V]. | — | Do not use. |
| Cartesia `sonic-3.6` | Yes, `ml` [V] | Plugin has no `language` parameter; default `sonic-3.5` [V] | Not evaluated [U]. |
| STT (stretch only): Sarvam Saaras (`sarvam.STT`, plugin exists [V]); Deepgram has **no** Malayalam [V]; Whisper zero-shot is unusable (CER ≈ 97 on FLEURS-ml per a community card) [V-ish]. | — | — | Not in v1. If ever used, only to detect safety keywords, never to count reps. |
| Realtime S2S (Gemini Live, OpenAI Realtime) | Malayalam quality [U] | — | Not used in v1. Never for counts. |

### 9.3 Pre-rendering plan (`voice/render_catalogue.py`)
- **Inputs:** `shared/phrases.json` expanded with `expand_all()` (≈ 30 counts + ~35 fixed phrases + 181 × 2 achieved + 171 targets + 171 target-reached + 10 more-reps + 30 keep-reps + optional 181 `deg` ≈ 810–990 clips, ≈ 32k characters; ≈ ₹100 on Sarvam [I]).
- **Primary render:** Sarvam REST `POST https://api.sarvam.ai/text-to-speech` [V endpoint] with header `api-subscription-key: $SARVAM_API_KEY`, body `{text, target_language_code or language_code: "ml-IN", model: "bulbul:v3", speaker, pace: 0.9, speech_sample_rate: 24000}`. **[U]** The exact request field names and the response shape (believed to be `{"audios": [<base64 wav>]}`); confirm against the live docs in Spike B before rendering ~900 clips. Retry with backoff; respect rate limits [U].
- **Second set:** Google Chirp 3 HD `Kore` and `Charon` (LINEAR16, 24 kHz). Optional third: Azure Sobhana/Midhun (`riff-24khz-16bit-mono-pcm`).
- **Format:** WAV, 24 kHz, 16-bit signed little-endian, mono. Post-process: trim leading/trailing silence to 30 ms, 10 ms fades, loudness-normalise to −16 LUFS with a −1 dBFS true-peak ceiling (`pyloudnorm`).
- **Manifest** `agent/assets/voice/<voice_slug>/manifest.json`:
```json
{ "voice": { "provider": "sarvam", "model": "bulbul:v3", "speaker": "<tbd>", "pace": 0.9, "sample_rate": 24000 },
  "generated_at": "2026-10-10T00:00:00Z",
  "phrases": [ { "id": "count.07", "category": "count", "text_ml": "ഏഴ്", "gloss_en": "seven",
                 "hash": "3f9a…", "file": "count/count.07.wav", "duration_ms": 412,
                 "review": { "status": "pending", "reviewer": null, "notes": null } } ] }
```
- **Hash:** `sha256(f"{voice_slug}|{nfc(text).strip()}")[:16]`, identical to the runtime cache key.
- **A/B test:** render 2–3 candidate voices; a native-speaker physio listens for ~20 minutes (counts, cues, two notes, safety line) and picks one; lock it into the manifest and set `review.status` per clip. **STOP AND REPORT** with the candidates before locking (Milestone 3 checkpoint).
- Commit the manifest; commit the WAVs only if the user agrees (otherwise store them as a build artifact and bake them into the image).

---

## 10. Frontend specification

General rules: reuse the existing patterns (§2.1). Server `page.tsx` prefetches → `HydrationBoundary` → `Suspense` → `ErrorBoundary` → client view with `useSuspenseQuery`. All mutations get `onError` toasts (`sonner`). Malayalam text always uses `font-ml` and `lang="ml"`. Desktop first, responsive down to 360 px phones; no horizontal scrolling; touch targets ≥ 44 px (patient call controls ≥ 56 px).

### 10.1 Physio dashboard
| Page | Route | Built from | Contents |
|---|---|---|---|
| Overview | `/overview` | `home-view.tsx` (replaced) | KPI row (`Card`): live sessions, sessions this week, open pain flags, active patients. **Live sessions** cards (patient, exercise, phase from last result, "Join call" → `/call/[id]`). **Pain flags** list (`PainFlagsList`, red `Badge`, "Acknowledge" button → `sessions.acknowledgeSafety`). **Adherence** per patient (`Progress` + `done/planned`). **Weekly summary** cards (`WeeklySummaryCard`: numbers, `textEn`, toggle to `textMl`, "Generate AI summary" button). Poll every 2 s if any live session exists, else 30 s. |
| Patients | `/patients` | agents list | `DataTable` + `DataPagination` + search; "New Patient" dialog (`ResponsiveDialog` + `PatientForm`). |
| Patient detail | `/patients/[patientId]` | agent detail | Header (`PatientIdViewHeader`: Edit, New prescription, Delete with `useConfirm`). Profile card (phone, email, language). Prescriptions list with **Start** buttons. **ROM trend chart** (`RomTrendChart`). Recent sessions table. Weekly summary card. `PhysioNotes`. |
| Prescriptions | `/prescriptions` | agents list + `meeting-form` | Filters: search, patient (`PatientIdFilter`), exercise (`ExerciseFilter`), active. Inline "Start" cell. "New prescription" dialog (`PrescriptionForm`). |
| Prescription detail | `/prescriptions/[prescriptionId]` | agent detail | Prescription card (exercise `nameEn`/`nameMl`, target, reps × sets, min s/rep, side, sessions/week, how-to in both languages). Large **"Start guided session"** button (`StartSessionButton`) and a secondary "Start replay (demo)" button (only when `AGENT_REPLAY_CLIPS` is non-empty; exposed through a server-provided flag). Sessions for this prescription. |
| Sessions | `/sessions` | meetings list | Status/patient filters; columns per §4.6. |
| Session detail | `/sessions/[sessionId]` | meeting detail | `ScheduledState` / `LiveState` / `DoneState` / `FailedState`. Live: polling 2 s, live set feed, red alert banner, "Join call", "Restart coach", "End session". Done: tabs Summary / Sets / Reps / Notes. |
| Physio in-call | `/call/[sessionId]` | call module | `GuidedCallLayout viewer="physio"` (§10.3). |

**`RomTrendChart`** (`analytics/ui/components/rom-trend-chart.tsx`): shadcn `ChartContainer` + recharts `LineChart`. X = session date; Y = degrees (0 to `max(target + 20, maxPeak)`). Lines: `avgPeak` (`var(--chart-1)`, solid), `bestPeak` (`var(--chart-1)`, dashed, 50 % opacity). `ReferenceLine y={targetAngle}` (`var(--chart-2)`, label "Target 60°"). Tooltip: date, avg/best peak, score. Empty state when there are no sessions. Excludes replay sessions unless `includeReplay` (passed when `NEXT_PUBLIC_DEMO_MODE=true`, DEV-14); replay points (`isReplay`) use a distinct hollow marker and the tooltip shows a "demo" badge.

**`RepChart`**: `BarChart` of `perRep[i].peak` by rep number; too-fast reps coloured `var(--chart-4)` with a legend; `ReferenceLine` at target.

**`JoinLinkDialog`**: opened only with a fresh URL from `sessions.start` or `sessions.regenerateJoinLink` (the raw URL is never stored). Shows the URL in a read-only `Input` with a Copy button; "Share on WhatsApp" (`https://wa.me/<digits>?text=<encoded bilingual message + URL>`; omit the number if the patient has none); "Send SMS" → `sms:${phone}?&body=${encodeURIComponent(msg)}` (shown when the patient has a phone); "Send email" → `mailto:${email}?subject=${encodeURIComponent("PhysioCoach session link")}&body=${encodeURIComponent(msg)}` (shown when the email exists and is not the `.invalid` placeholder). All three are client-side links; no server-side sending in v1. A `QRCodeSVG` (size 192) for the second demo device; "Join as physio" → `/call/[id]`; the link's expiry time.

### 10.2 Patient join page (`/join/[token]`)
Flow: `join.resolve` → **lobby** (camera and mic preview, enabled by default; bilingual placement tip from `exercise.cameraView`: side-on for knee and elbow, front-on for shoulder, whole limb in frame, good light; the exercise how-to in Malayalam and English; big **Join** button) → **call** (`GuidedCallLayout viewer="patient"`) → **ended** (bilingual thank-you).
- No Better Auth session. `CallProvider` builds the Stream client with `user: { id: patient.id, name: patient.name, image }` and `tokenProvider: () => streamToken({ token })`.
- `useIsAutoplayBlocked` → a "Tap to enable sound / ശബ്ദം ഓണാക്കാൻ ടാപ്പ് ചെയ്യുക" overlay that calls `call.resumeAudio()` [V in 1.43.4; U in the installed 1.18.0 → requires the optional SDK bump, otherwise fall back to a user-gesture button that calls `audioElement.play()` on the agent's audio, U].
- The page must work over HTTPS on the second device (ngrok in dev, Dokploy TLS in prod); browsers block cameras on insecure origins.

### 10.3 Shared call layout (`call/ui/components/guided-call-layout.tsx`)
Identify the agent by `participant.userId === AGENT_USER_ID` (if two are briefly present during a restart, pick the one with the latest `joinedAt`); the patient by `useCallCustomData().patientId` (or the member's `custom.app_role`; if `useCallCustomData` is missing in the installed bindings, pass `patientId` down from the call view, which already has it). Do not rely on `participant.roles`. Hooks in react-bindings: `useCallStateHooks()` → `useParticipants`, `useLocalParticipant`, `useRemoteParticipants`, `useCallCustomData`, `useCallMembers`, `useCallCallingState` [V in bindings 1.20.6; U in the installed 1.6.5 until checked in Milestone 0]. `ParticipantView` props: `participant`, `trackType`, `mirror`, `muteAudio`, `className`, `VideoPlaceholder` [V 1.43.4]. **[I]** `ParticipantView` plays that participant's audio unless `muteAudio`; never render two audio elements for the same participant; `ParticipantsAudio` covers participants you do not render [V component exists].

Layout:
- **Patient:** main tile = the agent's annotated video (`object-contain`); own camera as a mirrored PiP (bottom-right, `muteAudio`); rep counter and phase pill overlaid; right column (below on phones): `CaptionsPanel`, `ConsentBanner` (while `phase === "await_consent"`), `PainScale` (highlighted on `pc.request_pain`), `SymptomButtons`, a large red `StopButton`, `CallControls` (leave only; no end-for-all).
- **Physio:** main tile = agent tile; secondary = the raw patient tile; right column: `PhysioLivePanel` (phase, set, last rep peak vs target, live per-rep list, alert banner on `pc.safety_alert` with "Acknowledge"), captions with English lines, `StopButton` (physio stop), "End session for all" (`sessions.end`, `useConfirm`), `CallControls`.
- Below `md`: single column (`h-dvh flex flex-col`), video first, controls in a scrollable panel limited to 45 dvh. From `md`: `grid md:grid-cols-[1fr_360px]`.

```tsx
// call/hooks/use-agent-events.ts
"use client";
import { useEffect, useReducer } from "react";
import { useCall, type CustomVideoEvent } from "@stream-io/video-react-sdk";
import { AgentToClientEvent } from "@/modules/agent-bridge/schemas";
import { AGENT_USER_ID } from "@/constants";

export type AgentFeed = {
  ready: boolean; phase: string; setIndex: number; setsPlanned: number;
  captions: { id: string; ml: string; en: string; kind: string }[];
  lastRep: { n: number; peak: number; target: number; tooFast: boolean; repsPlanned: number } | null;
  awaitingPain: boolean; alert: { reason: string; score?: number } | null; summaries: unknown[];
};
// reducer: pc.ready → ready=true; pc.state → phase/setIndex (ready=true); pc.caption → keep the last 30;
// pc.rep → lastRep; pc.request_pain → awaitingPain=true; pc.set_summary → push; pc.safety_alert → alert.
export function useAgentEvents(): AgentFeed {
  const call = useCall();
  const [state, dispatch] = useReducer(reducer, initialFeed);
  useEffect(() => {
    if (!call) return;
    return call.on("custom", (e) => {                       // on() returns an unsubscribe function [V]
      const ev = e as CustomVideoEvent;
      if (ev.user?.id !== AGENT_USER_ID) return;            // only trust the agent
      const parsed = AgentToClientEvent.safeParse(ev.custom);
      if (parsed.success) dispatch(parsed.data);
    });
  }, [call]);
  return state;
}
```
```tsx
// call/hooks/use-send-input.ts: sends every input twice (custom event + backup tRPC), §7.8
type Opts = { viewer: "patient"; joinToken: string } | { viewer: "physio"; sessionId: string };
export function useSendInput(opts: Opts) {
  const call = useCall();
  const trpc = useTRPC();
  const patientBackup = useMutation(trpc.join.sendInput.mutationOptions());
  const physioBackup = useMutation(trpc.sessions.sendInput.mutationOptions());   // pc.stop only
  return async (event: Omit<ClientToAgentEvent, "v" | "eventId" | "ts">) => {
    const full = { ...event, v: 1, eventId: nanoid(), ts: Date.now() } as ClientToAgentEvent;
    await Promise.allSettled([
      call?.sendCustomEvent(full),                          // [V] video-client Call.sendCustomEvent
      opts.viewer === "patient"
        ? patientBackup.mutateAsync({ token: opts.joinToken, event: full })
        : physioBackup.mutateAsync({ id: opts.sessionId, event: full }),
    ]);
    return full.eventId;
  };
}
```
Components:
- `ConsentBanner`: explains in both languages that the coach watches the video to count reps and nothing is recorded; button **ഞാൻ സമ്മതിക്കുന്നു / I agree** → `send({type:"pc.consent", agreed:true})`, then re-send every 2 s until `phase` leaves `await_consent`. Disabled until `ready`.
- `StopButton`: red, ≥ 64 px tall, "നിർത്തുക / Stop" → `pc.stop`. **Enabled as soon as the call UI renders**, before `pc.ready`; it always sends through both paths (custom event + `join.sendInput`/`sessions.sendInput`), and the backup writes `safety_events` immediately, so the physio is alerted even if the agent is not ready or is dead (§1.4 #8). After pressing: shows "Your physio has been alerted / ഫിസിയോതെറാപ്പിസ്റ്റിനെ അറിയിച്ചു".
- `PainScale`: 11 buttons 0–10 on a green→red gradient, grid of 6 on phones and 11 on desktop, each with an `aria-label`. Sends `pc.pain_score{score, setIndex}`. Highlighted (pulsing ring) when `awaitingPain`; always usable. Score ≥ 7 shows the alert confirmation.
- `SymptomButtons`: "തലകറക്കം / Dizziness", "നെഞ്ചുവേദന / Chest pain", "കഠിനമായ വേദന / Sharp pain" → `pc.symptom`. **Sent on the first tap, never delayed by a confirm step.** A 3 s inline "Undo" may follow, but it only clears the local UI badge; the event and the safety stop are not retracted. Same enable rule as Stop (enabled immediately). **Native review required** for the labels.
- `CaptionsPanel`: last 4 captions; `ml` large (`text-xl font-ml`), `en` small (physio always; patient only if `preferredLanguage === "en"`); `aria-live="polite"`.
- `PhaseIndicator`: pill with a bilingual label per phase. `RepCounter`: `n / repsPlanned`, flashes amber when `tooFast` or `peak < target − 8`.
- `AutoplayUnblock` (§10.2). A "Coach is joining…" placeholder when the agent participant is not present yet; "Coach disconnected" + (physio only) "Restart coach" on `pc.safety_alert{reason:"agent_down"}`.

---

## 11. Milestones

Work in this order. The user's order is preserved (1 → 7) with a hygiene Milestone 0 first. **Spike B (Malayalam audio) is decided before anything is polished.** Milestones 1, 2 and 3 can overlap if you have parallel capacity, but do not start Milestone 4 before the Milestone 2 and 3 checkpoints are approved.

### Milestone 0: Hygiene and safety fixes
**Tasks**
1. **Secrets.** Do **not** print, copy or echo the values in `.env` or `.env.example`. Replace `.env.example` with placeholders for every variable in §13.1. Tell the user, in your checkpoint report, that the Neon password, Stream secret, OpenAI key and `BETTER_AUTH_SECRET` that were in `.env.example` must be **rotated** in the respective dashboards, because the file may have been shared.
2. **Repo location.** Recommend moving the repo out of OneDrive (or excluding `node_modules`, `agent/.venv` and `.next` from sync): OneDrive file locking breaks npm and uv. Ask before moving anything.
3. `git init`; write `.gitignore` (§4.1) **before** the first commit; verify `git status` shows no `.env`; first commit "chore: baseline Meet.AI snapshot". Branch `physiocoach-migration` for all work.
4. `npm install`; `npm run lint`; `npx tsc --noEmit`. Record the baseline errors (if any) in your report; do not fix unrelated ones yet. **Record the installed Stream versions** (`npm ls @stream-io/node-sdk @stream-io/video-react-sdk @stream-io/video-client @stream-io/video-react-bindings`; the lockfile pins 0.4.24 / 1.18.0 / 1.23.2 / 1.6.5, which differ from the versions the [V] tags were checked against). Run `npm install --save-exact @stream-io/node-sdk@0.4.26` so §7.3 matches what was verified. For the React SDK, look up every hook and method used in §10.2–§10.3 (`useCallCustomData`, `useCallMembers`, `StreamVideoClient.getOrCreateInstance`, `useIsAutoplayBlocked`, `call.resumeAudio`, `call.sendCustomEvent`, `call.on("custom")`) in `node_modules/@stream-io/video-react-bindings/dist/**/*.d.ts` and `node_modules/@stream-io/video-client/dist/src/Call.d.ts`; list any you cannot find as [U] in the report (they feed the optional SDK-bump question, Q4).
5. Security and lifecycle fixes that are safe before the domain change (they apply to the current files and carry forward through the renames):
   - webhook: add the `x-api-key` check; stop calling `call.end()` on `call.session_participant_left`; return 200 for unknown meetings.
   - `meetings.generateToken`: upsert with `role: "user"`; use `validity_in_seconds: 3600` and no `exp`/timestamp.
   - `call-connect.tsx`: cleanup calls `leave()` only; `call-ui.tsx` `handleLeave` → `call.leave()`.
   - `trpc/init.ts`: remove the fake `user_123` context.
   - `app/layout.tsx`: providers inside `<body>`; metadata "PhysioCoach"; `globals.css` font token.
   - `(dashboard)/layout.tsx`: session guard (role check comes in Milestone 5 once the column exists).
   - Small bugs from §2.2: sign-up label, sidebar `startsWith`, single `CommandEmpty`, typos, duplicate Stream CSS import, duplicate avatar logic.
6. Add vitest: `vitest.config.ts` with the `@` alias and the `server-only` → `tests/stubs/empty.ts` alias (§4.1), the `typecheck` and `test` scripts, and one trivial passing test that imports a `server-only` module (proves the stub works). Change `dev:webhook` to `node scripts/ngrok.mjs` (§4.1).
7. Make `src/db/index.ts` (and `lib/stream-video.ts`) lazy so `next build` does not need runtime env (§4.3).
8. Do **not** delete the OpenAI/Chat/Inngest code yet. List what will be deleted (from §4) in the report.

**Files:** `.env.example`, `.gitignore`, `package.json`, `src/app/api/webhook/route.ts`, `src/modules/meetings/server/procedures.ts`, `src/modules/call/ui/components/{call-connect,call-ui,call-lobby}.tsx`, `src/trpc/init.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/(dashboard)/layout.tsx`, `src/modules/auth/ui/views/sign-up-view.tsx`, `src/modules/dashboard/ui/components/{dashboard-sidebar,dashboard-command}.tsx`, `src/components/generated-avatar.tsx`.

**Acceptance:** `git status` clean with no secrets tracked; `npm run typecheck` passes (or only pre-existing errors, listed); `npm run test` passes; the existing app still builds (`npm run build`); `.env.example` has no real values.

**STOP AND REPORT (Checkpoint 0):** what you changed; the rotation request; the installed Stream versions and any hooks not found; the list of files to be deleted later; the DEV-1…DEV-16 table (§3.4) for vetoes; the request for `physiocoach.html` (§0.3); the request for an **empty** Postgres database (§6.4; not a data-copy branch) and Stream/Sarvam/Anthropic/Google credentials in the user's local `.env`; the request for a short side-on knee-bend test clip of a consenting team member (Milestone 2 task 8).

### Milestone 1: Rep engine, coach and replay harness in Python, with tests
**Tasks**
1. Create `agent/` with `uv init --package` (Python 3.13), `pyproject.toml` per §4.9, `pytest` config, `agent/README.md`. Split the dependencies as in §4.9: the light core set as `[project] dependencies` (numpy, pydantic, anthropic, httpx) that installs natively on Windows, the `dev` group (pytest), and the full `call` group (vision-agents extras, mediapipe, opencv, ultralytics, CPU torch, fastapi, redis) that is installed in Docker. Try `uv lock` for the full set; if a wheel is missing on Windows, generate the lock inside the Linux container. `core/` must never import the `call` set.
2. `shared/exercises.json` (§6.3) and `shared/phrases.json` (§9.1, all phrases, `review: "pending"`).
3. `core/exercises.py`, `core/angles.py` (§8.4), `core/rep_engine.py` (§8.5), `core/scoring.py` (§8.6), `core/coach_rules.py` (§8.7), `core/phrases.py` (§8.8), `core/safety.py` (`is_safety_trigger(event) -> reason|None`: pain ≥ 7, stop, symptom), `core/contracts.py` (pydantic mirror of §7.7), `core/note_llm.py` (§8.9; the network call is mocked in tests).
4. `replay/synthetic.py` and `replay/cli.py --synthetic ...` (no video yet; video input is added once `pose/` exists).
5. `shared/fixtures/**` and `tests/contracts/test_fixtures.py`.
6. Tests per §12.1.
7. If the user supplied `physiocoach.html`, port and add golden tests (§0.3).

**Acceptance:** `cd agent && uv run pytest tests/core tests/contracts -q` passes natively on Windows; coverage of `core/` ≥ 90 % lines; `uv run python -m physiocoach.replay.cli --synthetic clean --exercise knee_bend --target 60 --reps 10` prints 10 count cues and the note; the demo note test (§8.7) passes; score example 88.0 passes.

**STOP AND REPORT (Checkpoint 1):** test output; any implementation choices you made where the spec was silent (side lock window and lock lifecycle, dropout prompt, rep-engine arming and the 3 s long-dropout abort, depth-before-tempo cue priority, `next_more_reps`/`next_step_id`, the clause structure of the rule note, score 0 for zero reps); differences from the prototype if it was supplied.

### Milestone 2: Spike A (agent joins a Stream call, sees the patient, publishes an annotated tile via a VideoPublisher-only PoseProcessor, DEV-13)
Do this in Docker/WSL2 (`docker compose run agent-worker ...`); native Windows is untested for aiortc/av [U].

**Tasks**
1. Minimal `agent_main.py` (the explicit `amain`, §8.14) with `NoLLM`, `getstream.Edge()`, no TTS, a `PoseProcessor` and a stub flow. A dev script `scripts/dev-create-call.ts` (run with `npm run dev:create-call`, react-server condition, §4.1) creates a call with `createGuidedCall` and prints a physio token and a patient call token for manual testing in the existing call UI.
2. Join an **existing** call by id with `agent.create_call` + `agent.join(call, participant_wait_timeout=None)`.
3. `PoseProcessor` as `VideoPublisher` only (DEV-13): subscribe to `TrackAddedEvent`, filter on the patient's `user_id`, `add_track_subscriber`, own `VideoForwarder`, `QueuedVideoTrack` out. Test with the **physio joining first** with camera on: the patient's track must still be processed.
   - **3a [U].** Log whether `add_track_subscriber` returns a track and whether the forwarder receives frames when no `VideoProcessor` exists. If not, walk the fallback ladder in §8.11 (no-op `process_video` → custom `subscription_config` → DEV-13 vetoed path) and report which step worked.
4. Implement `pose/mediapipe_backend.py` (including `presence` and the off-frame rule) and `pose/yolo_backend.py` after verifying their APIs ([U] items in §8.3); `pose/draw.py` overlay and `placeholder_frame`; compute the knee angle live and show it on the tile. Use frame `pts` for timestamps (§8.11).
5. Measure: inference ms/frame for both backends at 960×540 input on the dev CPU and on the target VPS if available; end-to-end tile fps; CPU % per session; memory.
6. Test the private custom-event hook (§8.12): send `pc.consent` from the browser console (`call.sendCustomEvent({...})`) and log receipt; measure how long after join events start arriving; test `pc.ready` from the agent arriving in the browser (`call.on("custom")`).
7. Chat side effect: implement the no-op `create_conversation` `StreamEdge` subclass (§8.13) and confirm the agent still joins, publishes and speaks. If the no-op is unsafe, **STOP AND REPORT**; do not fall back to keeping the Chat channel on your own.
8. **Test clip and golden file.** Check the `VideoFileTrack` import path. Commit `agent/replay/clips/knee_test.mp4` (any short side-on knee-bend video of a consenting team member; or store it as a CI artifact if the user prefers), feed it through `attach_file` and through `replay.cli` at `POSE_FPS`, and record `tests/replay/golden/knee_test.<backend>.cues.jsonl` for **both** backends. From now on `tests/replay/test_golden.py` is mandatory in the Docker test run (§12.1).

**Acceptance:** the agent tile appears in both browsers with a skeleton and a live knee angle; before consent the tile shows the placeholder, not raw video; the patient's track is processed even when the physio joined first; custom events arrive both ways (or the failure is documented); measurements recorded; the video golden test passes for both backends.

**STOP AND REPORT (Checkpoint A):** measurements table (backend, input size, ms/frame, tile fps, CPU %); the chosen default backend and output size; the result of task 3a (and which fallback step, if any, was needed); custom-event hook result and observed join→events delay; chat side-effect result (the no-op works, or the explicit question to the user); MediaPipe `presence` field present or not; any [U] items resolved (update §15 of this document's risk register in your report, not the file itself unless asked). **Exit criteria and fallbacks:**
| Check | Fails if | Fallback |
|---|---|---|
| Custom-event hook | events do not arrive | `join.sendInput` → Redis path becomes primary |
| CPU | < 8 fps end to end | 640×360 @ 8 fps, `pose_landmarker_lite`, or YOLO ONNX |
| Track routing (3a) | patient track not received, or no frames | §8.11 ladder: no-op `process_video` that forces video subscription → custom `subscription_config` → patient joins first / physio camera off |
| Chat no-op | the agent breaks without a conversation | STOP AND REPORT; the user decides (§8.13) |

### Milestone 3: Spike B (Malayalam audio into the call)
**Tasks**
1. `sarvam.TTS(model="bulbul:v3", language="ml-IN", speaker="shubh", sample_rate=24000)` as the agent's `tts`; `await agent.say("ഒന്ന്, രണ്ട്, മൂന്ന്")` on a real call. Check the two doc/plugin mismatches (§9.2). If broken, subclass and fix.
2. Measure time from `say()` to first audio heard (stopwatch + logs), for a count word and for a 3-sentence note. Determine whether `agent.say` returns before or after playback ([U] in §8.10).
3. Implement `voice/wav.py`, `voice/render_catalogue.py`, `voice/cached_tts.py` (including `start`/`close` forwarding; check whether the base `TTS` lifecycle calls `start()`, §8.10 [U]), `voice/google_tts.py`. Render the full catalogue for 2 Sarvam speakers (e.g. `shubh`, `ishita`) and Google `Kore`/`Charon`.
4. Play cached clips through the call; confirm they play instantly and at the right loudness and pitch (check sample rate handling: 24 kHz clips resampled to 48 kHz). Play a full rule note **id by id** through the `Speaker` and assert zero runtime-TTS calls (§8.10). Measure the Sarvam WebSocket reconnect cost and pick `idle_timeout`/keep-alive.
5. Barge-in prototype: Silero on the physio's PCM; interrupt with `tts.interrupt()` + `audio_track.flush()`; measure the delay from the physio starting to speak to the agent going quiet; test echo with speakers (not headphones).
6. Write the voice contract test (§12.3) against the manifest.

**Acceptance:** Malayalam counts audible in the call for both participants; cached clip latency < 300 ms from trigger; runtime TTS latency measured; barge-in silences the agent in < 500 ms; voice contract test passes for `pending` status (approval comes later).

**STOP AND REPORT (Checkpoint B):** latency numbers; candidate voice files for the native-speaker A/B (paths); the mismatch findings; barge-in numbers and echo behaviour. **The user picks the voice before you lock the manifest.** Exit criteria: if Sarvam quality or latency is bad → Google Chirp 3 HD at runtime with clips in the same voice; if all runtime TTS fails → rule notes only (fully pre-rendered).

### Milestone 4: Agent call-flow state machine
**Tasks**
1. `call/flow.py` per §8.15, `call/speaker.py`, `call/inputs.py` (custom events + Redis), `call/bargein.py`, `call/outbox.py` (with a local stub receiver for now).
2. Safety: every trigger enters `halted` within one tick through task cancellation (§8.15 skeleton); `safety.stop` pre-empts audio (after the physio gate releases); halt, alert event and callback are never delayed. Subscribe to `CallEndedEvent` and install the SIGTERM handler (§8.14).
3. Consent gate: assert in a test that `pose.enabled` is False until `on_consent` and that `PoseBackend.infer` is never called before it.
4. Positioning prompts; countdown; set with live cues; summary with the rule note (LLM wired but disabled by default until Milestone 6); pain input; multiple sets; rest; done.
5. Patient leave/rejoin; physio join announcement; heartbeat.
6. Unit tests with a fake agent/edge/speaker (§12.1) and an in-call replay run with a recorded clip.

**Acceptance:** a full live session on a real call: greet → consent → positioning → countdown → set with Malayalam counts and cues → spoken note → pain buttons (driven from the browser console until Milestone 5's UI exists) → done; Stop, pain 7 and each symptom halt the set immediately in tests and live.

**STOP AND REPORT (Checkpoint 4):** a short screen recording or log excerpt of the flow; any timeouts you tuned.

### Milestone 5: Backend, patient join page, physio dashboard
**Tasks (web)**
1. Schema §6.1 on an **empty** database (§6.4); `db:generate`, review the SQL (it creates everything, including the Better Auth tables), `db:migrate`, `db:seed`, `db:seed -- --demo`.
2. Better Auth `additionalFields`, `inferAdditionalFields`, `physioProcedure`, the role guard in `(dashboard)/layout.tsx`, the role router `app/page.tsx`.
3. **Pre-delete checkpoint (STOP AND REPORT):** list every file and dependency to be deleted (OpenAI, Chat, Inngest, transcript/recording UI, `public/` leftovers) with the reason; wait for approval; then delete and uninstall.
4. Renames per §4.4–§4.8 (agents → patients, meetings → sessions, home → overview); new modules (prescriptions, exercises, join, analytics, notes, agent-bridge).
5. `lib/stream-video.ts`, `lib/join-token.ts`, `lib/signing.ts`, `lib/agent-worker.ts`, `lib/rate-limit.ts`; `sessions.start` per §7.4; `/api/agent/events`; webhook per §7.5.
6. `scripts/ensure-call-type.ts`: first read the `default` type's grants with `getCallType` and copy any event/reaction capabilities into the new grant list (§7.3 [U]); run it only after asking; then run the Spike A custom-event smoke test (browser → agent and agent → browser) on a `physio_session` call. **STOP AND REPORT (call-type checkpoint)** so the user can verify grants in the Stream dashboard before switching `STREAM_CALL_TYPE=physio_session`.
7. Call module per §4.7 and §10.3; patient join page §10.2; dashboard pages §10.1 (ROM trend, adherence, pain flags; weekly summary with rule text).

**Tasks (worker)**
8. `control/api.py`, `control/supervisor.py`, `control/auth.py`; Redis keys; exit-code mapping; reaper; `docker-compose.yml` with `redis` and `agent-worker`.
9. Outbox pointed at the real `/api/agent/events`.

**Acceptance:** from the dashboard, "Start guided session" creates a session, the agent joins within ~10 s, the patient link works on a second device over HTTPS, the whole flow runs, set results and pain appear on the session page within 2 s, pain ≥ 7 shows a red flag on the overview, and the session ends cleanly (`done`) when the physio ends it. `npm run typecheck`, `npm run lint`, `npm run test`, `uv run pytest` all pass. Contract fixtures pass on both sides.

**STOP AND REPORT (Checkpoint 5):** demo of steps 1–5 of §1.3; remaining gaps.

### Milestone 6: LLM post-set note and weekly summary
**Tasks**
1. Enable `NOTE_LLM_ENABLED=true`; finish `validate_note`; test with mocked responses (valid, invalid JSON, extra keys, wrong digits, 1 or 4 sentences, deny-listed words, non-Malayalam `ml`, timeout, refusal stop reason) and one real call against `claude-sonnet-5-5`.
2. Measure real latency; keep the 3.5 s LLM budget and the 3.0 s note-TTS prefetch budget; confirm the rule fallback is instant and that captions/audio/DB always agree on the source (prefetch-then-commit, §8.9).
3. Server-side fallback: run a forced-refusal test with `fallbacks="default"` and `between_tools` in the body (§8.9). If the fallback path rejects `between_tools`, drop it on that path and re-measure.
4. Weekly summary: SQL + rule text (if not already done) and `generateWeeklySummary` (TS Anthropic SDK, §8.9) with the same validation (`.strict()`) and fallback; upsert `weekly_summaries`.

**Acceptance:** with the network to Anthropic blocked, everything still works with `feedbackSource="rules"`; with it open, notes come from the LLM when valid; all validation tests pass.

**STOP AND REPORT (Checkpoint 6):** example LLM notes (ml + en) for 3 synthetic sets for the user's review; latency numbers; the result of the forced-refusal test; tell the user the server-side `fallbacks` option (§8.9) is **on by default** and ask whether to keep it.

### Milestone 7: Demo script, native review, replay fallback, deploy
**Tasks**
1. Native-speaker review session: export a review sheet (CSV: id, ml, en, file) and play every clip; update `phrases.json`, re-render changed clips, set `review.status = "approved"` in the manifest.
2. Record `agent/replay/clips/knee_demo.mp4` (with the presenter's consent; it is a demo asset, not patient data) performing **exactly the runbook movement** (§14: 10 slow reps, ≥ 2 s each, consistent bend of about 45–50°). Verify in-call replay and offline replay (§8.17); `replay.cli` on it must print note ids `[note.good_effort, note.achieved_bend.4x, note.target.60, note.more_reps.3]` with `4x < 52`. Record its golden cue file.
3. Dokploy deploy (§13.2); smoke test on the deployed URLs; a full **end-to-end rehearsal on the demo network** following §14.
4. Write `README.md` and the demo runbook card.

**Acceptance:** voice contract test passes with `approved` for every clip the demo can emit; two full rehearsals on the demo network succeed; replay fallback rehearsed once.

**STOP AND REPORT (Checkpoint 7):** rehearsal results and the go/no-go list.

---

## 12. Testing strategy

### 12.1 pytest (`agent/tests`)
**`tests/core/test_angles.py`**
- `joint_angle` on right angles, straight lines (180), folded (≈ 0), degenerate (coincident points → None).
- Pixel space: the same normalised points on a 1280×720 frame give a different (correct) angle than naïve normalised math; assert the pixel result equals the hand-computed value.
- `mode_value` flex/direct; knee at 120° → 60.
- Confidence gate: any joint < 0.5 → `None` and the EMA is unchanged.
- EMA: first sample initialises; sequence `[0, 10]` → `0.6·0 + 0.4·10 = 4.0`.
- `SideSelector`: auto picks the higher summed confidence after the window and stays locked; fixed side ignores confidence; `force_lock()` locks with partial totals; a countdown (new `Ema` + new `RepEngine`) does not change the locked side; only `reset()` (re-entering positioning) re-picks.
- MediaPipe conversion helper (pure function in `pose/`, tested in Docker): `min(visibility, presence)`; landmarks outside [0, 1] get confidence 0.

**`tests/core/test_rep_engine.py`** (signals from `replay/synthetic.py`, knee_bend thresholds rest 15 / start 25 / minPeak 35, min s/rep 2)
- clean 10 reps → 10 counted, 0 too fast, peaks ≈ 65.
- fast (1.2 s) → 10 counted, 10 too fast.
- shallow (peak 30) → 0 counted, 10 `RepRejected("shallow")`.
- too_short (0.5 s excursions) → 0 counted, rejected `too_short`.
- boundary: duration exactly 0.6 s → **not** counted (strict `>`); peak exactly 35 → counted (`>=`).
- jitter ±6° → exactly 10 (EMA + hysteresis).
- dropout (conf 0.3 frames inside reps, 0.4 s and 1.5 s gaps) → count unchanged.
- `abort_in_progress` mid-rep → that rep is never counted.
- prebent: a signal that starts at 50 and returns to 5 → **0** reps (arming).
- long_dropout: a gap > 3 s while moving → the in-progress rep is discarded and the engine disarms until `v < rest`.
- elbow_bend and shoulder_raise threshold sets (one clean signal each).

**`tests/core/test_scoring.py`**: the 88.0 example; zero reps → 0; avgPeak above target caps at 1; all fast → tempo term 0; reps above planned caps at 1; clamp to [0, 100].

**`tests/core/test_coach_rules.py`**: `live_cue_ids` (count only; depth cue when peak < target − 8; slow cue when fast and deep enough; depth wins when both; flex vs direct verb); `rule_note_ids` for the demo case, near target (target − 8 ≤ avg < target → `note.target`), target reached (`note.target_reached` + `note.keep_reps.{planned}`), target reached but fast, short + fast, zero reps, reps short of planned (`more_reps = planned − done`, capped at 10); **every branch renders to 2–3 sentences in both `ml` and `en`** (same splitter as `validate_note`); every produced id exists in the catalogue; rendered `ml`/`en` strings match golden text.

**`tests/core/test_note_llm.py`**: mocked client returns valid JSON → `llm`; invalid JSON → `rules`; extra keys → `rules` (`extra="forbid"`); a wrong number → `rules`; a correct tempo number (`minSecondsPerRep`) → `llm`; 1 or 4 sentences → `rules`; deny-listed word → `rules`; English in `ml` → `rules`; `asyncio.TimeoutError` → `rules`; `stop_reason="refusal"` → `rules`; no API key → `rules` without a network call; with `NOTE_LLM_SERVER_FALLBACK=true` the request uses `client.beta.messages.create` with the `server-side-fallback-2026-07-01` beta and `fallbacks="default"`.

**`tests/core/test_safety.py`**: pain 6 → none, pain 7 → `pain`; stop → `stop`; each symptom → `symptom`.

**`tests/call/test_flow.py`** (fake agent, edge, speaker, outbox, pose; virtual clock): consent gate (no `infer` before consent); full happy path emits the expected `pc.state` phase sequence and `set_result`; Stop during positioning/countdown/set/summary → `halted` within one tick, `safety.stop` spoken first, `safety_alert` posted, partial set posted with `stopReason`; pain 7 in `await_pain` → `halted`; patient leaves 30 s and returns → resumes; leaves > 60 s → exit 4; no consent 5 min → exit 5; physio speaking → no `say` calls while gated, captions still sent; **Stop while the physio is speaking → `halted`, `pc.safety_alert` and the `safety_alert` callback happen immediately, and `safety.stop` audio plays only after the gate releases**; **`pc.stop` during a mocked 3 s LLM call (and during a 30 s rest) reaches `halted` in under 50 ms of virtual time**; `CallEndedEvent` mid-set → partial set with `stopReason="disconnected"`, exit 0; `cfg.consentGiven=True` skips `await_consent`; the audio clip set is Malayalam for `patient.lang` `ml` and `en` (DEV-16); the `safety_alert` callback carries the triggering input's `eventId` as `clientEventId`; rule notes and live cues are spoken id by id with **zero** runtime-TTS calls; an LLM note whose TTS prefetch times out falls back to the rule note with caption, audio and `feedbackSource="rules"` all agreeing; duplicate `eventId` processed once; inputs from the wrong sender ignored.

**`tests/call/test_outbox.py`**: the signature is recomputed on every attempt (a retry after a simulated 400 s outage is accepted); 401 retried up to 5 times; 400 → `pc:outbox:dead:{sid}`; `eventId` stable across retries.

**`tests/replay/test_golden.py`**: run the replay pipeline (at `POSE_FPS`) on synthetic signals and on the committed video clips with stored expected cue sequences (`tests/replay/golden/knee_test.<backend>.cues.jsonl` from Milestone 2, `knee_demo.<backend>.cues.jsonl` from Milestone 7); assert the rep count and the exact cue-id sequence **for each `PoseBackend` (mediapipe and yolo)**. In the Docker test run (`docker compose run agent-worker-test uv run pytest tests/replay`) the video tests are **mandatory**; a skip is allowed only in the native-Windows core run, where the pose models are not installed.

**`tests/contracts/test_fixtures.py`**: every `shared/fixtures/**/valid/*.json` parses with the pydantic models; every `invalid/*.json` fails.

**`tests/smoke/test_private_hooks.py`** (runs inside Docker with `vision-agents==0.6.9` installed): asserts `StreamEdge` still has `_connection`/`_real_connection`, `ConnectionManager` has `on`, and `AudioStreamTrack` has `flush`; and that `PoseProcessor`'s `TrackAddedEvent` handler fires for a synthetic event (guards the type-hint routing rule in §8.1). Fails loudly after an upgrade.

### 12.2 Web tests (vitest) and static checks
- `tests/join-token.test.ts`: sign/verify round trip; tampered body/signature; expired; wrong version; hash matches.
- `tests/signing.test.ts`: HMAC header format; stale timestamp rejected; **a signature made for `GET /sessions/A` is rejected on `DELETE /sessions/A` and on `GET /sessions/B`**; a body change is rejected.
- `tests/agent-events.test.ts`: route handler with a mocked `db`: bad signature → 401; bad schema → 400; `set_result` upsert idempotent on `eventId`; `pain_recorded` updates `pain` and inserts **no** safety row; `safety_alert` for the same pain event inserts exactly one row even when the UI and webhook copies arrive first; `agent_exited` mapping table (every `FailureReason`); `agent_down` key `agent_down:<sid>:<pid>` dedupes the webhook and exit copies.
- `tests/webhook.test.ts`: unknown call → 200 ignored; `participant_left` never calls `call.end`; `session_ended` with/without sets.
- `tests/adherence.test.ts`: week boundaries in Asia/Kolkata; replay sessions excluded by default and included with `includeReplay`.
- `tests/schemas.test.ts`: `patientsUpdateSchema` exists (built from the base object) and still enforces phone-or-email; the prescription form schema accepts numeric strings from inputs (`z.coerce`); `""` phone/email is normalised to `null` before insert.
- `tests/fixtures.test.ts`: zod parses the same fixtures as pytest.
- `npm run typecheck`, `npm run lint`, `npm run build` must pass before every checkpoint.

### 12.3 Voice contract test (`agent/tests/voice_contract/test_catalogue.py`)
For every concrete phrase from `expand_all()` (every template over its full parameter range, plus every id the flow can emit): the active voice manifest contains a clip with a matching hash, the file exists, duration > 200 ms and the audio is non-silent (RMS above a floor). In `DEMO=1` mode, additionally require `review.status == "approved"`. A separate opt-in test (`RUN_TTS_NETWORK=1`) calls the runtime TTS for 3 non-catalogue strings and asserts > 200 ms of non-silent audio.

### 12.4 End-to-end rehearsal checklist (on the demo network, before the demo)
- [ ] Deployed `web` and `agent-worker` healthy (`/healthz`); Redis up; Neon reachable.
- [ ] Stream webhook URL points at the deployed `/api/webhook`; a test event returns 200.
- [ ] Physio logs in on the laptop; demo prescription exists (knee_bend, 60°, 10 reps, 2 s).
- [ ] "Start guided session" → agent tile appears ≤ 15 s.
- [ ] Patient link opened on the second device via QR; HTTPS; camera permission granted; sound unblocked.
- [ ] Greeting audible on both devices; consent button works; tile switches to annotated after consent.
- [ ] Positioning prompt and `pos.ok`; countdown; counts in Malayalam on every rep; one cue max per rep.
- [ ] Deliberately shallow set (all 10 reps slow, ≥ 2 s each, consistently about 45–50°) → note says "good effort", the achieved angle vs 60° and "3 more reps, slowly". Pre-check: `replay.cli` on `knee_demo.mp4` prints note ids `[note.good_effort, note.achieved_bend.4x, note.target.60, note.more_reps.3]`.
- [ ] Stop button works before the coach has joined (backup path writes the safety flag).
- [ ] Pain buttons; pain 7 → safety stop + red flag on the dashboard within 2 s.
- [ ] Physio speaks → agent stops talking; resumes after.
- [ ] Dashboard ROM trend (with the seeded history), adherence, pain flag and weekly summary update.
- [ ] Replay fallback run once end to end; afterwards the ROM trend and adherence update on the dashboard (`NEXT_PUBLIC_DEMO_MODE=true`).
- [ ] Network-loss drill: kill the Anthropic route → notes fall back to rules with no audible gap.

---

## 13. Environment, deployment and local development

### 13.1 Environment variables
All are server-side unless prefixed `NEXT_PUBLIC_`. `.env.example` lists every name with placeholder values only.

**web**
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `BETTER_AUTH_SECRET` | ≥ 32 random bytes |
| `BETTER_AUTH_URL` | e.g. `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | public base URL (used in join links) |
| `NGROK_DOMAIN` | dev only, static ngrok domain (no scheme) |
| `NEXT_PUBLIC_STREAM_VIDEO_API_KEY` | Stream API key (public) |
| `STREAM_VIDEO_SECRET_KEY` | Stream secret |
| `STREAM_CALL_TYPE` | `default` until `physio_session` is verified |
| `NEXT_PUBLIC_STREAM_AGENT_USER_ID` | `physiocoach-agent` |
| `JOIN_LINK_SECRET` | ≥ 32 random bytes |
| `AGENT_WORKER_URL` | `http://agent-worker:8080` (Docker) or `http://localhost:8080` (dev) |
| `AGENT_CONTROL_SECRET` | HMAC for web → worker |
| `AGENT_CALLBACK_SECRET` | HMAC for worker → web |
| `AGENT_REPLAY_CLIPS` | comma-separated allow-list, e.g. `knee_demo.mp4` |
| `ANTHROPIC_API_KEY` | weekly AI summary |
| `NOTE_LLM_SERVER_FALLBACK` | `true` (server-side refusal fallback for the weekly summary, §8.9) |
| `NEXT_PUBLIC_DEMO_MODE` | `true` only for the demo deployment: dashboard passes `includeReplay` (DEV-14) |
| `ALLOW_SIGNUP` | optional, `true` to allow physio sign-up |

**agent-worker**
| Variable | Purpose |
|---|---|
| `STREAM_API_KEY`, `STREAM_API_SECRET` | **same Stream app** as web, under the names getstream 4.x reads [V] |
| `WEB_INTERNAL_URL` | `http://web:3000` (Docker) or `http://host.docker.internal:3000` (dev) |
| `AGENT_CONTROL_SECRET`, `AGENT_CALLBACK_SECRET` | as above |
| `REDIS_URL` | `redis://redis:6379/0` |
| `SARVAM_API_KEY` | primary TTS |
| `GOOGLE_APPLICATION_CREDENTIALS` | path to a mounted service-account JSON (fallback TTS) |
| `ANTHROPIC_API_KEY` | post-set note |
| `NOTE_LLM_ENABLED`, `NOTE_LLM_TIMEOUT_S`, `NOTE_LLM_SERVER_FALLBACK`, `NOTE_TTS_TIMEOUT_S` | `true`, `3.5`, `true`, `3.0` |
| `VOICE_SLUG` | the locked voice, e.g. `sarvam-bulbul-v3-<speaker>-p090` |
| `SARVAM_SPEAKER`, `GOOGLE_TTS_VOICE` | runtime voices matching the clips |
| `POSE_BACKEND` | `mediapipe` or `yolo` |
| `POSE_FPS`, `POSE_OUT_W`, `POSE_OUT_H` | `12`, `960`, `540` |
| `MAX_SESSIONS` | `2` on 4 vCPU (measure) |
| `PATIENT_JOIN_TIMEOUT_S` | `900` |
| `BARGEIN_MIN_RMS` | `0.02` |
| `PC_SHARED_DIR` | `/app/shared` |
| `WORKER_HOST` | host label stored in `agent_pid` |

**Removed:** `OPENAI_API_KEY`, `NEXT_PUBLIC_STREAM_CHAT_API_KEY`, `STREAM_CHAT_SECRET_KEY`, Inngest keys.

### 13.2 Docker and Dokploy
**`Dockerfile` (web)**: multi-stage `node:22-slim`:
- `deps`: `npm ci` (with devDependencies).
- `build`: `npm run build` (`output: "standalone"`). Builds without runtime secrets because `db` and the Stream client are lazy (§4.3); pass only `NEXT_PUBLIC_*` values as build args (they are inlined into the client bundle).
- `runtime`: copies `.next/standalone`, `.next/static` and `public` only; serves the app. `HEALTHCHECK` on `GET /api/health` (add a trivial route returning `{ok:true}`).
- `migrator`: built from `deps` (full `node_modules`, so `drizzle-kit` and `tsx` exist; neither is in the standalone output) plus `drizzle/`, `drizzle.config.ts`, `shared/`, `src/db/`; command `npx drizzle-kit migrate && npm run db:seed`. Dokploy runs this image as the **pre-deploy job**; the runtime image never runs migrations.

**`agent/Dockerfile`** (build context = repo root):
```dockerfile
FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 ffmpeg curl && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv
WORKDIR /app/agent
ARG INSTALL_DEV=0
# 1) dependencies only (cached layer); the project itself is not built yet
COPY agent/pyproject.toml agent/uv.lock ./
RUN uv sync --frozen --group call --no-install-project $( [ "$INSTALL_DEV" = "1" ] || echo "--no-dev" )
# 2) project source, then install the project itself
COPY agent/ ./
RUN uv sync --frozen --group call $( [ "$INSTALL_DEV" = "1" ] || echo "--no-dev" )
COPY shared/ /app/shared/
# 3) bake models (no runtime downloads). URLs are [U]: verify them and record sha256 in models/SHA256SUMS
RUN mkdir -p models \
 && curl -fsSL -o models/pose_landmarker_full.task https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task \
 && curl -fsSL -o models/yolo26n-pose.pt <ultralytics-assets-release-url-for-yolo26n-pose.pt> \
 && curl -fsSL -o models/silero_vad.onnx <silero-vad-onnx-url> \
 && cd models && sha256sum -c SHA256SUMS
# voice assets: agent/assets/voice/<VOICE_SLUG>/** are copied with agent/ (or added from the build artifact)
ENV PC_SHARED_DIR=/app/shared PYTHONUNBUFFERED=1 UV_NO_SYNC=1 PATH=/app/agent/.venv/bin:$PATH
HEALTHCHECK --interval=15s --timeout=3s CMD curl -fsS http://localhost:8080/healthz || exit 1
CMD ["uvicorn", "physiocoach.control.api:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
```
- Two-step `uv sync` (`--no-install-project` before the source is copied) is required: with `uv init --package` the project must be built from source, so a single sync before `COPY agent/ ./` fails.
- `UV_NO_SYNC=1` and calling `uvicorn` from the venv `PATH` stop `uv run` from re-syncing (and pulling the `dev`/`tools` groups) at container start.
- The `tools` group (`sounddevice`, `pyloudnorm`) is never installed in the image. The test image is the same Dockerfile with `--build-arg INSTALL_DEV=1` (compose service `agent-worker-test`).
- **[U]** The exact file name and directory `SileroVADSessionPool.load(model_dir)` expects, and the YOLO/Silero download URLs: confirm in Spike A/B, then fill in the placeholders and `SHA256SUMS`.
- The reference Vision Agents Dockerfile uses the same base (`python:3.13-slim` + uv) [V]. YOLO weights and the Silero ONNX are otherwise downloaded at runtime [V]; bake them.
- Torch must resolve to the CPU wheels (§4.9); check the image size and `uv tree`.

**`docker-compose.yml`**: services `redis` (`redis:7-alpine`, `--appendonly yes`), `agent-worker` (build as above, env file `agent/.env`, `extra_hosts: ["host.docker.internal:host-gateway"]`, port 8080 published only to localhost in dev), optional `web`. Also `agent-worker-test` (same build with `INSTALL_DEV=1`, no ports) for the mandatory replay tests. In Dokploy: three applications on one internal network (plus the `migrator` pre-deploy job); only `web` gets a domain and TLS; `agent-worker` has no public domain; set resource limits (≈ 1.5 GB RAM and 2 vCPU per concurrent session). Configure Traefik/Dokploy access logs to drop or redact request paths matching `/join/` (the join token, §7.2).

### 13.3 Local development on Windows
- **web:** native `npm run dev` on :3000. `npm run dev:webhook` (runs `scripts/ngrok.mjs`, which reads `NGROK_DOMAIN` from `.env`; ngrok static domain) for HTTPS: required for the second device's camera and for Stream webhooks. Set `NEXT_PUBLIC_APP_URL=https://$NGROK_DOMAIN` while testing on a second device, add the domain to `allowedDevOrigins` and Better Auth `trustedOrigins`, and set the Stream dashboard webhook URL to `https://$NGROK_DOMAIN/api/webhook`.
- **agent-worker + Redis:** `docker compose up --build redis agent-worker` on Docker Desktop with WSL2. The worker reaches web at `http://host.docker.internal:3000`; web reaches the worker at `http://localhost:8080`.
- **Pure core + synthetic replay:** natively: `cd agent && uv sync && uv run pytest tests/core`.
- **Running one agent by hand (debug):** `docker compose run --rm -e PC_SESSION_JSON="$(cat dev-session.json)" agent-worker python -m physiocoach.agent_main --session-id dev1` (run from Git Bash or WSL; PowerShell needs `$(Get-Content dev-session.json -Raw)`).
- **Mandatory replay tests:** `docker compose run --rm agent-worker-test pytest tests/replay`.
- Install tools: Node 22, Docker Desktop (WSL2 backend), uv (`winget install astral-sh.uv` or `pip install uv`), ngrok.

---

## 14. Demo runbook (3 minutes)

**Before going on stage (T−30 min):** run the §12.4 checklist; open the dashboard on the laptop (logged in) at the demo prescription; have the QR dialog ready to show; second device charged, on the same reliable network, brightness up, browser already granted camera permission for the domain; volume up on both; physio headset muted (avoids echo-triggered barge-in); the offline replay command typed in a terminal; the screen recording ready.

| Time | Step | What the audience sees | Presenter action | If it fails |
|---|---|---|---|---|
| 0:00–0:20 | Problem | Slide or verbal: Kerala, ageing population, unsupervised home exercise | Speak | — |
| 0:20–0:40 | 1. Prescription + start | Prescription page: knee bend, target 60°, 10 reps, ≥ 2 s per rep. Click **Start guided session**. Join link dialog with QR. | Click; "Join as physio" opens the call on the laptop | Toast error → click again (idempotent); if the worker is down → in-call replay won't help either → go to the offline replay |
| 0:40–1:00 | 2. Patient joins | Second device scans the QR, lobby, Join. Agent greets in Malayalam; captions show ml (patient) and ml+en (physio). Patient taps **ഞാൻ സമ്മതിക്കുന്നു / I agree**. | Hold the device facing the "patient" | No sound → tap "Tap to enable sound"; consent not registering → it re-sends automatically; the backup path also delivers |
| 1:00–1:50 | 3–4. Exercise | Positioning prompt → countdown → knee bends. Annotated tile on both screens: skeleton, `n / 10`, gauge with target line. Malayalam counts; the shallow reps trigger "കുറച്ചുകൂടി മടക്കൂ". | Patient does **all 10 reps slowly (≥ 2 s each) at a consistent shallow bend of about 45–50°**: above the 35° minimum so every rep counts, below 52° (= target − 8) so the "good effort … 3 more reps" note plays. (Six good reps plus four shallow ones would average about 52° and take the "well done" branch instead.) | Tracking lost → step back/more light per the voice prompt; agent crashed → physio clicks **Restart coach** (set index continues, consent is kept) |
| 1:50–2:20 | Note + pain | Spoken note: "Good effort, you bent to 48° on average, but the target is 60°. Next: do 3 more reps, slowly." Pain scale highlighted; patient taps 3. | — | LLM slow → the rule note plays instantly (same content) |
| 2:20–2:45 | 5. Dashboard | Laptop: session page shows the set (score, per-rep chart); patient page ROM trend vs target (seeded history plus today's point), adherence, weekly summary. Optional: second session tap pain 7 → red flag appears within 2 s. | Navigate | Polling lag → refresh |
| 2:45–3:00 | Close | "Live supervised practice for patients, data for physios. It supports the prescription, never diagnoses." | Speak | — |

**Fallback ladder (step 6):**
1. Network flaky but up → **in-call replay**: Start replay (demo) on the prescription page; same tile, voice and dashboard (the demo deployment sets `NEXT_PUBLIC_DEMO_MODE=true`, so the replay session appears in the ROM trend and adherence with a "demo" badge, DEV-14).
2. Stream/Internet down → **offline replay** on the laptop: `uv run python -m physiocoach.replay.cli agent/replay/clips/knee_demo.mp4 --exercise knee_bend --target 60 --reps 10 --min-seconds 2 --play-audio` (preview window + local Malayalam audio; requires the `tools` group: `uv sync --group tools`).
3. Laptop problem → play the pre-recorded screen capture.

---

## 15. Risks and open questions register

| # | Risk / question | Status | Mitigation / owner milestone |
|---|---|---|---|
| R1 | Malayalam TTS quality and latency (every provider) | [U] | Native-speaker A/B (M3, M7); fully pre-rendered rule speech means the demo never depends on runtime TTS |
| R2 | Sarvam plugin vs docs mismatches (`target_language_code` vs `language_code`; `linear16` vs "MP3 only"); plugin rejects `bulbul:v4-flash` | [V] mismatch exists; [U] impact | Spike B; subclass the plugin if needed |
| R3 | Inbound custom events rely on a private attribute (`edge._connection`/`_real_connection`) and a background coordinator watch (early events lost) | [V] mechanism; [U] stability | Pin `vision-agents==0.6.9`; smoke test; `pc.ready` handshake; Redis backup path |
| R4 | Whether the agent (a call member joined server-side) receives custom events under our call-type permissions | [U] | Spike A |
| R5 | `getstream<5` pin while upstream is 6.x | [V] | Never add getstream 6.x to the worker |
| R6 | CPU budget: pose inference + aiortc software encode + Silero per session | [U] | Spike A measurements; `MAX_SESSIONS`; lower fps/size |
| R7 | MediaPipe 1.1.0 Tasks API names | [U] | Verify in Spike A |
| R8 | Ultralytics numpy colour order (BGR) | [U] | Verify in Spike A |
| R9 | `VideoFileTrack` import path | [U] | grep in Spike A |
| R10 | Whether `agent.say` returns before or after playback (pacing) | [U] | Spike B |
| R11 | Silero `predict_speech` input expectations | [U] | Spike B |
| R12 | Echo from the physio's speakers triggering barge-in | [I] | Energy gate; physio headset; optional "physio must be unmuted" rule |
| R13 | Vision Agents creates/writes the Stream Chat channel `messaging:{callId}` with agent text | [V] | No-op subclass implemented in Spike A; if unsafe, STOP AND REPORT (keeping Chat needs explicit user approval, §1.4 #2) |
| R14 | Call-type grant semantics after `createCallType`; call tokens do not restrict access; whether custom events need a capability the hand-written grants drop | [V] docs / [I] semantics / [U] grants | Copy grants from `getCallType("default")`; custom-event smoke test on `physio_session`; verify in the Stream dashboard; use `default` + nanoid ids until then |
| R15 | `settings_override` keys for individual/raw/frame recording in node-sdk 0.4.26 typings; `frame_recording` validation | [U] | Check the `getOrCreate` response settings |
| R16 | iOS Safari autoplay | [I] | SDK bump for `useIsAutoplayBlocked`/`resumeAudio` (ask user); tap-to-enable overlay |
| R17 | `custom` events delivered to the webhook | [I] | Backstop only; confirm with a live payload |
| R18 | Better Auth Drizzle adapter writing to `pgEnum` columns | [U] | Switch to `text` + check if it fails |
| R19 | Join link is a bearer credential | [V] design | 12 h expiry, hash revocation, rate limit; optional PIN later |
| R20 | Native Windows runtime for aiortc/av | [U] | Use Docker/WSL2 for anything that imports `vision_agents` |
| R21 | Malayalam STT, Gemini Live / OpenAI Realtime Malayalam quality | [U] | Out of scope for v1 |
| R22 | Sarvam/Google pricing and rate limits | [U] | Check before rendering the full catalogue |
| R23 | OneDrive sync locking `node_modules`/`.venv` | [I] | Move the repo or exclude folders (M0) |
| R24 | Installed Stream web SDKs (node-sdk 0.4.24, react-sdk 1.18.0, video-client 1.23.2, bindings 1.6.5) differ from the versions the [V] tags were checked against | [V] mismatch | Pin node-sdk 0.4.26; check every React hook in the installed `.d.ts` (M0) |
| R25 | A publisher-only `PoseProcessor` may receive no video if the agent's join-time subscription excludes video | [U] | Spike A task 3a and the §8.11 fallback ladder |
| R26 | CPU-only torch resolution with uv for `ultralytics` | [U] | `uv tree` in the container; fall back to MediaPipe-only image (§4.9) |
| R27 | Model download URLs and the file name Silero's loader expects | [U] | Verify, then bake with checksums (§13.2) |
| R28 | Server-side refusal fallback with `between_tools` in the request body | [U] | Forced-refusal test at M6; drop `between_tools` on that path if rejected (§8.9) |
| R29 | `tsx --conditions=react-server` for scripts importing `server-only` | [I] | Fallback `node --conditions=react-server --import tsx` (§4.1) |
| Q1 | Does the user want the prototype `physiocoach.html` ported? | Open | Ask at M1 |
| Q2 | Vetoes on DEV-1…DEV-16 | Open | Ask at Checkpoint 0 |
| Q3 | Commit voice WAVs to git or build artifacts? | Open | Ask at Checkpoint B |
| Q4 | Bump `@stream-io/video-react-sdk`? | Open | Ask at Checkpoint 0 (after the hook check) or in M5 |
| Q5 | Keep Anthropic server-side `fallbacks` (on by default) for the note and weekly summary? | Open | Ask at Checkpoint 6 |
| Q6 | Keep the Stream Chat channel if the no-op `create_conversation` is unsafe? | Open only if Spike A fails | Ask at Checkpoint A |
| Q7 | Keep existing Meet.AI users (needs a manual baseline migration) or start on an empty database? | Open | Ask at Checkpoint 0 (§6.4) |

---

## 16. Working rules for you, the coding agent

### 16.1 How to work
1. **Small steps.** One coherent change at a time; run the relevant tests and type checks after each; commit with a clear message (conventional commits) once git exists. End every commit message with the attribution lines your environment requires.
2. **Read before you write.** Open the real file before modifying it; the repo is the source of truth for current code. Never invent APIs: if a library call is not in this document or verified in the installed package (read the source under `node_modules/` or the uv `.venv`), verify it first, and mark anything you cannot verify as a spike item in your report.
3. **Respect the [U] tags.** Do not build features on unverified behaviour; resolve it in the named spike first.
4. **Never commit or print secrets.** Do not read `.env` values into your output. Do not paste keys into code, tests, fixtures or logs. Use placeholders in `.env.example`.
5. **Ask before destructive actions.** Deleting files, dropping tables, running migrations against a non-empty database, running `createCallType`, moving the repo, force operations, or bumping major dependency versions all require explicit user approval at a checkpoint.
6. **Keep the contracts in sync.** Any change to an event, callback or control payload updates `src/modules/agent-bridge/schemas.ts`, `agent/physiocoach/core/contracts.py` and `shared/fixtures/**` in the same commit; both test suites must pass.
7. **Stop at every checkpoint** (Checkpoints 0, 1, A, B, 4, pre-delete, call-type, 5, 6, 7). Report: what you did, test results, measurements, decisions you made where the spec was silent, open questions, and what you need from the user.
8. **Non-negotiables first.** If a requested change conflicts with §1.4, stop and say so.
9. **Prefer reuse.** Before creating a new component, check §4 and the existing `src/components` and `src/modules`. Rename and adapt rather than rewrite.
10. **No scope creep.** Do not add features that are not in this document (no video recording, no STT, no realtime S2S, no new auth providers) without the user asking.

### 16.2 Conventions (match the existing repo)
- **Modules:** `src/modules/<feature>/{server/procedures.ts, schemas.ts, params.ts, types.ts, hooks/, ui/components/, ui/views/}`; routers registered in `src/trpc/routers/_app.ts`.
- **Procedures:** `createTRPCRouter({...})`; `physioProcedure` for physio data; `baseProcedure` + `requireJoin` for patient endpoints; zod input schemas from `schemas.ts`; `TRPCError` codes `NOT_FOUND`/`FORBIDDEN`/`BAD_REQUEST`/`UNAUTHORIZED`; Drizzle `and(eq(...), ...)` scoping on every query; `.returning()` on writes; `db.batch` for multi-statement writes (no interactive transactions on `neon-http`).
- **Pages:** async server `page.tsx` → `getQueryClient()` + `void queryClient.prefetchQuery(trpc.x.y.queryOptions(...))` → `<HydrationBoundary state={dehydrate(queryClient)}><Suspense fallback={<XViewLoading/>}><ErrorBoundary fallback={<XViewError/>}><XView/></ErrorBoundary></Suspense></HydrationBoundary>`. Client views use `useSuspenseQuery(trpc.x.y.queryOptions(...))`, mutations use `useMutation(trpc.x.y.mutationOptions({ onSuccess, onError }))` and invalidate with `queryClient.invalidateQueries(trpc.x.y.queryOptions(...))`.
- **Types:** `inferRouterOutputs<AppRouter>` in each module's `types.ts`.
- **URL state:** nuqs (`parseAsInteger`, `parseAsString`, `parseAsStringEnum`, `parseAsBoolean`) with `params.ts` (server loader) + `hooks/use-*-filters.ts` (client).
- **UI:** shadcn primitives from `@/components/ui/*`; shared `DataTable`, `DataPagination`, `CommandSelect`, `ResponsiveDialog`, `GeneratedAvatar`, `EmptyState`, `ErrorState`, `LoadingState`, `useConfirm`; lucide icons; `sonner` toasts; Tailwind v4 tokens from `globals.css`; `cn()` from `@/lib/utils`.
- **Server-only code** imports `"server-only"` (`lib/stream-video.ts`, `lib/join-token.ts`, `lib/agent-worker.ts`, `lib/signing.ts`). Anything that imports these outside Next must use the `react-server` condition (tsx scripts) or the vitest stub alias (§4.1). Never construct an SDK or DB client at module scope with non-null-asserted env; make it lazy (§4.3).
- **IDs:** `nanoid()`; the call session id doubles as the Stream call id.
- **Python:** type hints everywhere; `ruff` + `pytest`; dataclasses/pydantic v2; `asyncio` only in `call/` and `control/`; pure functions in `core/`; logging with the standard `logging` module (no patient names in logs, only ids).
- **Text:** every patient-facing string is bilingual (Malayalam first for patients whose `preferredLanguage` is `ml`); Malayalam strings live in `shared/phrases.json` (agent) or a small `src/modules/call/strings.ts` map (UI), all marked for native review.

---

## Appendix A: Verified API cheat sheet

| Area | API | Source / status |
|---|---|---|
| Vision Agents install | `uv add "vision-agents[getstream,sarvam,ultralytics,anthropic,redis]==0.6.9"`; requires Python ≥ 3.10; examples use 3.13 | [V] PyPI 0.6.9 (2026-08-13) |
| Agent | `Agent(edge, llm, agent_user, instructions="", stt=None, tts=None, turn_detection=None, processors=None, ...)`; `llm` is mandatory | [V] `agents.py:126` |
| Join | `call = await agent.create_call(type, id)` (get_or_create); `async with agent.join(call, participant_wait_timeout=None): ... await agent.finish()` | [V] |
| Runner | `Runner(AgentLauncher(create_agent=..., join_call=..., agent_idle_timeout=60.0, ...)).cli()`; `run --call-type --call-id --no-demo [--video-track-override]`; `serve` exposes `POST /calls/{id}/sessions` etc. with `allow_all` + CORS `*` by default; launcher passes no per-call kwargs | [V] |
| Events | `@agent.events.subscribe async def h(e: TrackAddedEvent \| TrackRemovedEvent)`; `ParticipantJoinedEvent`, `ParticipantLeftEvent`, `AudioReceivedEvent(pcm_data, participant)`, `CallEndedEvent`; routing by type hint | [V] |
| Processors | `VideoPublisher.publish_video_track()`, `VideoProcessor.process_video(track, participant_id, shared_forwarder)`, `AudioPublisher.publish_audio_track()`; only one source track is routed to `VideoProcessor`s | [V] |
| Frames | `VideoForwarder(track, max_buffer=10, fps=30, name=...)`, `add_frame_handler(cb, fps=, name=)`, `await remove_frame_handler(cb)`; frames are `av.VideoFrame` (`to_ndarray(format="rgb24")`) | [V] |
| Output video | `QueuedVideoTrack(width, height, fps, max_queue_size)`, `await add_frame(av.VideoFrame)`, `stop()` | [V] |
| Track subscribe | `agent.edge.add_track_subscriber(track_id)` → independent MediaRelay proxy | [V] stream-py 4.3.0 `pc.py:216` (method); **[U]** whether it yields frames when no `VideoProcessor` exists (Spike A 3a) |
| File video | `VideoFileTrack(path, fps=30)` loops an MP4 | [V] class; [U] import path |
| Custom events out | `await agent.send_custom_event(dict)` (≤ 5 KB, one REST call) | [V] |
| Custom events in | private `agent.edge._connection` / `_real_connection` `.on("custom", fn)`; payload `ev["custom"]`, `ev["user"]["id"]` | [V] private |
| TTS | subclass `vision_agents.core.tts.TTS`, `streaming=False`, `async stream_audio(text) -> PcmData \| iterators`, `async stop_audio()`, `interrupt()`; `agent.say(text)` bypasses the LLM | [V] |
| Audio track | `AudioStreamTrack(48000, mono, 300 s buffer)`; `await write(pcm, final=)`, `await flush()` | [V] |
| PcmData | `PcmData.from_bytes(b, sample_rate=, format=AudioFormat.S16, channels=)`, `.resample()`, `.append()`, `.to_wav_bytes()` from `getstream.video.rtc.track_util` | [V] |
| Sarvam TTS | `from vision_agents.plugins import sarvam; sarvam.TTS(model="bulbul:v3", language="ml-IN", speaker=..., sample_rate=24000, pace=...)` | [V] signature; [U] ml behaviour |
| VAD | `SileroVADSessionPool.load(model_dir)`, `.session().predict_speech(pcm) -> float` | [V] |
| Stream node | `getOrCreate`, `generateUserToken`, `generateCallToken`, `upsertUsers`, `verifyWebhook`, `createCallType`, `getCallType`, `call.end()`, `call.sendCallEvent({user_id, custom})` | [V] 0.4.26 (pin it; the lockfile has 0.4.24) |
| Stream React | `call.sendCustomEvent(payload)`, `call.on("custom", e => e.custom)`, `useCallStateHooks()`, `ParticipantView`, `ParticipantsAudio`, `CallControls`; `useIsAutoplayBlocked`/`call.resumeAudio()` | [V] 1.43.4; installed 1.18.0 / video-client 1.23.2 / bindings 1.6.5 = [U] until checked in M0 |
| Anthropic (Python) | `anthropic.AsyncAnthropic(timeout=3.5, max_retries=0).beta.messages.create(model="claude-sonnet-5-5", max_tokens=600, system=..., thinking={"type":"between_tools"}, output_config={"effort":"low","format":{"type":"json_schema","schema":...}}, messages=[...], betas=["server-side-fallback-2026-07-01"], fallbacks="default")`; check `stop_reason` before reading `content`; `between_tools` only on Sonnet 5.5, at effort ≤ `high`, no other thinking field; without fallbacks use `.messages.create(...)` minus the last two args | Anthropic SDK docs (Claude API skill); [U] `between_tools` on a fallback-served request (M6) |
| Anthropic (TS) | `new Anthropic({ timeout: 8000, maxRetries: 0 }).beta.messages.create({ model: "claude-sonnet-5-5", ... same fields, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })` (TS timeout in ms) | Anthropic SDK docs |

*End of master prompt.*

