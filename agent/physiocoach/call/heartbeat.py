"""Agent heartbeat for the supervisor's reaper (§8.14).

Every 5 s: SET pc:hb:{sid} <iso time> EX 15, and SET pc:sets:{sid} <completed sets> (for the
supervisor's agent_exited report). A missing pc:hb key means the agent is gone.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Callable, Optional

log = logging.getLogger(__name__)


async def heartbeat(redis, session_id: str, sets_completed: Optional[Callable[[], int]] = None,
                    every_s: float = 5.0, ttl_s: int = 15) -> None:
    while True:
        try:
            now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
            await redis.set(f"pc:hb:{session_id}", now, ex=ttl_s)
            if sets_completed is not None:
                await redis.set(f"pc:sets:{session_id}", sets_completed(), ex=3600)
        except Exception as e:  # noqa: BLE001 - a missed beat is not fatal; the reaper tolerates 15 s
            log.warning("heartbeat failed: %s", e)
        await asyncio.sleep(every_s)
