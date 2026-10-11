# Deploying PhysioCoach to Dokploy (physio.algon.tech)

One Dokploy **Docker Compose** application built from this repo (`docker-compose.prod.yml`). It runs four services
on one private network:

| Service | Image | Public? | Notes |
|---|---|---|---|
| `migrate` | `Dockerfile` target `migrator` | no | One-shot: `drizzle-kit migrate` + exercise library upsert. `web` starts only after it succeeds. |
| `web` | `Dockerfile` target `runtime` (Next.js standalone) | **yes**: `physio.algon.tech` → port 3000, HTTPS | Health: `GET /api/health` |
| `agent-worker` | `agent/Dockerfile` (Python, Vision Agents, pose models, offline voice) | no | Control API on 8080, reachable only as `http://agent-worker:8080` |
| `redis` | `redis:7-alpine` | no | Agent lifecycle, heartbeats and the callback outbox |

Postgres stays on **Neon** (`DATABASE_URL`); nothing about the database moves to the VPS.

```
 phone / laptop ──HTTPS──► Traefik (Dokploy) ──► web:3000 ──neon-http──► Neon
                                                  │  ▲
                              signed control ─────┘  └──── signed callbacks
                                                  ▼  │
                                            agent-worker:8080 ──► redis
                                                  │
                         Stream Video (WebRTC) ◄──┘ the coach joins the call as "physiocoach-agent"
```

---

## 1. VPS sizing

- **Minimum:** 4 vCPU and 8 GB RAM for 2 concurrent guided sessions (each costs about 1.5 GB RAM and 2 vCPU for
  pose estimation). The compose file caps the worker at 4 CPUs and 4 GB; raise the limit on a bigger box and raise
  `MAX_SESSIONS` to match.
- **Disk:** about 10 GB free for images. The agent image is large (CPU torch, MediaPipe and YOLO weights, about
  110 MB of rendered voice clips).
- **The first build takes 10–20 minutes,** mostly the agent image. Later builds reuse cached layers.

## 2. DNS

At your DNS provider for `algon.tech`, add:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `physio` | `<VPS public IPv4>` | 300 |

If you use Cloudflare, set the record to **DNS only (grey cloud)** for the first deploy so Let's Encrypt can
issue the certificate. Proxying can be turned on later with SSL mode "Full (strict)".

Check that it resolves: `nslookup physio.algon.tech` must return the VPS IP.

## 3. Create the application in Dokploy

1. **Project** → *Create Project* "PhysioCoach" → *Create Service* → **Compose**.
2. **Provider:** GitHub, with repository `BlackSploit/FlexiAI`, branch `main`.
3. **Compose path:** `./docker-compose.prod.yml`
4. Leave the compose type as **Docker Compose** (not Stack).

## 4. Environment variables (Dokploy → Environment tab)

Paste these with your real values. Never commit them. Generate each random secret with `openssl rand -hex 32`.

```env
# public URL (also used for join links, auth and client bundle)
NEXT_PUBLIC_APP_URL=https://physio.algon.tech

# database (Neon)
DATABASE_URL=postgresql://...neon.tech/...?sslmode=require

# auth + links (random, 32+ bytes each)
BETTER_AUTH_SECRET=
JOIN_LINK_SECRET=
AGENT_CONTROL_SECRET=
AGENT_CALLBACK_SECRET=
ALLOW_SIGNUP=true

# Stream Video (same app as local)
NEXT_PUBLIC_STREAM_VIDEO_API_KEY=
STREAM_VIDEO_SECRET_KEY=
STREAM_CALL_TYPE=physio_session
NEXT_PUBLIC_STREAM_AGENT_USER_ID=physiocoach-agent

# OpenAI (post-set note, weekly summary, Live Coach). Without a key: rule notes and cached clips only.
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini
OPENAI_REASONING_EFFORT=minimal
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_REALTIME_VOICE=marin
# Live Coach: LIVE_COACH=off is the kill switch (restart agent-worker after changing it)
LIVE_COACH=on
LIVE_COACH_VIDEO=on
LIVE_COACH_SET_LISTEN=on
LIVE_COACH_BARGE_IN=off

# agent tuning (defaults shown; optional)
POSE_BACKEND=mediapipe
POSE_FPS=12
MAX_SESSIONS=2
NOTE_LLM_ENABLED=true
VOICE_SLUG=dev-espeak-ml
```

Notes:
- `NEXT_PUBLIC_*` values are **baked into the web bundle at build time**. After changing one, **redeploy**
  (rebuild), not just restart.
- `AGENT_WORKER_URL`, `WEB_INTERNAL_URL`, `REDIS_URL`, `BETTER_AUTH_URL` and the worker's `STREAM_API_KEY` /
  `STREAM_API_SECRET` are wired inside the compose file. Do not set them.
