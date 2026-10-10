"""Milestone 2 stub flow (replaced by call/flow.py in Milestone 4).

Consent gate -> live knee angle and rep counter on the tile, pc.ready handshake, pc.rep events.
Records the Spike A measurements (custom-event delays, frame stats) to a JSON report.
"""

import asyncio
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Optional

from pydantic import ValidationError

from .. import __version__
from ..core.angles import AngleTracker
from ..core.config import SessionConfig
from ..core.contracts import ConsentEvent, client_event_adapter
from ..core.rep_engine import Rep, RepEngine
from ..pose.base import Keypoints
from ..pose.draw import OverlayState
from ..core.coach_rules import live_cue_ids
from .processor import PoseProcessor
from .speaker import Speaker

log = logging.getLogger(__name__)


def envelope(type_: str, **fields) -> dict:
    return {"type": type_, "v": 1, "eventId": uuid.uuid4().hex, "ts": int(time.time() * 1000), **fields}


class SpikeFlow:
    def __init__(self, agent, pose: PoseProcessor, cfg: SessionConfig, speaker: Optional[Speaker] = None):
        self.agent, self.pose, self.cfg, self.speaker = agent, pose, cfg, speaker
        self.bargein = None                      # set by agent_main (PhysioBargeIn)
        ex, rx = cfg.exercise, cfg.prescription
        self.tracker = AngleTracker(tuple(ex.joints), ex.mode, rx.side)
        self.engine = RepEngine(ex.rest, ex.start, ex.minPeak, rx.minSecondsPerRep)
        self.state = OverlayState(banner="Waiting for consent", reps_planned=rx.reps, set_index=1,
                                  sets_planned=rx.sets, target=rx.targetAngle, joints=tuple(ex.joints))
        self.joined_at = time.monotonic()
        self.first_input_at: Optional[float] = None
        self.inputs: list[dict] = []
        self.seen: set[str] = set()
        self.ended = asyncio.Event()
        self._tasks: set[asyncio.Task] = set()
        pose.overlay = lambda: self.state
        pose.on_keypoints = self.on_keypoints

    def _fire(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def send(self, type_: str, **fields) -> None:
        try:
            await self.agent.send_custom_event(envelope(type_, **fields))
        except Exception as e:  # noqa: BLE001 - log and continue; events are best effort
            log.warning("send_custom_event %s failed: %s", type_, e)

    async def ready_loop(self) -> None:
        """pc.ready every 5 s until the first client input arrives (handshake, §7.7)."""
        while self.first_input_at is None and not self.ended.is_set():
            await self.send("pc.ready", agentVersion=__version__)
            await asyncio.sleep(5)

    async def on_event(self, sender: Optional[str], data: dict) -> None:
        now = time.monotonic()
        if sender == self.cfg.agentUserId:
            return                                          # our own events echo back
        try:
            ev = client_event_adapter.validate_python(data)
        except ValidationError:
            log.info("ignored custom event from %s: %s", sender, str(data)[:120])
            return
        if ev.eventId in self.seen:
            return
        self.seen.add(ev.eventId)
        delay_ms = round(time.time() * 1000 - ev.ts)
        self.inputs.append({"type": ev.type, "sender": sender, "delay_ms": delay_ms,
                            "since_join_s": round(now - self.joined_at, 1)})
        log.info("spike: received %s from %s (sent->received %d ms, %.1f s after join)",
                 ev.type, sender, delay_ms, now - self.joined_at)
        if self.first_input_at is None:
            self.first_input_at = now
        if isinstance(ev, ConsentEvent) and sender == self.cfg.patient.id and not self.pose.enabled:
            self.pose.enabled = True
            if self.speaker:
                self.speaker.say_ids(["consent.thanks"], "prompt")
            self.state = OverlayState(**{**self.state.__dict__, "banner": "Tracking"})
            await self.send("pc.state", phase="positioning", setIndex=1, setsPlanned=self.cfg.prescription.sets)

    async def on_keypoints(self, t: float, kp: Optional[Keypoints], shape: tuple[int, ...]) -> None:
        s = self.tracker.update(t, kp) if kp else None
        if s is None:
            return
        ev = self.engine.update(s.t, s.value)
        rep_peak = self.engine.peak if self.engine.state == "moving" else self.state.rep_peak
        self.state = OverlayState(**{**self.state.__dict__, "value": s.value, "raw_angle": s.raw_angle,
                                     "side": s.side, "rep_peak": rep_peak, "reps": len(self.engine.reps)})
        if isinstance(ev, Rep):
            rx = self.cfg.prescription
            if self.speaker:
                self.speaker.say_ids(live_cue_ids(ev, rx.targetAngle, self.cfg.exercise.mode), "count")
            self._fire(self.send("pc.rep", setIndex=1, n=ev.n, peak=round(ev.peak, 1), seconds=round(ev.seconds, 2),
                                 tooFast=ev.too_fast, target=rx.targetAngle, repsPlanned=rx.reps))

    def report(self) -> dict:
        p = self.pose
        return {
            "sessionId": self.cfg.sessionId,
            "patient_track_subscribed": p.subscribed_at is not None,
            "first_frame_after_subscribe_s": round(p.first_frame_at - p.subscribed_at, 2)
            if p.first_frame_at and p.subscribed_at else None,
            "inputs": self.inputs,
            "reps": len(self.engine.reps),
            "frame_stats": p.stats.samples,
            "said_at": self.speaker.stats.said_at if self.speaker else [],
            "bargein": self.bargein.events if self.bargein else [],
        }

    async def voice_script(self) -> None:
        """Greeting + consent prompt; with SPIKE_VOICE_TEST=1 also three counts (latency spike)."""
        if not self.speaker:
            return
        await asyncio.sleep(1.0)
        self.speaker.say_ids(["intro.greet", "intro.watch"], "prompt")
        self.speaker.say_ids(["consent.ask"], "prompt")
        if os.getenv("SPIKE_VOICE_TEST") == "1":
            await self.speaker.wait_idle()
            for n in (1, 2, 3):
                await asyncio.sleep(1.5)
                self.speaker.say_ids([f"count.{n:02d}"], "count")

    def write_report(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.report(), indent=2), encoding="utf-8")
        log.info("spike report written to %s", path)
