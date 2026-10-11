# PhysioCoach agent worker

Python 3.13, managed with [uv](https://docs.astral.sh/uv/).

| Package | What it is | Imports allowed |
|---|---|---|
| `physiocoach/core/` | angles, rep engine, scoring, coaching rules, phrases, LLM note, safety, contracts | numpy, pydantic, openai, httpx only (runs natively on Windows) |
| `physiocoach/replay/` | synthetic signals and the offline replay CLI | core (+ pose backends for video, Milestone 2) |
| `physiocoach/pose/`, `call/`, `voice/`, `control/` | pose backends, Vision Agents call flow, voice, FastAPI supervisor | added in Milestones 2-5; installed in Docker via `--group call` |

## Native (Windows) core work

```bash
cd agent
uv sync                       # core + dev group
uv run pytest tests/core tests/contracts tests/replay
uv run python -m physiocoach.replay.cli --synthetic clean --exercise knee_bend --target 60 --reps 10
```

Synthetic signals: `clean`, `fast`, `shallow`, `too_short`, `jitter`, `dropout`, `prebent`, `long_dropout`,
`demo_shallow` (the rehearsal movement).

## Docker (everything that joins a call)

```bash
docker compose --profile test build agent-worker-test        # call + dev groups, models baked in
docker compose --profile test run --rm agent-worker-test      # full pytest (pose, smoke, replay golden)
```

Stream credentials come from the root `.env` (`NEXT_PUBLIC_STREAM_VIDEO_API_KEY`, `STREAM_VIDEO_SECRET_KEY`),
mapped to the `STREAM_API_KEY` / `STREAM_API_SECRET` names getstream reads.

OpenAI is optional. `docker-compose.yml` passes `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`,
`OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`, `NOTE_LLM_ENABLED` and the `LIVE_COACH*` flags from the root `.env`
to `agent-worker` (not to `agent-worker-test`, whose tests never use the network). An empty value means the default.
With a key, the post-set note uses the text model (falling back to the rule note) and the Live Coach turns on unless
`LIVE_COACH=off`. Without a key, the worker behaves exactly as before. Preflight checks (they print whether the key
is set, never its value):

```bash
docker compose exec agent-worker python -m physiocoach.devtools.check_openai     # text model + one strict note call
docker compose exec agent-worker python -m physiocoach.devtools.check_realtime   # realtime session config
```

Kill switch: set `LIVE_COACH=off` in the root `.env`, then `docker compose up -d agent-worker`.

### Full call flow on a live call (Milestone 4)

```bash
npm run dev:create-call && cp dev-session.json agent/cache/
# physio (BARGE=1 talks over the coach once), agent with POSE_BACKEND=synthetic (periodic ~48 degree knee bends,
# no clip needed), patient (consent + answers the pain question), callback stub in place of the web
docker compose --profile test run --rm -e VOICE_SLUG=dev-espeak-ml -e BARGE=1 --entrypoint bash \
  agent-worker-test scripts/flow_live.sh cache/dev-session.json
# replay mode (DEV-14): set "mode":"replay","clip":"static_person.mp4" in the session json and add
#   -e AGENT_REPLAY_CLIPS=static_person.mp4 -e AGENT_REPLAY_DIR=cache
```

Logs land in `agent/cache/flow-logs/<callId>/` (agent, physio, patient, stub, callbacks.jsonl).
`python -m physiocoach.devtools.callback_stub` is a local stand-in for the web's `/api/agent/events`
(verifies the HMAC with `AGENT_CALLBACK_SECRET`, validates every callback).

Dev voice: `python -m physiocoach.voice.render_catalogue --provider espeak` (needs `espeak-ng`), then
`VOICE_SLUG=dev-espeak-ml`. Robotic and offline: for pipeline tests only, never for a demo.

### Spike A (Milestone 2)

```bash
npm run dev:create-call                           # creates a dev call, writes dev-session.json
cp dev-session.json agent/cache/
# headless: physio joins first with a camera, agent, then a patient streaming a clip + pc.consent
docker compose --profile test run --rm --entrypoint bash agent-worker-test scripts/spike_a.sh cache/dev-session.json
# or one agent by hand, then open http://localhost:3000/dev/call/<callId>?as=patient in a browser (npm run dev)
docker compose --profile test run --rm agent-worker-test \
  python -m physiocoach.agent_main --session-id <callId> --session-file cache/dev-session.json --max-seconds 300
```

Other dev tools: `python -m physiocoach.devtools.backend_bench` (pose ms/frame per backend),
`python -m physiocoach.devtools.spike_events` (custom-event hook start-up timing),
`python -m physiocoach.replay.cli <clip.mp4> --out annotated.mp4 [--golden-out ...]` (video replay).

## Shared data

`../shared/exercises.json`, `../shared/phrases.json` and `../shared/fixtures/**` are shared with the web app
(`PC_SHARED_DIR` overrides the location; `/app/shared` in Docker). The contracts in
`physiocoach/core/contracts.py` mirror `src/modules/agent-bridge/schemas.ts`; change both and the fixtures together.

Every Malayalam string is a draft awaiting native-speaker review (`"review": "pending"`).
