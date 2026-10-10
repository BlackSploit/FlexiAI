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

## Shared data

`../shared/exercises.json`, `../shared/phrases.json` and `../shared/fixtures/**` are shared with the web app
(`PC_SHARED_DIR` overrides the location; `/app/shared` in Docker). The contracts in
`physiocoach/core/contracts.py` mirror `src/modules/agent-bridge/schemas.ts`; change both and the fixtures together.

Every Malayalam string is a draft awaiting native-speaker review (`"review": "pending"`).
