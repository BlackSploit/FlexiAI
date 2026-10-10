"""Local stand-in for the web's POST /api/agent/events (dev only, until Milestone 5).

    python -m physiocoach.devtools.callback_stub --port 3000 [--log cache/callbacks.jsonl]

Same contract as the real route (§7.6): 401 on a bad/missing/stale signature (AGENT_CALLBACK_SECRET),
400 on a schema failure, 200 otherwise (duplicates included). Every accepted callback is appended
to a JSONL file and logged.
"""

import argparse
import json
import logging
import os
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request, Response
from pydantic import ValidationError

from ..core.contracts import callback_adapter
from ..core.signing import HEADER, verify

log = logging.getLogger("callback_stub")


def make_app(secret: str, log_path: Path) -> FastAPI:
    app = FastAPI()
    seen: set[str] = set()

    @app.post("/api/agent/events")
    async def events(request: Request) -> Response:
        body = await request.body()
        if not verify(secret, "POST", "/api/agent/events", body, request.headers.get(HEADER)):
            log.warning("401 bad signature")
            return Response(status_code=401)
        try:
            cb = callback_adapter.validate_json(body)
        except ValidationError as e:
            log.warning("400 schema: %s", e.errors()[:2])
            return Response(status_code=400)
        dup = cb.eventId in seen
        seen.add(cb.eventId)
        log.info("%s %s %s", "dup" if dup else "OK ", cb.type,
                 {k: v for k, v in json.loads(body).items() if k not in ("type", "eventId", "sessionId", "perRep",
                                                                          "feedbackMl")})
        if not dup:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with log_path.open("a", encoding="utf-8") as f:
                f.write(body.decode("utf-8") + "\n")
        return Response(content='{"ok":true}', media_type="application/json")

    return app


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=3000)
    p.add_argument("--log", default="cache/callbacks.jsonl")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    secret = os.getenv("AGENT_CALLBACK_SECRET", "")
    if not secret:
        raise SystemExit("AGENT_CALLBACK_SECRET is not set")
    uvicorn.run(make_app(secret, Path(args.log)), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
