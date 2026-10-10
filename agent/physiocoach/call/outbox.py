"""Outbox (§8.16): every worker -> web callback goes through here, in order, durably.

* post(event): adds eventId (once, at enqueue time, so retries stay idempotent) and sessionId,
  serialises once, stores the UNSIGNED body (Redis `pc:outbox:{sid}`, or memory without Redis).
* The delivery loop SIGNS EVERY ATTEMPT (a signature made at enqueue time would be stale after an
  outage longer than 300 s and every retry would get 401).
* network error / 5xx: exponential backoff 1, 2, 4 ... 30 s, forever.
* 401: up to 5 attempts (clock skew, secret rotation), then dead-letter.
* 400 (schema): dead-letter at once (`pc:outbox:dead:{sid}`), never silently dropped. 2xx: removed.
* drain(timeout): on done/SIGTERM; the supervisor retries anything left after the child exits.
"""

import asyncio
import json
import logging
import uuid
from typing import Optional, Protocol

import httpx

from ..core.signing import HEADER, sign

log = logging.getLogger(__name__)

CALLBACK_PATH = "/api/agent/events"
MAX_401 = 5
BACKOFF_MAX_S = 30.0


class OutboxStore(Protocol):
    async def push(self, body: bytes) -> None: ...
    async def peek(self) -> Optional[bytes]: ...
    async def remove(self, body: bytes) -> None: ...
    async def dead(self, body: bytes) -> None: ...
    async def size(self) -> int: ...


class MemoryStore:
    def __init__(self) -> None:
        self.items: list[bytes] = []
        self.dead_items: list[bytes] = []

    async def push(self, body: bytes) -> None:
        self.items.append(body)

    async def peek(self) -> Optional[bytes]:
        return self.items[0] if self.items else None

    async def remove(self, body: bytes) -> None:
        if body in self.items:
            self.items.remove(body)

    async def dead(self, body: bytes) -> None:
        self.dead_items.append(body)

    async def size(self) -> int:
        return len(self.items)


class RedisStore:
    def __init__(self, redis, session_id: str) -> None:
        self.r, self.key, self.dead_key = redis, f"pc:outbox:{session_id}", f"pc:outbox:dead:{session_id}"

    async def push(self, body: bytes) -> None:
        await self.r.rpush(self.key, body)

    async def peek(self) -> Optional[bytes]:
        return await self.r.lindex(self.key, 0)

    async def remove(self, body: bytes) -> None:
        await self.r.lrem(self.key, 1, body)

    async def dead(self, body: bytes) -> None:
        await self.r.rpush(self.dead_key, body)

    async def size(self) -> int:
        return await self.r.llen(self.key)


class Outbox:
    def __init__(self, session_id: str, base_url: str, secret: str, store: Optional[OutboxStore] = None,
                 client: Optional[httpx.AsyncClient] = None, sleep=asyncio.sleep, timeout_s: float = 5.0):
        self.session_id, self.url, self.secret = session_id, base_url.rstrip("/") + CALLBACK_PATH, secret
        self.store = store or MemoryStore()
        self.client = client or httpx.AsyncClient(timeout=timeout_s)
        self.sleep = sleep
        self._wake = asyncio.Event()
        self._idle = asyncio.Event()
        self._idle.set()
        self.delivered: list[dict] = []                  # dev/test visibility

    async def post(self, event: dict) -> str:
        event = {**event}
        event.setdefault("eventId", uuid.uuid4().hex)
        event["sessionId"] = self.session_id
        body = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode()
        await self.store.push(body)
        self._idle.clear()
        self._wake.set()
        return event["eventId"]

    async def run(self) -> None:
        while True:
            body = await self.store.peek()
            if body is None:
                self._idle.set()
                self._wake.clear()
                await self._wake.wait()
                continue
            await self._deliver(body)

    async def drain(self, timeout: float) -> bool:
        """True when everything queued has been delivered (or dead-lettered) within `timeout`."""
        if await self.store.size() == 0:
            return True
        try:
            await asyncio.wait_for(self._idle.wait(), timeout)
            return True
        except asyncio.TimeoutError:
            log.warning("outbox not drained after %.1f s (%d left; the supervisor retries)", timeout,
                        await self.store.size())
            return False

    async def _deliver(self, body: bytes | str) -> None:
        body = body if isinstance(body, bytes) else body.encode()   # Redis may hand back str (decode_responses)
        backoff, unauthorized = 1.0, 0
        kind = json.loads(body).get("type")
        while True:
            status = await self._attempt(body)
            if status is not None and 200 <= status < 300:
                await self.store.remove(body)
                self.delivered.append(json.loads(body))
                return
            if status == 400:
                log.error("callback %s rejected (400): dead-lettered", kind)
                await self._dead(body)
                return
            if status == 401:
                unauthorized += 1
                if unauthorized >= MAX_401:
                    log.error("callback %s unauthorized %d times: dead-lettered", kind, unauthorized)
                    await self._dead(body)
                    return
            log.warning("callback %s failed (%s): retry in %.0f s", kind, status, backoff)
            await self.sleep(backoff)
            backoff = min(BACKOFF_MAX_S, backoff * 2)

    async def _attempt(self, body: bytes) -> Optional[int]:
        headers = {"content-type": "application/json", HEADER: sign(self.secret, "POST", CALLBACK_PATH, body)}
        try:
            r = await self.client.post(self.url, content=body, headers=headers)
            return r.status_code
        except httpx.HTTPError as e:
            log.debug("callback network error: %s", e)
            return None

    async def _dead(self, body: bytes) -> None:
        await self.store.dead(body)
        await self.store.remove(body)

    async def aclose(self) -> None:
        await self.client.aclose()
