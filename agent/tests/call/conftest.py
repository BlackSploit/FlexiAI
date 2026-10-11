"""Shared call-flow test rig: fake agent/pose/outbox, the real Speaker and Flow, shrunken timeouts.

`Rig(live=True)` also wires a LiveCoach exactly like agent_main does in live mode (CoachFacade in front of
the fake agent, Speaker hold/before_play hooks, halt listener) with a FakePort instead of OpenAI.
"""

import asyncio
import time

import pytest

from physiocoach.call.flow import Flow, FlowTiming
from physiocoach.call.inputs import InputRouter
from physiocoach.call.live_coach import CoachFacade, LiveCoach, LiveCoachSettings
from physiocoach.call.speaker import Speaker
from physiocoach.core.contracts import StartAgentRequest
from physiocoach.pose.base import FrameMeta
from physiocoach.replay import synthetic

FAST = FlowTiming(patient_join=1.0, consent_reask=0.15, consent_timeout=0.4, positioning_prompt=0.3,
                  positioning_max=2.0, positioned_hold=2.0, idle_after_rep=1.5, idle_no_rep=1.5, pain_reask=0.1,
                  pain_timeout=0.2, rest=0.05, patient_return=0.3, cant_see_after=5.0, ready_every=0.05,
                  say_bye_max=0.1, outbox_drain=0.1)
META = FrameMeta(1280, 720, 120.0)


def config(**over) -> StartAgentRequest:
    base = dict(sessionId="s1", callType="default", callId="s1", agentUserId="agent",
                patient={"id": "pat", "name": "P", "lang": "ml"}, physioId="phy",
                exercise={"id": "knee_bend", "joints": ("hip", "knee", "ankle"), "mode": "flex", "rest": 15,
                          "start": 25, "minPeak": 35, "cameraView": "side"},
                prescription={"side": "auto", "targetAngle": 60, "reps": 10, "sets": 1, "minSecondsPerRep": 2},
                mode="live")
    base.update(over)
    return StartAgentRequest.model_validate(base)


class FakeAgent:
    def __init__(self):
        self.said: list[str] = []
        self.events: list[dict] = []
        self.fail_sends = False

    async def say(self, text, interrupt=False):
        self.said.append(text)

    async def send_custom_event(self, payload):
        if self.fail_sends:
            raise RuntimeError("stream down")
        self.events.append(payload)

    def types(self, t: str) -> list[dict]:
        return [e for e in self.events if e["type"] == t]


class FakeOutbox:
    def __init__(self):
        self.posted: list[dict] = []

    async def post(self, event):
        self.posted.append(event)
        return "id"

    async def drain(self, timeout):
        return True

    def of(self, t: str) -> list[dict]:
        return [e for e in self.posted if e["type"] == t]


class FakePose:
    def __init__(self):
        self.enabled = False
        self.overlay = None
        self.on_keypoints = None
        self.frames_while_disabled = 0
        self.attached = None

    async def attach_file(self, path):
        self.attached = path


class FakePort:
    """RealtimePort without OpenAI: records events, counts local flushes, connects on request."""

    def __init__(self, auto_up: bool = True):
        self.is_up = False
        self.auto_up = auto_up
        self.events: list[dict] = []
        self.flushes = 0
        self.connects = 0
        self.coach = None

    @property
    def up(self) -> bool:
        return self.is_up

    async def send_event(self, ev: dict) -> None:
        self.events.append(ev)

    def flush_local(self) -> None:
        self.flushes += 1

    async def start_connect(self) -> None:
        self.connects += 1
        if self.auto_up:
            self.is_up = True
            if self.coach is not None:
                self.coach.on_connected()

    def types(self, t: str) -> list[dict]:
        return [e for e in self.events if e.get("type") == t]


class Rig:
    def __init__(self, cfg=None, timing=FAST, peak=65.0, clip_s=0.0, live=False, settings=None, port=None,
                 **flow_kw):
        self.agent, self.outbox, self.pose = FakeAgent(), FakeOutbox(), FakePose()
        self.interrupts = 0
        self.cfg = cfg or config()

        async def interrupt():
            self.interrupts += 1

        self.coach = self.port = None
        if live:
            self.port = port or FakePort()
            self.coach = LiveCoach(self.cfg, settings or LiveCoachSettings(enabled=True, reason="test"),
                                   self.agent.send_custom_event)
            self.port.coach = self.coach
            self.facade = CoachFacade(self.agent, self.agent.say, self.coach)
            self.speaker = Speaker(self.facade, lambda t: clip_s, interrupt_audio=interrupt,
                                   hold=self.coach.hold, before_play=self.coach.before_clip)
            flow_agent = self.facade
        else:
            self.speaker = Speaker(self.agent, lambda t: clip_s, interrupt_audio=interrupt)
            flow_agent = self.agent
        self.flow = Flow(flow_agent, self.pose, self.cfg, self.speaker, self.outbox, timing=timing, **flow_kw)
        self.router = InputRouter(self.flow, "pat", "phy", "agent")
        if live:
            self.coach.bind(self.flow, self.router, self.speaker, self.pose)
            self.coach.attach_port(self.port)
        self.peak, self.feeding = peak, True
        self.tasks = [asyncio.create_task(self.speaker.run()), asyncio.create_task(self._feed())]
        if live:
            self.tasks.append(asyncio.create_task(self.coach.run()))
        self.run = asyncio.create_task(self.flow.run())

    async def _feed(self):
        """Like PoseProcessor: frames reach the flow ONLY while pose.enabled (consent gate)."""
        t, step, period = 0.0, 1 / 12, 3.1 + 1.0
        while True:
            await asyncio.sleep(0)
            if not self.feeding:
                continue
            if not self.pose.enabled:
                self.pose.frames_while_disabled += 1
                continue
            tau = t % period
            v = synthetic._shape(tau, 3.1, self.peak) if tau < 3.1 else synthetic.BASE
            await self.flow.on_keypoints(t, synthetic.keypoints(synthetic.Frame(t, v), ("hip", "knee", "ankle"), "flex"), META)
            t += step

    async def until(self, cond, timeout=8.0):
        end = time.monotonic() + timeout
        while not cond():
            if time.monotonic() > end:
                raise AssertionError(f"timed out; phases so far: {self.flow.phases}")
            await asyncio.sleep(0.002)

    async def send(self, sender, type_, **fields):
        await self.router.handle(sender, {"type": type_, "v": 1, "eventId": f"evt{len(self.agent.events):05d}x",
                                          "ts": int(time.time() * 1000), **fields})

    async def close(self):
        for t in self.tasks:
            t.cancel()
        if not self.run.done():
            self.run.cancel()


@pytest.fixture
async def rig():
    rigs: list[Rig] = []

    def make(**kw):
        r = Rig(**kw)
        rigs.append(r)
        return r
    yield make
    for r in rigs:
        await r.close()


async def to_set(r: Rig):
    r.flow.on_patient_joined()
    await r.until(lambda: r.flow.phase == "await_consent")
    await r.send("pat", "pc.consent", agreed=True)
    await r.until(lambda: r.flow.phase == "set")
