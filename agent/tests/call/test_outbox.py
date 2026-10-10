import asyncio
import json

import httpx
import pytest

from physiocoach.call.outbox import CALLBACK_PATH, MemoryStore, Outbox
from physiocoach.core import signing

SECRET = "s" * 40


class Server:
    """httpx MockTransport: replays a scripted list of status codes and verifies every signature."""

    def __init__(self, statuses, clock):
        self.statuses, self.clock = list(statuses), clock
        self.seen: list[tuple[int, bool, dict]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = request.content
        ok = signing.verify(SECRET, "POST", CALLBACK_PATH, body, request.headers.get(signing.HEADER), now=self.clock())
        status = self.statuses.pop(0) if self.statuses else 200
        if not ok:
            status = 401
        self.seen.append((status, ok, json.loads(body)))
        return httpx.Response(status)


def make(statuses, clock=None):
    clock = clock or (lambda: int(__import__("time").time()))
    server = Server(statuses, clock)
    slept: list[float] = []

    async def fake_sleep(s):
        slept.append(s)
        await asyncio.sleep(0)

    ob = Outbox("sess1", "http://web", SECRET, MemoryStore(),
                client=httpx.AsyncClient(transport=httpx.MockTransport(server)), sleep=fake_sleep)
    return ob, server, slept


async def run_until_drained(ob):
    task = asyncio.create_task(ob.run())
    assert await ob.drain(2)
    task.cancel()


async def test_delivers_in_order_with_stable_event_id_and_session():
    ob, server, _ = make([200, 200])
    await ob.post({"type": "agent_joined", "pid": 1, "host": "h"})
    await ob.post({"type": "heartbeat", "eventId": "fixed-id-123"})
    await run_until_drained(ob)
    bodies = [b for _, _, b in server.seen]
    assert [b["type"] for b in bodies] == ["agent_joined", "heartbeat"]
    assert all(b["sessionId"] == "sess1" for b in bodies) and bodies[1]["eventId"] == "fixed-id-123"


async def test_5xx_and_network_errors_retry_with_backoff_and_same_event_id():
    ob, server, slept = make([503, 502, 200])
    await ob.post({"type": "heartbeat"})
    await run_until_drained(ob)
    ids = {b["eventId"] for _, _, b in server.seen}
    assert len(server.seen) == 3 and len(ids) == 1
    assert slept == [1.0, 2.0]


async def test_signature_is_recomputed_for_every_attempt():
    now = [1_000_000]
    ob, server, slept = make([503, 200], clock=lambda: now[0])

    async def sleep_400s(s):                      # a long outage between attempts
        now[0] += 400
        await asyncio.sleep(0)
    ob.sleep = sleep_400s
    import physiocoach.core.signing as sig
    real_sign = sig.sign
    try:
        import physiocoach.call.outbox as obmod
        obmod.sign = lambda secret, m, p, b: real_sign(secret, m, p, b, t=now[0])
        await ob.post({"type": "heartbeat"})
        await run_until_drained(ob)
    finally:
        obmod.sign = real_sign
    assert [ok for _, ok, _ in server.seen] == [True, True]      # the retry 400 s later still verifies


async def test_401_retries_five_times_then_dead_letters():
    ob, server, _ = make([401] * 10)
    await ob.post({"type": "heartbeat"})
    await run_until_drained(ob)
    assert len(server.seen) == 5
    assert len(ob.store.dead_items) == 1 and await ob.store.size() == 0


async def test_400_is_dead_lettered_at_once_and_the_queue_continues():
    ob, server, _ = make([400, 200])
    await ob.post({"type": "set_result"})
    await ob.post({"type": "heartbeat"})
    await run_until_drained(ob)
    assert len(ob.store.dead_items) == 1 and json.loads(ob.store.dead_items[0])["type"] == "set_result"
    assert [d["type"] for d in ob.delivered] == ["heartbeat"]


async def test_drain_times_out_when_the_web_is_down():
    ob, _, _ = make([503] * 100)

    async def slow_sleep(s):
        await asyncio.sleep(0.05)
    ob.sleep = slow_sleep
    task = asyncio.create_task(ob.run())
    await ob.post({"type": "heartbeat"})
    assert not await ob.drain(0.1)
    task.cancel()


def test_signing_binds_method_path_body_and_age():
    body = b'{"a":1}'
    h = signing.sign(SECRET, "GET", "/sessions/A", b"", t=1000)
    assert signing.verify(SECRET, "GET", "/sessions/A", b"", h, now=1000)
    assert not signing.verify(SECRET, "DELETE", "/sessions/A", b"", h, now=1000)     # method bound
    assert not signing.verify(SECRET, "GET", "/sessions/B", b"", h, now=1000)        # path bound
    h2 = signing.sign(SECRET, "POST", "/x", body, t=1000)
    assert not signing.verify(SECRET, "POST", "/x", b'{"a":2}', h2, now=1000)       # body bound
    assert not signing.verify(SECRET, "POST", "/x", body, h2, now=1301)             # stale
    assert not signing.verify(SECRET, "POST", "/x", body, "garbage", now=1000)
    assert not signing.verify("", "POST", "/x", body, h2, now=1000)
