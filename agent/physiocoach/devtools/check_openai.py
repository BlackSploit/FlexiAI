"""Preflight for the OpenAI post-set note (makes real network calls; never run in tests).

    python -m physiocoach.devtools.check_openai
    docker compose exec agent-worker python -m physiocoach.devtools.check_openai

1. whether OPENAI_API_KEY is set (the value is never printed);
2. models.retrieve(<note model>);
3. one strict json_schema note request, built exactly as at runtime, parsed and checked with validate_note.
Exits non-zero on the first failure. The note call uses a generous timeout and reports its latency
against NOTE_LLM_TIMEOUT_S, because at runtime a slower answer silently falls back to the rule note.
"""

import asyncio
import sys
import time

from ..core import note_llm
from ..core.coach_rules import rule_note
from ..core.scoring import SetMetrics

PREFLIGHT_TIMEOUT_S = 30.0


def _fail(msg: str) -> int:
    print(f"FAIL  {msg}")
    return 1


async def _main() -> int:
    if not note_llm._env("OPENAI_API_KEY"):
        return _fail("OPENAI_API_KEY is not set (the agent will use the rule note)")
    print("ok    OPENAI_API_KEY is set")
    if not note_llm._enabled():
        print("warn  NOTE_LLM_ENABLED is not 'true': the agent will not call the LLM at runtime")

    try:
        import openai
    except ImportError:
        return _fail("the openai package is not installed (uv sync)")

    model = note_llm._model()
    effort = note_llm._reasoning_effort(model)
    budget = note_llm._timeout_s()
    print(f"info  model={model} reasoning_effort={effort or '(not sent)'} budget={budget}s")

    client = openai.AsyncOpenAI(timeout=PREFLIGHT_TIMEOUT_S, max_retries=0)
    try:
        await client.models.retrieve(model)
    except Exception as e:                                   # auth, unknown model, network
        return _fail(f"models.retrieve({model!r}): {type(e).__name__}: {e}")
    print(f"ok    models.retrieve({model!r})")

    demo = SetMetrics(10, 10, 60, 48.0, 50.0, 46.0, 2.5, 0, 88.0, [])
    metrics = note_llm.note_metrics(demo, "knee_bend", "flex", 2.0)
    t0 = time.perf_counter()
    try:
        resp = await client.chat.completions.create(**note_llm.build_request(metrics))
    except Exception as e:                                   # schema or reasoning_effort rejected, network
        return _fail(f"note request: {type(e).__name__}: {e}")
    elapsed = time.perf_counter() - t0
    try:
        note = note_llm.parse_completion(resp)
        note_llm.validate_note(note, metrics)
    except Exception as e:
        return _fail(f"note rejected after {elapsed:.2f}s: {type(e).__name__}: {e}")
    print(f"ok    strict note validated in {elapsed:.2f}s")
    print(f"      en: {note.en}")
    print(f"      ml: {note.ml}")
    print(f"      rule note for comparison: {rule_note(demo, 'flex')['en']}")
    if elapsed > budget:
        return _fail(f"latency {elapsed:.2f}s exceeds NOTE_LLM_TIMEOUT_S={budget}s; runtime would use the rule note")
    return 0


def main() -> None:
    sys.exit(asyncio.run(_main()))


if __name__ == "__main__":
    main()