- Use `STREAM_CALL_TYPE=physio_session` only after `npm run stream:call-type -- --apply` has been run once for
  this Stream app (already done locally) and the custom-event smoke test passed. Otherwise use `default`.
- To use the same Neon database as local dev, reuse its URL. For a clean production database, create a new Neon
  branch and use that URL; the `migrate` job creates the tables.

## 5. Domain (Dokploy → Domains tab)

*Add Domain*:

| Field | Value |
|---|---|
| Host | `physio.algon.tech` |
| Path | `/` |
| Service | **web** |
| Container port | **3000** |
| HTTPS | on |
| Certificate | Let's Encrypt |

Do **not** add a domain for `agent-worker` or `redis`.

## 6. Deploy

Press **Deploy**. Then watch the logs in Dokploy:

1. `migrate` prints the drizzle migrations it applied (or "No migrations to apply"), then
   `exercises: 3 upserted`, and exits with code 0.
2. `agent-worker`: `Uvicorn running on http://0.0.0.0:8080`. During the build, the step
   `render_catalogue --provider espeak` prints `rendered NNN clips`.
3. `web`: `Ready`. Its health check turns healthy.

## 7. Stream dashboard

In the Stream dashboard → your app → **Video & Audio → Webhooks**, set:

```
https://physio.algon.tech/api/webhook
```

Events: call lifecycle (`call.session_started`, `call.session_ended`, `call.ended`,
`call.session_participant_left`) and custom events. The webhook is a backstop (agent-down detection,
finalising calls). Sessions still work without it, but set it for production.

## 8. Smoke test (5 minutes)

```bash
curl -s https://physio.algon.tech/api/health        # {"ok":true}
curl -s https://physio.algon.tech/api/auth/ok       # {"ok":true}
```

Then run the browser flow from `docs/TESTING_GUIDE.txt`, using `https://physio.algon.tech` as the URL:
1. Sign up as a physio. Then set `ALLOW_SIGNUP=false` and redeploy if the deployment is public.
2. Create a patient and a knee-bend prescription, then press **Start guided session**.
3. Scan the QR code on a phone, join, agree, do 3–4 slow reps, and check that the counter and voice work.
4. Press **Stop** on the phone, and check that the physio alert appears.

Optional demo data, run from your laptop against the same `DATABASE_URL`:
`npm run db:seed -- --demo`.

## 9. Operations

| Task | How |
|---|---|
| Logs | Dokploy → the compose app → Logs (choose the service) |
| Worker health | Dokploy terminal into `web`: `node -e "fetch('http://agent-worker:8080/healthz').then(r=>r.text()).then(console.log)"` |
| Update | `git push` to `main`, then press Deploy (or turn on auto-deploy / the webhook in Dokploy) |
| Roll back | Dokploy → Deployments → redeploy a previous one |
| Scale sessions | Raise the worker CPU/memory limits in `docker-compose.prod.yml` and `MAX_SESSIONS` |
| Restart a stuck coach | Physio presses **Restart coach** in the call, or restart the `agent-worker` service |

## 10. Security checklist

- [ ] All secrets come only from the Dokploy Environment tab. `.env` files are never committed.
- [ ] `ALLOW_SIGNUP=false` after the physio accounts exist.
- [ ] Only `web` has a domain. Nothing publishes 8080 or 6379.
- [ ] Traefik access logs: if enabled, drop or redact paths starting with `/join/`, because the join token is a
      bearer credential. `/join/*` is already served with `Referrer-Policy: no-referrer` and `noindex`.
- [ ] `STREAM_CALL_TYPE=physio_session`: no recording or transcription, and guests have no grants.
- [ ] Rotate any secret that was ever pasted into chat or committed before the history scrub.

## 11. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Certificate not issued | DNS not pointing at the VPS yet, or the Cloudflare proxy is on. Use DNS only, then redeploy. |
| `web` never starts | `migrate` failed: check its log (usually a wrong `DATABASE_URL`). |
| "Could not start the coach" | `agent-worker` is unhealthy or `AGENT_CONTROL_SECRET` differs between services (it shouldn't: one value feeds both). Check the worker logs. |
| Coach joins but is silent | `VOICE_SLUG` does not match a rendered voice. The default `dev-espeak-ml` is rendered during the image build. |
| Results never appear | The worker posts to `http://web:3000/api/agent/events`. Check `AGENT_CALLBACK_SECRET` and the web logs for 401s. |
| Sign-in loops or "invalid origin" | `NEXT_PUBLIC_APP_URL` must be exactly `https://physio.algon.tech`. Redeploy after changing it. |
| Phone camera blocked | Must be opened over HTTPS on the domain, never via the IP. |
