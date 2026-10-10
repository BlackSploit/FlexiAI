"""Agent-worker control API (§7.9). Internal network only; every route except /healthz is HMAC-signed.

    uvicorn physiocoach.control.api:app --host 0.0.0.0 --port 8080 --workers 1
"""

import asyncio
import logging
import os
import socket
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from ..core.contracts import StartAgentRequest, client_event_adapter
from .auth import require_signature
from .supervisor import Busy, Supervisor

log = logging.getLogger("physiocoach.control")


def build_supervisor(redis) -> Supervisor:
    return Supervisor(redis, host=os.getenv("WORKER_HOST", socket.gethostname()),
                      max_sessions=int(os.getenv("MAX_SESSIONS", "2")),
                      web_url=os.getenv("WEB_INTERNAL_URL", "http://localhost:3000"),
                      callback_secret=os.getenv("AGENT_CALLBACK_SECRET", ""))


def create_app(supervisor: Optional[Supervisor] = None, redis=None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        reaper = None
        if app.state.supervisor is None:
            import redis.asyncio as aioredis
            app.state.redis = aioredis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"), decode_responses=True)
            app.state.supervisor = build_supervisor(app.state.redis)
            reaper = asyncio.create_task(app.state.supervisor.reaper())
        yield
        if reaper:
            reaper.cancel()

    app = FastAPI(title="physiocoach agent-worker", lifespan=lifespan)
    app.state.supervisor, app.state.redis = supervisor, redis

    def sup(request: Request) -> Supervisor:
        return request.app.state.supervisor

    @app.post("/sessions")
    async def start_session(request: Request, body: bytes = Depends(require_signature)):
        try:
            req = StartAgentRequest.model_validate_json(body)
        except ValidationError as e:
            raise HTTPException(status_code=400, detail=e.errors()[:3]) from None
        try:
            info, created = await sup(request).start(req)
        except Busy:
            raise HTTPException(status_code=429, detail="MAX_SESSIONS reached") from None
        return JSONResponse(info, status_code=201 if created else 200)

    @app.delete("/sessions/{session_id}")
    async def stop_session(session_id: str, request: Request, reason: str = "end",
                           _: bytes = Depends(require_signature)):
        if reason not in ("end", "restart"):
            raise HTTPException(status_code=400, detail="reason must be end or restart")
        if not await sup(request).stop(session_id, reason):
            raise HTTPException(status_code=404, detail="unknown session")
        return JSONResponse({"stopping": True}, status_code=202)

    @app.get("/sessions/{session_id}")
    async def get_session(session_id: str, request: Request, _: bytes = Depends(require_signature)):
        info = await sup(request).get(session_id)
        if info is None:
            raise HTTPException(status_code=404, detail="unknown session")
        return info

    @app.post("/sessions/{session_id}/input")
    async def session_input(session_id: str, request: Request, sender: Optional[str] = None,
                            body: bytes = Depends(require_signature)):
        try:
            event = client_event_adapter.validate_json(body)
        except ValidationError as e:
            raise HTTPException(status_code=400, detail=e.errors()[:3]) from None
        await sup(request).publish_input(session_id, sender, event.model_dump(exclude_none=True))
        return JSONResponse({"ok": True}, status_code=202)

    @app.get("/healthz")
    async def healthz(request: Request):
        s = sup(request)
        try:
            redis_ok = bool(await s.redis.ping())
        except Exception:  # noqa: BLE001
            redis_ok = False
        return {"ok": redis_ok, "sessions": len(s.children), "maxSessions": s.max_sessions, "redis": redis_ok}

    return app


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()
