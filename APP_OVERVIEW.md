# Meet.AI — Complete App Overview

> Snapshot of the current codebase in `Psysio_Agent/` as of 2026-10-10, written as a reference before a full rebuild.
> **Note:** The folder is named `Psysio_Agent`, but nothing in the code is physio-specific yet. The app is a general-purpose **"Meet.AI"** product (the package name is `meetai`): you hold video calls with AI agents you define yourself.

---

## 1. The idea in one paragraph

Meet.AI lets a signed-in user **create AI agents** (a name plus a system prompt / "instructions"), then **schedule a meeting** with one of them. When the user joins the meeting, they enter a real **video call** (Stream Video). The AI agent joins the same call as a voice participant, powered by the **OpenAI Realtime API**, and talks with the user following its instructions. The call is **recorded and transcribed** automatically. When the call ends, a background job (Inngest) pulls the transcript, labels the speakers, and has **GPT-4o write a structured summary**. After that, the user can open the meeting to read the **summary**, **search the transcript**, **watch the recording**, and **chat with the agent about the meeting** ("Ask AI", via Stream Chat + GPT-4o).

Example uses the UI hints at: a "Math tutor" agent, "Math Consultations" meetings. For a physio product, the same loop would be: a physio-assistant agent, a session/consultation as the meeting, and a summary/plan afterwards.

---

## 2. Core user journey

```
Sign up / Sign in  (email + password)
        │
        ▼
/meetings  (default landing; "/" redirects here)
        │
        ├── Agents tab → Create agent  (name + instructions)
        │
        ▼
Create meeting  (name + pick an agent)
        │   server: insert DB row (status = upcoming)
        │           create a Stream video call with auto transcription + auto 1080p recording
        │           register the agent as a Stream user
        ▼
Meeting page → "Start meeting" → /call/[meetingId]
        │
        ▼
Lobby (camera/mic preview, permissions) → "Join Call"
        │   Stream webhook: call.session_started
        │     → status = active, startedAt = now
        │     → connect OpenAI Realtime agent into the call with the agent's instructions
        ▼
Live call with the AI agent (speaker layout + call controls)
        │
        ▼
User leaves → call ends for everyone
        │   webhook: call.session_participant_left → end the call
        │   webhook: call.session_ended → status = processing, endedAt = now
        │   webhook: call.recording_ready → save recordingUrl
        │   webhook: call.transcription_ready → save transcriptUrl → fire Inngest event
        ▼
Inngest job "meetings/processing"
        │   fetch JSONL transcript → parse → attach speaker names → GPT-4o summary
        │   → save summary, status = completed
        ▼
Meeting page (completed) with 4 tabs:
   Summary | Transcript (searchable) | Recording (video player) | Ask AI (chat)
```

---

## 3. Features

### 3.1 Authentication
- Email + password only, via **Better Auth** (`src/lib/auth.ts`), stored in Postgres with the Drizzle adapter.
- Sign-up form: name, email, password, confirm password (must match).
- Sign-in form: email, password; shows an inline error alert on failure.
- Every dashboard/call page checks the session on the server and redirects to `/sign-in` if there is none.
- All tRPC procedures that touch data use `protectedProcedure`, which rejects with `UNAUTHORIZED` when there is no session.
- Split-card auth layout: form on the left, logo + "Meet.AI" on a dark green radial gradient on the right.

### 3.2 Agents
- **Fields:** `name`, `instructions` (the system prompt the AI follows during calls and in post-call chat).
- **List page** (`/agents`): data table, search by name (case-insensitive), pagination (10 per page), URL-synced filters (`?search=&page=`), shows the meeting count for each agent.
- **Detail page** (`/agents/[agentId]`): avatar, name, meeting count badge, instructions; edit (dialog) and delete (with a confirmation that warns how many meetings will be deleted with it, via cascade).
- **Avatar:** generated deterministically from the name with DiceBear `bottts-neutral` (robot faces). Live preview while you type the name in the form.
- Scoped per user: you only see and edit your own agents.

