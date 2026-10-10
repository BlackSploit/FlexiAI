"""Supervisor (§8.14): spawns `python -m physiocoach.agent_main --session-id <sid>` per call, tracks it in
Redis, stops it, reaps dead/hung children and reports every exit to the web as `agent_exited`.

Redis keys (per session): pc:agent:{sid} hash {pid, host, status, startedAt}; pc:hb:{sid} (agent heartbeat,
TTL 15 s); pc:sets:{sid} (completed sets); pc:stop_reason:{sid} (end | restart); pc:outbox:{sid} (callbacks).
"""

import asyncio
import json
import logging
import os
import signal
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional

from ..call.outbox import Outbox, RedisStore
from ..core.contracts import StartAgentRequest

log = logging.getLogger(__name__)

STOP_GRACE_S = 10.0
HB_GRACE_S = 20.0            # a child with no heartbeat this long after start is considered hung
REAP_EVERY_S = 30.0


class Busy(Exception):
    """MAX_SESSIONS reached."""


async def spawn_agent(session_id: str, session_json: str) -> asyncio.subprocess.Process:
    return await asyncio.create_subprocess_exec(
        sys.executable, "-m", "physiocoach.agent_main", "--session-id", session_id,
        env={**os.environ, "PC_SESSION_JSON": session_json},
        start_new_session=True)                     # own process group: SIGTERM reaches its children too


def kill_group(pid: int, sig: int) -> None:
    try:
        if hasattr(os, "killpg"):
            os.killpg(os.getpgid(pid), sig)
        else:                                       # Windows dev only
            os.kill(pid, sig)
    except (ProcessLookupError, PermissionError, OSError):
        pass


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError, OSError):
        return False


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass
class Child:
    session_id: str
    pid: int
    proc: Optional[asyncio.subprocess.Process]
    started: float
    stop_requested: bool = False
    waiter: Optional[asyncio.Task] = field(default=None, repr=False)


