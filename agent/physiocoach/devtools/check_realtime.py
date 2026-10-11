"""Preflight for the realtime Live Coach (makes real network calls; never run in tests).

    python -m physiocoach.devtools.check_realtime
    docker compose exec agent-worker python -m physiocoach.devtools.check_realtime

1. resolves the Live Coach settings exactly as agent_main does (whether OPENAI_API_KEY is set; never the value);
2. models.retrieve(<realtime model>);
3. client.realtime.client_secrets.create(session=...) for the FULL and the MINIMAL session: OpenAI
   validates the exact session config (transcription language, VAD, noise reduction, speed, voice) without
   any audio (H13). The ephemeral secret itself is never printed.
Prints pass/fail lines only; exits non-zero on the first failure.
"""

import asyncio
import os
import sys

from ..call.live_coach import build_realtime_session, resolve_live_coach_settings, transcription_language

TIMEOUT_S = 30.0


def _fail(msg: str) -> int:
    print(f"FAIL  {msg}")
    return 1


async def _main(patient_lang: str) -> int:
    settings = resolve_live_coach_settings(os.environ)
    if not settings.enabled:
        return _fail(f"live coach is off: {settings.reason}")
    print(f"ok    live coach on ({settings.reason}); model={settings.realtime_model} voice={settings.voice}")
    try:
        import openai
    except ImportError:
        return _fail("the openai package is not installed (uv sync --group call)")
    client = openai.AsyncOpenAI(timeout=TIMEOUT_S, max_retries=0)
    try:
        await client.models.retrieve(settings.realtime_model)
    except Exception as e:                                   # auth, unknown model, network
        return _fail(f"models.retrieve({settings.realtime_model!r}): {type(e).__name__}")
    print(f"ok    models.retrieve({settings.realtime_model!r})")
    lang = transcription_language(settings, patient_lang)
    for label, minimal in (("full", False), ("minimal", True)):
        session = build_realtime_session(settings, lang=lang, instructions="Preflight check. Say nothing.",
                                         minimal=minimal)
        try:
            await client.realtime.client_secrets.create(session=session)
        except Exception as e:                               # the session config was rejected
            msg = str(getattr(e, "message", "") or "")[:200]
            return _fail(f"{label} session (lang={lang or 'auto'}) rejected: {type(e).__name__} {msg}")
        print(f"ok    {label} session accepted (lang={lang or 'auto'})")
    return 0


def main() -> int:
    lang = sys.argv[1] if len(sys.argv) > 1 else "ml"
    return asyncio.run(_main(lang))


if __name__ == "__main__":
    raise SystemExit(main())