### 3.3 Meetings
- **Fields:** `name`, `agentId`, `status`, `startedAt`, `endedAt`, `transcriptUrl`, `recordingUrl`, `summary`.
- **Status lifecycle:** `upcoming → active → processing → completed` (plus `cancelled`, which exists in the enum/UI but **nothing ever sets it**).
- **List page** (`/meetings`): table with meeting name, agent name and avatar, start date, status badge (color + icon, spinning for processing), duration (computed in SQL as `ended_at - started_at`). Filters: text search, status, agent. All filters are synced to the URL with `nuqs`.
- **Create/edit dialog:** name + searchable agent picker (command palette style), with an inline "Create new agent" link.
- **Detail page** (`/meetings/[meetingId]`) renders a different state per status:
  - `upcoming` → "Not started yet" + **Start meeting** button
  - `active` → "Meeting is active" + **Join meeting** button
  - `processing` → "Meeting completed, summary will appear soon"
  - `cancelled` → "Meeting cancelled"
  - `completed` → tabbed view:
    - **Summary:** markdown summary, agent link, date, duration badge
    - **Transcript:** each line shows speaker avatar, name, `mm:ss` timestamp; client-side search with highlighted matches
    - **Recording:** HTML5 `<video>` player using the Stream recording URL
    - **Ask AI:** Stream Chat channel (channel id = meeting id) where the agent answers questions about the meeting

### 3.4 Video call (`/call/[meetingId]`)
- Full-screen black layout, separate from the dashboard.
- Three screens in sequence: **Lobby → Active → Ended**.
  - Lobby: video preview, toggle mic/camera, browser permission prompt message, Cancel / Join Call.
  - Active: header pill with logo + meeting name, Stream `SpeakerLayout`, Stream `CallControls`.
  - Ended: "You have ended the call. Summary will appear in a few minutes." + Back to meetings.
- If the meeting is already `completed`, the page shows "Meeting has ended" instead.
- Leaving calls `call.endCall()`, which ends the call for everyone, including the AI.

### 3.5 AI layer (3 separate AI touchpoints)