class Supervisor:
    def __init__(self, redis, host: str, max_sessions: int, web_url: str, callback_secret: str,
                 spawner: Callable[[str, str], Awaitable] = spawn_agent, kill: Callable[[int, int], None] = kill_group,
                 alive: Callable[[int], bool] = pid_alive, clock: Callable[[], float] = time.monotonic,
                 stop_grace_s: float = STOP_GRACE_S, outbox_factory: Optional[Callable[[str], Outbox]] = None):
        self.redis, self.host, self.max_sessions = redis, host, max_sessions
        self.web_url, self.callback_secret = web_url, callback_secret
        self.spawner, self.kill, self.alive, self.clock = spawner, kill, alive, clock
        self.stop_grace_s = stop_grace_s
        self.outbox_factory = outbox_factory or (
            lambda sid: Outbox(sid, self.web_url, self.callback_secret, RedisStore(self.redis, sid)))
        self.children: dict[str, Child] = {}

    # ------------------------------------------------------------ API operations
    async def start(self, req: StartAgentRequest) -> tuple[dict, bool]:
        """Idempotent on sessionId. Returns ({pid, host}, created)."""
        sid = req.sessionId
        child = self.children.get(sid)
        if child and self.alive(child.pid):
            return {"pid": child.pid, "host": self.host}, False
        if len(self.children) >= self.max_sessions:
            raise Busy()
        await self.redis.delete(f"pc:stop_reason:{sid}", f"pc:hb:{sid}", f"pc:sets:{sid}")
        proc = await self.spawner(sid, req.model_dump_json())
        child = Child(sid, proc.pid, proc, self.clock())
        self.children[sid] = child
        await self.redis.hset(f"pc:agent:{sid}", mapping={"pid": proc.pid, "host": self.host, "status": "starting",
                                                          "startedAt": iso_now()})
        child.waiter = asyncio.create_task(self._wait_child(child))
        log.info("session %s: agent started (pid %d)", sid, proc.pid)
        return {"pid": proc.pid, "host": self.host}, True

    async def stop(self, sid: str, reason: str) -> bool:
        info = await self.redis.hgetall(f"pc:agent:{sid}")
        if not info:
            return False
        pid = int(info["pid"])
        await self.redis.set(f"pc:stop_reason:{sid}", reason, ex=600)
        await self.redis.hset(f"pc:agent:{sid}", "status", "stopping")
        if sid in self.children:
            self.children[sid].stop_requested = True
        self.kill(pid, signal.SIGTERM)
        asyncio.create_task(self._kill_after_grace(sid, pid))
        log.info("session %s: stop requested (%s)", sid, reason)
        return True

    async def get(self, sid: str) -> Optional[dict]:
        info = await self.redis.hgetall(f"pc:agent:{sid}")
        if not info:
            return None
        return {"pid": int(info["pid"]), "host": info["host"], "status": info.get("status", "unknown"),
                "startedAt": info.get("startedAt"), "lastHeartbeatAt": await self.redis.get(f"pc:hb:{sid}")}

    async def publish_input(self, sid: str, sender: Optional[str], event: dict) -> None:
        await self.redis.publish(f"pc:input:{sid}", json.dumps({"sender": sender, "event": event}))

    # ------------------------------------------------------------ lifecycle
    async def _kill_after_grace(self, sid: str, pid: int) -> None:
        await asyncio.sleep(self.stop_grace_s)
        if self.alive(pid):
            log.warning("session %s: agent ignored SIGTERM for %.0f s, SIGKILL", sid, self.stop_grace_s)
            self.kill(pid, signal.SIGKILL)

    async def _wait_child(self, child: Child) -> None:
        code = await child.proc.wait()
        await self.report_exit(child.session_id, code, child.stop_requested)

    async def report_exit(self, sid: str, code: int, stop_requested: bool = False) -> None:
        """Flush the child's leftover callbacks, then post agent_exited; clean up the session keys."""
        sig = None
        if code < 0:
            try:
                sig = signal.Signals(-code).name
            except ValueError:
                sig = f"SIG{-code}"
            # A kill WE asked for (end/restart, grace expired) is a normal stop, not a crash.
            code = 0 if stop_requested else -1
        sets = int(await self.redis.get(f"pc:sets:{sid}") or 0)
        outbox = self.outbox_factory(sid)
        runner = asyncio.create_task(outbox.run())
        try:
            await outbox.post({"type": "agent_exited", "code": code, "signal": sig, "setsCompleted": sets})
            drained = await outbox.drain(30)
        finally:
            runner.cancel()
            await outbox.aclose()
        await self.redis.delete(f"pc:agent:{sid}", f"pc:hb:{sid}", f"pc:sets:{sid}", f"pc:stop_reason:{sid}")
        if not drained:
            log.error("session %s: callbacks left in pc:outbox:%s for a later retry", sid, sid)
        self.children.pop(sid, None)
        log.info("session %s: agent exited with code %d%s (%d sets)", sid, code, f" ({sig})" if sig else "", sets)

    async def reap_once(self) -> list[str]:
        """Children that died or hung (no heartbeat), and orphans from a previous supervisor run."""
        reaped = []
        async for key in self.redis.scan_iter(match="pc:agent:*"):
            sid = key.split(":", 2)[2]
            info = await self.redis.hgetall(key)
            if not info or info.get("host") != self.host:
                continue
            pid = int(info["pid"])
            child = self.children.get(sid)
            hb = await self.redis.get(f"pc:hb:{sid}")
            if child is not None:
                if hb is None and self.alive(pid) and self.clock() - child.started > HB_GRACE_S:
                    log.error("session %s: no heartbeat, killing hung agent %d", sid, pid)
                    self.kill(pid, signal.SIGKILL)          # its waiter reports the exit (as a crash)
                    reaped.append(sid)
                continue
            if self.alive(pid) and hb is not None:
                continue                                     # someone else's healthy child (same host label)
            if self.alive(pid):
                self.kill(pid, signal.SIGKILL)
            await self.report_exit(sid, -1)
            reaped.append(sid)
        return reaped

    async def reaper(self, every_s: float = REAP_EVERY_S) -> None:
        while True:
            try:
                await self.reap_once()
            except Exception as e:  # noqa: BLE001 - keep reaping
                log.warning("reaper error: %s", e)
            await asyncio.sleep(every_s)
