# PhysioCoach agent worker

Python 3.13, managed with [uv](https://docs.astral.sh/uv/).

| Package | What it is | Imports allowed |
|---|---|---|
| `physiocoach/core/` | angles, rep engine, scoring, coaching rules, phrases, LLM note, safety, contracts | numpy, pydantic, anthropic, httpx only (runs natively on Windows) |
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
