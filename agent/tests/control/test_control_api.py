"""Control API + supervisor (§7.9, §8.14) with a fake Redis and fake child processes. Needs FastAPI (Docker)."""

import asyncio
import fnmatch
import json
import signal

import pytest

pytest.importorskip("fastapi")

import httpx  # noqa: E402

from physiocoach.call.outbox import MemoryStore, Outbox  # noqa: E402
from physiocoach.control.api import create_app  # noqa: E402
from physiocoach.control.supervisor import Supervisor  # noqa: E402
from physiocoach.core import signing  # noqa: E402

SECRET = "c" * 40
START = json.loads(open(__import__("pathlib").Path(__file__).resolve().parents[3] / "shared" / "fixtures" / "control"
                        / "valid" / "start-live.json", encoding="utf-8").read())


class FakeRedis:
    """The handful of commands the supervisor uses, with decode_responses=True semantics."""

    def __init__(self):
        self.kv: dict[str, object] = {}
        self.published: list[tuple[str, str]] = []

    async def hset(self, key, field=None, value=None, mapping=None):
        h = self.kv.setdefault(key, {})
        if mapping:
            h.update({k: str(v) for k, v in mapping.items()})
        if field is not None:
            h[field] = str(value)

    async def hgetall(self, key):
        return dict(self.kv.get(key) or {})

    async def set(self, key, value, ex=None):
        self.kv[key] = str(value)

    async def get(self, key):
        v = self.kv.get(key)
        return v if isinstance(v, str) else None

    async def delete(self, *keys):
        for k in keys:
            self.kv.pop(k, None)

    async def publish(self, channel, message):
        self.published.append((channel, message))

    async def scan_iter(self, match="*"):
        for k in list(self.kv):
            if fnmatch.fnmatch(k, match):
                yield k

    async def ping(self):
        return True


class FakeProc:
    _next = 1000

    def __init__(self):
        FakeProc._next += 1
        self.pid = FakeProc._next
        self._done = asyncio.Event()
        self.returncode = None

    def exit(self, code):
        self.returncode = code
        self._done.set()

    async def wait(self):
        await self._done.wait()
        return self.returncode


class Rig:
    def __init__(self, max_sessions=2):
        self.redis = FakeRedis()
        self.procs: dict[str, FakeProc] = {}
        self.killed: list[tuple[int, int]] = []
        self.dead: set[int] = set()
        self.callbacks: list[dict] = []

        async def spawner(sid, session_json):
            assert json.loads(session_json)["sessionId"] == sid
            p = FakeProc()
            self.procs[sid] = p
            return p

        def web(request: httpx.Request) -> httpx.Response:
            self.callbacks.append(json.loads(request.content))
            return httpx.Response(200)

        def outbox_factory(sid):
            return Outbox(sid, "http://web", "cb", MemoryStore(), client=httpx.AsyncClient(transport=httpx.MockTransport(web)))

        self.sup = Supervisor(self.redis, "host-a", max_sessions, "http://web", "cb", spawner=spawner,
                              kill=lambda pid, sig: self.killed.append((pid, sig)), alive=lambda pid: pid not in self.dead,
                              stop_grace_s=0.05, outbox_factory=outbox_factory)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(self.sup, self.redis)),
                                        base_url="http://worker")

    async def call(self, method, path, body=b"", signed=True):
        headers = {signing.HEADER: signing.sign(SECRET, method, path, body)} if signed else {}
        return await self.client.request(method, path, content=body, headers=headers)


@pytest.fixture
def rig(monkeypatch):
    monkeypatch.setenv("AGENT_CONTROL_SECRET", SECRET)
    return Rig()


def start_body(sid="sess_demo01") -> bytes:
    return json.dumps({**START, "sessionId": sid, "callId": sid}).encode()


async def test_signature_is_required_except_healthz(rig):
    assert (await rig.call("POST", "/sessions", start_body(), signed=False)).status_code == 401
    r = await rig.client.post("/sessions", content=start_body(),
                              headers={signing.HEADER: signing.sign(SECRET, "GET", "/sessions", start_body())})
    assert r.status_code == 401                                    # signed for another method
    assert (await rig.client.get("/healthz")).json() == {"ok": True, "sessions": 0, "maxSessions": 2, "redis": True}