| # | Where | Model / API | What it does |
|---|-------|-------------|--------------|
| 1 | Live call | **OpenAI Realtime API** through `streamVideo.video.connectOpenAi(...)` (Stream's `@stream-io/openai-realtime-api`) | Agent joins the call as a voice participant. Session instructions = the agent's `instructions`. |
| 2 | Post-call summary | **GPT-4o** through `@inngest/agent-kit` `createAgent` | Turns the speaker-labelled transcript into markdown with `### Overview` (narrative) and `### Notes` (themed sections with timestamp ranges and bullets). |
| 3 | Ask AI chat | **GPT-4o** through the `openai` SDK `chat.completions` | Answers the user in the meeting's chat channel. The system prompt includes the meeting summary and the agent's original instructions; the last 5 messages are sent as history. Replies are posted back into Stream Chat as the agent. |

Note: Ask AI only uses the **summary**, not the full transcript, as its source of truth.

### 3.6 Dashboard shell
- Dark green sidebar (shadcn `Sidebar`): logo "Meet.AI", nav items **Meetings** and **Agents**, user button in the footer (sign out, etc.).
- Top navbar with a sidebar toggle and a **global search** command palette (**Ctrl/Cmd + K**) that searches meetings and agents together.
- Responsive: dialogs become drawers on mobile (`ResponsiveDialog`, `CommandResponsiveDialog`).
- Shared UI states: `LoadingState`, `ErrorState`, `EmptyState` (with illustrations in `public/*.svg`).

---

## 4. Tech stack

| Layer | Choice |
|-------|--------|
| Framework | **Next.js 15.3** (App Router, React 19, Server Components) |
| Language | TypeScript |
| Styling | Tailwind CSS v4, **shadcn/ui** (new-york style, neutral base), lucide-react icons, `tw-animate-css` |
| API | **tRPC v11** + TanStack React Query v5 (server prefetch + `HydrationBoundary` + `useSuspenseQuery`) |
| Validation / forms | Zod, react-hook-form, `@hookform/resolvers` |
| URL state | `nuqs` (search params for filters and pagination) |
| Tables | TanStack Table |
| DB | **Postgres on Neon** (serverless HTTP driver) |
| ORM | **Drizzle ORM** + drizzle-kit (`db:push`, `db:studio`) |
| Auth | **Better Auth** (email/password, Drizzle adapter) |
| Video | **Stream Video** (`@stream-io/video-react-sdk` client, `@stream-io/node-sdk` server) |
| Chat | **Stream Chat** (`stream-chat`, `stream-chat-react`) |
| Realtime voice AI | OpenAI Realtime via `@stream-io/openai-realtime-api` |
| LLM | OpenAI `gpt-4o` (`openai` SDK + `@inngest/agent-kit`) |
| Background jobs | **Inngest** |
| Avatars | DiceBear (`bottts-neutral` for agents, `initials` for users) |
| Misc | date-fns, humanize-duration, react-markdown, react-highlight-words, jsonl-parse-stringify, sonner (toasts), nanoid (IDs) |

---

## 5. Architecture

```
┌──────────────────────── Browser ────────────────────────┐
│ Next.js client components                               │
│  • tRPC + React Query  ──────────────┐                  │
│  • Stream Video React SDK ──┐        │                  │
│  • Stream Chat React SDK ─┐ │        │                  │
└───────────────────────────┼─┼────────┼──────────────────┘
                            │ │        ▼
                            │ │   /api/trpc  ──► tRPC routers (agents, meetings)
                            │ │        │            │
                            │ │        │            ├─► Drizzle ─► Neon Postgres
                            │ │        │            └─► Stream server SDK (create call, tokens, upsert users)
                            │ │   /api/auth/* ──► Better Auth ─► Postgres
                            ▼ ▼
                   ┌──────────────────┐   webhooks    /api/webhook
                   │  Stream (Video + │ ────────────► (verify signature, route by event type)
                   │  Chat cloud)     │                 │
                   └──────────────────┘                 ├─► update meeting status/URLs in DB
                            ▲                           ├─► connect OpenAI Realtime agent to the call
                            │ agent posts reply         ├─► Ask AI: GPT-4o → post reply to chat channel
                            └───────────────────────────┤
                                                        └─► inngest.send("meetings/processing")
                                                                  │
                                                        /api/inngest ◄── Inngest cloud/dev server
                                                                  │
                                                        meetingsProcessing function:
                                                        fetch transcript → speakers → GPT-4o summary → DB
```

### Key design patterns
- **Feature modules:** `src/modules/<feature>/{server,ui/components,ui/views,hooks,schemas,params,types}`.
- **Server prefetch + client suspense:** each `page.tsx` checks auth, prefetches the tRPC query, and wraps the client view in `HydrationBoundary` → `Suspense` → `ErrorBoundary`.
- **Types inferred from the router:** `inferRouterOutputs<AppRouter>` for `MeetingGetOne`, `AgentsGetMany`, etc.
- **Webhooks drive the meeting status:** the client never sets status; Stream events do.
- **IDs:** app tables use `nanoid()`. The **agent ID is also used as its Stream user ID**, and the **meeting ID is also used as the Stream call ID and the Stream chat channel ID**. This is what lets transcripts map speakers back to DB rows.

---

## 6. Data model (`src/db/schema.ts`)

### Better Auth tables
- `user` (id, name, email unique, email_verified, image, created_at, updated_at)
- `session` (id, expires_at, token unique, ip_address, user_agent, user_id → user, cascade)
- `account` (id, account_id, provider_id, user_id → user, tokens, password, …)
- `verification` (id, identifier, value, expires_at, …)

### App tables
```
agents
  id            text PK (nanoid)
  name          text not null
  user_id       text → user.id (cascade delete)
  instructions  text not null
  created_at, updated_at  timestamp default now

meeting_status enum: upcoming | active | completed | processing | cancelled

meetings
  id              text PK (nanoid)   ← also the Stream call id + chat channel id
  name            text not null
  user_id         text → user.id   (cascade)
  agent_id        text → agents.id (cascade)  ← deleting an agent deletes its meetings
  status          meeting_status default 'upcoming'
  started_at      timestamp null
  ended_at        timestamp null
  transcript_url  text null   (Stream JSONL transcript)
  recording_url   text null   (Stream MP4 recording)
  summary         text null   (markdown from GPT-4o)
  created_at, updated_at
```

Relationships: `user 1─* agents 1─* meetings`, `user 1─* meetings`.

Stream transcript item shape (`StreamTranscriptItem`): `{ speaker_id, type, text, start_ts, stop_ts }`.

---

## 7. API surface

### tRPC (`/api/trpc`): all `protectedProcedure`, all scoped to `ctx.auth.user.id`

**`agents`**
| Procedure | Type | Input | Notes |
|---|---|---|---|
| `getMany` | query | `page`, `pageSize` (1–100, default 10), `search?` | Returns `{ items (with meetingCount), total, totalPages }` |
| `getOne` | query | `id` | Includes `meetingCount` |
| `create` | mutation | `name`, `instructions` | |
| `update` | mutation | `id`, `name`, `instructions` | |
| `remove` | mutation | `id` | Cascades to its meetings |

**`meetings`**
| Procedure | Type | Input | Notes |
|---|---|---|---|
| `getMany` | query | `page`, `pageSize`, `search?`, `agentId?`, `status?` | Joins the agent; computes `duration` |
| `getOne` | query | `id` | Joins the agent; computes `duration` |
| `create` | mutation | `name`, `agentId` | Inserts the row, creates the Stream call (transcription + recording auto-on, `en`, 1080p), upserts the agent as a Stream user |
| `update` | mutation | `id`, `name`, `agentId` | |
| `remove` | mutation | `id` | |
| `generateToken` | mutation | — | Upserts the user in Stream Video (role admin), returns a 1-hour video token |
| `generateChatToken` | mutation | — | Upserts the user in Stream Chat (role admin), returns a chat token |
| `getTranscript` | query | `id` | Fetches the JSONL from Stream, maps speaker IDs to users/agents with avatars |

### REST routes
| Route | Purpose |
|---|---|
| `/api/auth/[...all]` | Better Auth handler |
| `/api/trpc/[trpc]` | tRPC handler |
| `/api/webhook` | Stream Video + Chat webhooks (signature checked with `streamVideo.verifyWebhook`) |
| `/api/inngest` | Inngest function host (`meetingsProcessing`) |

### Webhook events handled (`src/app/api/webhook/route.ts`)
| Event | Action |
|---|---|
| `call.session_started` | If the meeting is `upcoming`: set `active` + `startedAt`; connect the OpenAI Realtime agent to the call with the agent's instructions |
| `call.session_participant_left` | End the call (`call.end()`) |
| `call.session_ended` | If `active`: set `processing` + `endedAt` |
| `call.transcription_ready` | Save `transcriptUrl`; send the Inngest event `meetings/processing` |
| `call.recording_ready` | Save `recordingUrl` |
| `message.new` (chat) | If the meeting is `completed` and the sender isn't the agent: build a prompt (summary + agent instructions + last 5 messages), call GPT-4o, post the reply as the agent |

### Background job
- **Inngest** client id `meet-ai-2`, function `meetings/processing`:
  `fetch-transcript` → `parse-transcript` → `add-speakers` → summarizer agent run → `save-summary` (sets `summary` and `status = completed`).

---

## 8. Pages / routes

| Route | Group | Description |
|---|---|---|
| `/` | — | Redirects to `/meetings` (in `next.config.ts`) |
| `/sign-in`, `/sign-up` | `(auth)` | Auth forms |
| `/meetings` | `(dashboard)` | Meetings list + filters + "New meeting" |
| `/meetings/[meetingId]` | `(dashboard)` | Meeting detail (status-based) |
| `/agents` | `(dashboard)` | Agents list + "New agent" |
| `/agents/[agentId]` | `(dashboard)` | Agent detail |
| `/call/[meetingId]` | `call` | Full-screen video call |

`src/modules/home/ui/views/home-view.tsx` exists but is a placeholder ("Home view") and isn't used.

---

## 9. Folder structure

```
src/
├── app/
│   ├── (auth)/            sign-in, sign-up, centered layout
│   ├── (dashboard)/       sidebar + navbar layout; agents/, meetings/
│   ├── call/              full-screen call layout; [meetingId]/
│   ├── api/               auth, trpc, webhook, inngest
│   ├── globals.css        Tailwind v4 + shadcn theme tokens (green primary, dark green sidebar)
│   └── layout.tsx         Nuqs + tRPC providers, Toaster, Inter font
├── components/            shared: data-table, data-pagination, command-select,
│   │                      generated-avatar, empty/error/loading-state, responsive-dialog
│   └── ui/                shadcn primitives (~45 components)
├── db/                    drizzle client + schema
├── hooks/                 use-confirm (promise-based confirm dialog), use-mobile
├── inngest/               client + functions (summarizer)
├── lib/                   auth, auth-client, stream-video, stream-chat, avatar, utils (cn, formatDuration)
├── modules/
│   ├── agents/            server/procedures, schemas, params, hooks, types, ui
│   ├── auth/              sign-in / sign-up views
│   ├── call/              call provider/connect/lobby/active/ended/ui
│   ├── dashboard/         sidebar, navbar, command palette, user button
│   ├── home/              placeholder
│   └── meetings/          server/procedures, schemas, params, hooks, types, ui (states, transcript, chat)
├── trpc/                  init (context + protectedProcedure), client, server, query-client, routers/_app
└── constants.ts           pagination defaults (page 1, size 10, min 1, max 100)
public/                    logo.svg + state illustrations (empty, upcoming, processing, cancelled)
```

---

## 10. Environment & setup

### Environment variables
```
DATABASE_URL                        Neon Postgres connection string
BETTER_AUTH_SECRET                  Better Auth signing secret
BETTER_AUTH_URL                     e.g. http://localhost:3000
NEXT_PUBLIC_APP_URL                 e.g. http://localhost:3000
NEXT_PUBLIC_STREAM_VIDEO_API_KEY    Stream key (client)
STREAM_VIDEO_SECRET_KEY             Stream secret (server)
NEXT_PUBLIC_STREAM_CHAT_API_KEY     Stream key (same app as video)
STREAM_CHAT_SECRET_KEY              Stream secret
OPENAI_API_KEY                      OpenAI (Realtime + GPT-4o)
```

### Running locally
1. `npm install`
2. Fill `.env`, then `npm run db:push` to create the tables.
3. `npm run dev` (Next.js on :3000)
4. `npx inngest-cli@latest dev` (Inngest dev server, so the summary job runs)
5. Deploy to Dokploy (docs/DEPLOY_DOKPLOY.md) and set the Stream dashboard webhook URL to `https://physio.algon.tech/api/webhook`.

External accounts needed: **Neon**, **Stream** (Video + Chat), **OpenAI** (with Realtime access), **Inngest**.

---

## 11. Known gaps, bugs and rough edges

Worth knowing before you rebuild, so you don't carry them over.

### 🔴 Security
- **`.env.example` contains what look like real credentials**: a full Neon connection string with password, the Stream secret, an OpenAI API key, and a weak `BETTER_AUTH_SECRET` (`"gigachadproject"`). Rotate all of them and replace them with placeholders.
- The webhook checks the signature but not that `x-api-key` matches your key.
- Every user is upserted into Stream as role **`admin`**.

### 🟠 Functional
- **`cancelled` status is never set.** There is no cancel action, even though the UI, filter and badge support it.
- **Any participant leaving ends the call** (`call.session_participant_left` → `call.end()`). Fine for 1:1 user+AI, but breaks multi-human calls.
- **The Realtime agent is connected inside a serverless webhook request.** On Vercel-style hosting the function can be killed after it responds, so long-lived AI connections are fragile. A persistent worker would be more reliable.
- **Ask AI only uses the summary**, not the transcript, so detailed questions can fail. History is limited to the last 5 messages.
- Stream transcript/recording URLs are **signed and expire**, but they're stored permanently; old meetings can lose access.
- The Recording tab uses `recordingUrl!`, so it breaks if the recording never arrives.
- If transcription never arrives, the meeting stays in `processing` forever (no timeout or retry path).
- The summarizer gets the whole transcript as one JSON string, with no chunking for long calls.
- `generateToken` passes `validity_in_seconds: issuedAt` (a Unix timestamp) where a duration is expected.
- Leaving the call page via unmount calls both `leave()` and `endCall()`.

### 🟡 Polish / leftovers
- `createTRPCContext` returns a hardcoded `{ userId: 'user_123' }` (unused; the real user comes from the middleware).
- Root metadata is still `"Create Next App"`.
- `home` module is a placeholder; there is no landing page.
- Duplicate `data-pagination.tsx` (both `components/` and `modules/agents/ui/components/`).
- Typo in agent loading text ("a fews econds").
- No tests, no git repo, no premium/billing, no profile settings, no social login.
- The README is minimal (feature bullets only).

---

## 12. Reusable vs. replace when rebuilding

**Worth keeping as patterns (the general mechanics are solid):**
- The **agent → meeting → live AI call → transcript → summary → Q&A** pipeline.
- Webhook-driven status machine (`upcoming → active → processing → completed`).
- Reusing one ID for meeting, Stream call and chat channel, and one ID for agent and Stream user.
- Server prefetch + suspense + tRPC type inference.
- Module-per-feature folder layout, URL-synced filters, the shared state components.

**Likely to change for a physio-focused product (decisions for you):**
- Domain language: Agents → e.g. "Assistants/Therapists", Meetings → "Sessions/Consultations".
- Agent config: structured fields (specialty, body area, exercise library, tone, language) instead of one free-text prompt.
- Summary format: SOAP notes / assessment / exercise plan / follow-up instead of "Overview + Notes".
- Patient profiles, history across sessions, progress tracking (the current model has no patient entity).
- Consent and privacy for recording health conversations (recording and transcription are currently forced on for every call).
- Real-time hosting for the voice agent (a dedicated worker instead of a webhook handler).
- Possibly a different realtime/LLM provider. Everything AI-related currently goes through OpenAI.
