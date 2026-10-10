"""Agent heartbeat for the supervisor's reaper (§8.14): SET pc:hb:{sid} 1 EX 15 every 5 s."""

import asyncio
import logging

log = logging.getLogger(__name__)


async def heartbeat(redis, session_id: str, every_s: float = 5.0, ttl_s: int = 15) -> None:
    key = f"pc:hb:{session_id}"
    while True:
        try:
            await redis.set(key, "1", ex=ttl_s)
        except Exception as e:  # noqa: BLE001 - a missed beat is not fatal; the reaper tolerates 15 s
            log.warning("heartbeat failed: %s", e)
        await asyncio.sleep(every_s)