async def test_start_is_idempotent_and_limited(rig):
    r1 = await rig.call("POST", "/sessions", start_body("a"))
    r2 = await rig.call("POST", "/sessions", start_body("a"))
    assert (r1.status_code, r2.status_code) == (201, 200) and r1.json() == r2.json()
    assert r1.json()["host"] == "host-a"
    await rig.call("POST", "/sessions", start_body("b"))
    assert (await rig.call("POST", "/sessions", start_body("c"))).status_code == 429
    assert (await rig.call("POST", "/sessions", b'{"nope": 1}')).status_code == 400
    info = (await rig.call("GET", "/sessions/a")).json()
    assert info["status"] == "starting" and info["pid"] == r1.json()["pid"]


async def test_stop_signals_the_group_and_kills_after_grace(rig):
    pid = (await rig.call("POST", "/sessions", start_body("a"))).json()["pid"]
    assert (await rig.call("DELETE", "/sessions/zzz?reason=end")).status_code == 404
    r = await rig.call("DELETE", "/sessions/a?reason=restart")
    assert r.status_code == 202 and (pid, signal.SIGTERM) in rig.killed
    assert await rig.redis.get("pc:stop_reason:a") == "restart"
    await asyncio.sleep(0.1)
    assert (pid, signal.SIGKILL) in rig.killed                     # ignored SIGTERM for the grace period
    assert (await rig.call("DELETE", "/sessions/a?reason=bogus")).status_code == 400


@pytest.mark.parametrize("code,stop,expected", [(0, False, (0, None)), (4, False, (4, None)),
                                                (-9, False, (-1, "SIGKILL")), (-9, True, (0, "SIGKILL"))])
async def test_child_exit_is_reported_with_mapped_code(rig, code, stop, expected):
    await rig.call("POST", "/sessions", start_body("a"))
    await rig.redis.set("pc:sets:a", 2)
    if stop:
        await rig.call("DELETE", "/sessions/a?reason=end")
    rig.procs["a"].exit(code)
    for _ in range(100):
        if rig.callbacks:
            break
        await asyncio.sleep(0.01)
    cb = rig.callbacks[-1]
    assert cb["type"] == "agent_exited" and (cb["code"], cb["signal"]) == expected and cb["setsCompleted"] == 2
    assert await rig.redis.hgetall("pc:agent:a") == {} and "a" not in rig.sup.children


async def test_input_is_published_with_its_sender(rig):
    ev = {"type": "pc.stop", "v": 1, "eventId": "evt_0001abcd", "ts": 1, "reason": "button"}
    r = await rig.call("POST", "/sessions/a/input?sender=pat", json.dumps(ev).encode())
    assert r.status_code == 202
    channel, msg = rig.redis.published[0]
    assert channel == "pc:input:a" and json.loads(msg) == {"sender": "pat", "event": ev}
    assert (await rig.call("POST", "/sessions/a/input", b'{"type":"pc.dance"}')).status_code == 400


async def test_reaper_reports_orphans_and_kills_hung_children(rig):
    await rig.redis.hset("pc:agent:orphan", mapping={"pid": 99999, "host": "host-a", "status": "running"})
    rig.dead.add(99999)
    await rig.redis.hset("pc:agent:other", mapping={"pid": 5, "host": "host-b", "status": "running"})
    pid = (await rig.call("POST", "/sessions", start_body("hung"))).json()["pid"]
    rig.sup.children["hung"].started -= 60                         # no heartbeat for a minute
    reaped = await rig.sup.reap_once()
    assert set(reaped) == {"orphan", "hung"}
    assert (pid, signal.SIGKILL) in rig.killed
    assert any(c["type"] == "agent_exited" and c["sessionId"] == "orphan" and c["code"] == -1 for c in rig.callbacks)
    assert await rig.redis.hgetall("pc:agent:other")               # another host's session is left alone
