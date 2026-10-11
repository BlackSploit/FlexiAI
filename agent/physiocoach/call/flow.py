"""Call-flow state machine (§8.15). One asyncio task owns the states:

    (waiting) -> greeting -> await_consent -> positioning -> [countdown -> set -> summary -> await_pain -> rest]*
              -> done          and, from ANY state: halted (safety) | paused (patient left) | cancelled (call end)

Inputs arrive as method calls (on_consent, on_pain, on_patient_joined/left, on_physio_joined, on_keypoints)
and `halt(reason, event_id)` for every safety trigger. A halt, a patient leaving or a call end CANCELS the
state task, so it takes effect within one event-loop tick even during an LLM call, a TTS prefetch or a
30 s rest (§1.4 #8). Cleanup that must finish (outbox posts) is shielded.

Exit codes (§8.14): 0 normal / ended by physio / halted, 3 patient never joined, 4 patient left, 5 no consent.

Pure asyncio: `agent` needs send_custom_event; speaker/pose/outbox are injected (tests use fakes).

Live-coach hooks (inert unless used): `halt_listeners` are called synchronously inside `halt()` (each in
try/except) so the coach is silenced in the same tick; `halted` / `paused` / `consent_given` / `phase` are
read directly by the coach's gates; `progress()` is the only source of numbers for the coach;
`ready_to_continue()` ends a rest early.
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from .. import __version__
from ..core.angles import CONF_MIN, AngleTracker
from ..core.coach_rules import live_cue_ids, render_note, rule_note_ids
from ..core.config import SessionConfig
from ..core.note_llm import note_metrics
from ..core.rep_engine import Rep, RepEngine, RepRejected
from ..core.scoring import SetMetrics, set_metrics
from ..pose.base import FrameMeta, Keypoints
from ..pose.overlay import OverlayState

log = logging.getLogger(__name__)

STOP_REASON = {"stop": "stop_pressed", "pain": "pain", "symptom": "symptom"}
EDGE_FRACTION = 0.03          # joints within 3 % of the frame edge -> "move the camera back"
DARK_LUMA = 60.0

NoteFn = Callable[[dict, dict], Awaitable[tuple[dict, str]]]
PrefetchFn = Callable[[str], Awaitable[bool]]


class PatientNeverJoined(Exception):
    pass


class NoConsent(Exception):
    pass


@dataclass(frozen=True)
class FlowTiming:
    patient_join: float = 900.0
    consent_reask: float = 45.0
    consent_timeout: float = 300.0
    positioning_prompt: float = 8.0
    positioning_max: float = 90.0
    positioned_hold: float = 2.0          # frame time: joints visible continuously
    idle_after_rep: float = 20.0
    idle_no_rep: float = 30.0
    pain_reask: float = 30.0
    pain_timeout: float = 60.0
    rest: float = 30.0
    patient_return: float = 60.0
    cant_see_after: float = 2.0
    cant_see_every: float = 10.0
    ready_every: float = 5.0
    say_bye_max: float = 3.0
    outbox_drain: float = 5.0

    def set_cap(self, reps: int, min_spr: float) -> float:
        return reps * max(6.0, 3.0 * min_spr) + 30.0

    @classmethod
    def from_env(cls) -> "FlowTiming":
        import os
        return cls(patient_join=float(os.getenv("PATIENT_JOIN_TIMEOUT_S", "900")))


def envelope(type_: str, **fields) -> dict:
    return {"type": type_, "v": 1, "eventId": uuid.uuid4().hex, "ts": int(time.time() * 1000), **fields}


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


BANNERS = {"waiting": "Waiting for patient", "greeting": "Hello", "await_consent": "Waiting for consent",
           "positioning": "Positioning", "countdown": "Get ready", "set": "Exercise", "summary": "Set complete",
           "await_pain": "Pain check", "rest": "Rest", "done": "Session complete", "halted": "Stopped"}


class Flow:
    def __init__(self, agent, pose, cfg: SessionConfig, speaker, outbox, *, timing: FlowTiming = FlowTiming(),
                 note_fn: Optional[NoteFn] = None, prefetch: Optional[PrefetchFn] = None,
                 host: str = "local", pid: int = 0, attach_replay: Optional[Callable[[], Awaitable[None]]] = None,
                 bye_allowed: Optional[Callable[[], Awaitable[bool]]] = None,
                 clock: Callable[[], float] = time.monotonic):
        self.agent, self.pose, self.cfg, self.speaker, self.outbox = agent, pose, cfg, speaker, outbox
        self.t, self.note_fn, self.prefetch = timing, note_fn, prefetch
        self.host, self.pid, self.attach_replay = host, pid, attach_replay
        self.bye_allowed = bye_allowed                   # False when the supervisor stops us for a restart
        ex, rx = cfg.exercise, cfg.prescription
        self.ex, self.rx = ex, rx
        self.replay = cfg.mode == "replay"
        self.loop_time = clock                           # monotonic seconds (timeouts, idle detection)

        self.phase = "waiting"
        self.phases: list[str] = []                      # every phase entered (tests, diagnostics)
        self.set_index = 0
        self.next_set = cfg.startSetIndex
        self.completed_sets: set[int] = set()
        self.consent_given = cfg.consentGiven

        self.tracker = AngleTracker(tuple(ex.joints), ex.mode, rx.side)
        self.engine: Optional[RepEngine] = None
        self.set_open = False                            # a set started and its result is not posted yet
        self.last_rep_at: Optional[float] = None
        self.last_valid_at: Optional[float] = None
        self.last_cant_see: float = -1e9
        self._visible_since: Optional[float] = None
        self.diagnosis = "cant_see"

        self.patient_present = asyncio.Event()
        self.first_input = asyncio.Event()
        self._consent = asyncio.Event()
        self._positioned = asyncio.Event()
        self._rep_event = asyncio.Event()
        self._pain: dict[int, asyncio.Event] = {}
        self._interrupt = asyncio.Event()
        self._ended = asyncio.Event()
        self._patient_gone = asyncio.Event()
        self._main: Optional[asyncio.Task] = None
        self._halt_reason: Optional[str] = None
        self._halt_event_id: Optional[str] = None
        self._halt_detail: dict[str, Any] = {}
        self._cancel_reason: Optional[str] = None
        self._paused = False
        self._physio_announced = False
        self._tasks: set[asyncio.Task] = set()
        self.halt_listeners: list[Callable[[str], None]] = []
        self.pain_scores: dict[int, int] = {}
        self.last_summary: Optional[dict] = None
        self._ready = asyncio.Event()
        self._rest_deadline: Optional[float] = None

        self.overlay = OverlayState(banner=BANNERS["waiting"], reps_planned=rx.reps, set_index=0,
                                    sets_planned=rx.sets, target=rx.targetAngle, joints=tuple(ex.joints))
        pose.overlay = lambda: self.overlay
        pose.on_keypoints = self.on_keypoints

    # ================================================================ lifecycle
    async def run(self) -> int:
        await self.outbox.post({"type": "agent_joined", "pid": self.pid, "host": self.host})
        ready = asyncio.create_task(self._ready_loop())
        start = "greeting"
        try:
            while True:
                code = await self._run_main(start)
                if code is not None:
                    return await self._finish(code)
                while True:                              # the state task was interrupted
                    if self._halt_reason:
                        return await self._finish(await self._halt_sequence())
                    if self._cancel_reason:
                        await asyncio.shield(self._on_cancel())
                        return await self._finish(0)
                    if self._paused:
                        self._paused = False
                        self._interrupt.clear()
                        await self._wait_any(self.patient_present, self.t.patient_return)
                        if self._halt_reason or self._cancel_reason:
                            continue
                        if self.patient_present.is_set():
                            self.tracker.sides.reset()   # re-pick the side after a rejoin
                            start = "positioning" if self.consent_given else "consent"
                            break
                        await asyncio.shield(self._post_partial("disconnected"))
                        return await self._finish(4)
                    raise RuntimeError("state task cancelled without a reason")
        finally:
            ready.cancel()

    async def _run_main(self, start: str) -> Optional[int]:
        self._main = asyncio.create_task(self._run_states(start))
        try:
            return await self._main
        except asyncio.CancelledError:
            if self._halt_reason or self._cancel_reason or self._paused:
                return None
            raise

    def halt(self, reason: str, event_id: str, *, score: Optional[int] = None, symptom: Optional[str] = None) -> None:
        """Safety trigger from any state: stop | pain | symptom. Synchronous: takes effect this tick."""
        if self._halt_reason is not None or self.phase == "done":
            return
        self._halt_reason, self._halt_event_id = reason, event_id
        self._halt_detail = {"score": score, "symptom": symptom}
        log.warning("SAFETY HALT: %s (event %s)", reason, event_id)
        for listener in list(self.halt_listeners):
            try:
                listener(reason)
            except Exception as e:  # noqa: BLE001 - a listener must never delay or block the halt
                log.warning("halt listener failed: %s", e)
        self._interrupt.set()
        if self._main and not self._main.done():
            self._main.cancel()

    def cancel(self, reason: str) -> None:
        """Call ended / SIGTERM."""
        self._ended.set()
        if self._cancel_reason is None and self._halt_reason is None:
            self._cancel_reason = reason
            self._interrupt.set()
            if self._main and not self._main.done():
                self._main.cancel()

    async def _finish(self, code: int) -> int:
        await self.outbox.drain(self.t.outbox_drain)
        log.info("flow finished with exit code %d (phases: %s)", code, " > ".join(self.phases))
        return code

    # ================================================================ inputs
    def on_input(self) -> None:
        self.first_input.set()

    def on_consent(self) -> None:
        self._consent.set()

    async def on_pain(self, score: int, set_index: int, event_id: str) -> None:
        await self.outbox.post({"type": "pain_recorded", "setIndex": set_index, "score": score,
                                "clientEventId": event_id})
        self.pain_scores[set_index] = score
        ev = self._pain.setdefault(set_index, asyncio.Event())
        already = ev.is_set()
        ev.set()
        if score < 7 and self.phase == "await_pain" and not already:      # voice + button: thank once
            self.speaker.say_ids(["pain.thanks"], "prompt")

    # ---------------------------------------------------------------- live coach reads
    @property
    def halted(self) -> bool:
        return self._halt_reason is not None

    @property
    def paused(self) -> bool:
        return self._paused or not self.patient_present.is_set()

    def ready_to_continue(self) -> bool:
        """The patient said they are ready: end the current rest early. False outside rest."""
        if self.phase != "rest" or self.halted:
            return False
        self._ready.set()
        return True

    def progress(self) -> dict:
        """Numbers the live coach may quote: Flow and RepEngine state only, never estimates."""
        eng = self.engine
        reps = list(eng.reps) if eng is not None else []
        in_set = self.phase in ("countdown", "set", "summary", "await_pain", "rest")
        value = self.overlay.value
        return {
            "phase": self.phase,
            "set": self.set_index,
            "setsPlanned": self.rx.sets,
            "repsDoneThisSet": len(reps) if in_set else 0,
            "repsPlanned": self.rx.reps,
            "targetAngle": self.rx.targetAngle,
            "lastRepPeak": round(reps[-1].peak, 1) if reps and in_set else None,
            "currentAngle": round(value, 1) if value is not None else None,
            "completedSets": sorted(self.completed_sets),
            "lastSet": dict(self.last_summary) if self.last_summary else None,
            "painScores": {str(k): v for k, v in sorted(self.pain_scores.items())},
            "halted": self.halted,
        }

    def on_patient_joined(self) -> None:
        self.patient_present.set()
        self._patient_gone.clear()

    def on_patient_left(self) -> None:
        if self.replay:
            return
        self.patient_present.clear()
        self._patient_gone.set()
        if self.phase in ("waiting", "done", "halted") or self._halt_reason or self._cancel_reason or self._paused:
            return
        log.info("patient left during %s: pausing", self.phase)
        self._paused = True
        self._interrupt.set()
        if self._main and not self._main.done():
            self._main.cancel()

    def on_physio_joined(self) -> None:
        if not self._physio_announced and self.phase not in ("waiting", "done", "halted"):
            self._physio_announced = True
            self.speaker.say_ids(["physio.joined"], "prompt")

    async def on_keypoints(self, t: float, kp: Optional[Keypoints], meta: FrameMeta) -> None:
        now = self.loop_time()
        if self.phase == "positioning":
            self._observe_positioning(t, kp, meta)
        sample = self.tracker.update(t, kp) if kp else None
        if sample is None:
            return
        self.last_valid_at = now
        if self.phase != "set" or self.engine is None:
            self.overlay = replace(self.overlay, value=sample.value, raw_angle=sample.raw_angle, side=sample.side)
            return
        ev = self.engine.update(sample.t, sample.value)
        peak = self.engine.peak if self.engine.state == "moving" else self.overlay.rep_peak
        self.overlay = replace(self.overlay, value=sample.value, raw_angle=sample.raw_angle, side=sample.side,
                               rep_peak=peak, reps=len(self.engine.reps))
        if isinstance(ev, Rep):
            self.last_rep_at = now
            self._fire(self.send("pc.rep", setIndex=self.set_index, n=ev.n, peak=round(ev.peak, 1),
                                 seconds=round(ev.seconds, 2), tooFast=ev.too_fast, target=self.rx.targetAngle,
                                 repsPlanned=self.rx.reps))
            self.speaker.say_ids(live_cue_ids(ev, self.rx.targetAngle, self.ex.mode), "count")
            self._rep_event.set()
        elif isinstance(ev, RepRejected):
            log.info("rep rejected (%s): peak %.1f, %.2f s", ev.reason, ev.peak, ev.seconds)

    def _observe_positioning(self, t: float, kp: Optional[Keypoints], meta: FrameMeta) -> None:
        visible = None
        for side in ("left", "right"):
            pts = [(kp or {}).get(f"{side}_{j}") for j in self.ex.joints]
            if all(p is not None and p[2] >= CONF_MIN for p in pts):
                visible = pts
                break
        if visible is None:
            self._visible_since = None
            self.diagnosis = "light" if meta.luma < DARK_LUMA else "cant_see"
            return
        mx, my = EDGE_FRACTION * meta.width, EDGE_FRACTION * meta.height
        near_edge = any(x < mx or x > meta.width - mx or y < my or y > meta.height - my for x, y, _ in visible)
        self.diagnosis = "step_back" if near_edge else ("light" if meta.luma < DARK_LUMA else "ok")
        if self._visible_since is None:
            self._visible_since = t
        elif t - self._visible_since >= self.t.positioned_hold:
            self._positioned.set()

    # ================================================================ states
    async def _run_states(self, start: str) -> int:
        try:
            if start == "greeting":
                await self._wait_patient()
                await self._greeting()
                start = "positioning" if self.consent_given else "consent"
            if start == "consent":
                await self._await_consent()
            await self._positioning()
            while self.next_set <= self.rx.sets:
                idx = self.next_set
                if idx in self.completed_sets:           # resumed after this set's result was posted
                    self.next_set += 1
                    continue
                await self._countdown(idx)
                reason = await self._run_set()
                await self._summary(reason)
                await self._await_pain(idx)
                self.next_set += 1
                if idx < self.rx.sets:
                    await self._rest()
            await self._done()
            return 0
        except PatientNeverJoined:
            return 3
        except NoConsent:
            return 5

    async def _enter(self, phase: str, reason: Optional[str] = None) -> None:
        self.phase = phase
        self.phases.append(phase)
        self.overlay = replace(self.overlay, banner=BANNERS.get(phase, phase), set_index=self.set_index)
        fields = {"phase": phase, "setIndex": self.set_index, "setsPlanned": self.rx.sets}
        if reason:
            fields["reason"] = reason
        await self.send("pc.state", **fields)                    # awaited: ordering matters

    async def _wait_patient(self) -> None:
        if self.replay:
            if self.attach_replay:
                await self.attach_replay()
            self.patient_present.set()
            return
        if not await self._wait_any(self.patient_present, self.t.patient_join):
            raise PatientNeverJoined()

    async def _greeting(self) -> None:
        await self._enter("greeting")
        self.speaker.say_ids(["intro.greet"] if self.replay else ["intro.greet", "intro.watch"], "prompt")
        if self.consent_given:
            self.speaker.say_ids(["resume"], "prompt")
        await self.speaker.wait_idle()

    async def _await_consent(self) -> None:
        await self._enter("await_consent")
        self.pose.enabled = False                                # NO pose inference before consent
        if not self.replay and not self._consent.is_set():     # consent may already have arrived
            self.speaker.say_ids(["consent.ask"], "prompt")
            waited = 0.0
            while not self._consent.is_set():
                step = min(self.t.consent_reask, self.t.consent_timeout - waited)
                if step <= 0:
                    raise NoConsent()
                if not await self._wait_any(self._consent, step):
                    waited += step
                    if waited < self.t.consent_timeout:
                        self.speaker.say_ids(["consent.ask"], "prompt")
        self.consent_given = True
        self.speaker.say_ids(["consent.thanks"], "prompt")
        await self.outbox.post({"type": "consent_given", "at": iso_now()})

    async def _positioning(self) -> None:
        await self._enter("positioning")
        self.pose.enabled = True
        self._positioned.clear()
        self._visible_since = None
        limb = "pos.leg_in_frame" if "knee" in self.ex.joints else "pos.arm_in_frame"
        self.speaker.say_ids(["pos.front" if self.ex.cameraView == "front" else "pos.side", limb], "prompt")
        waited = 0.0
        while not self._positioned.is_set() and waited < self.t.positioning_max:
            step = min(self.t.positioning_prompt, self.t.positioning_max - waited)
            if not await self._wait_any(self._positioned, step):
                waited += step
                if waited < self.t.positioning_max:
                    prompt = {"step_back": "pos.step_back", "light": "pos.light"}.get(self.diagnosis, "pos.cant_see")
                    self.speaker.say_ids([prompt], "prompt")
        if self._positioned.is_set():
            self.speaker.say_ids(["pos.ok"], "prompt")
        else:
            log.info("positioning timed out after %.0f s: continuing (the physio can intervene)", waited)
        self.tracker.sides.force_lock()                          # the side never changes during a set

    async def _countdown(self, idx: int) -> None:
        self.set_index = idx
        await self._enter("countdown")
        self.overlay = replace(self.overlay, reps=0, rep_peak=None)
        self.speaker.say_ids(["cd.ready", "count.03", "count.02", "count.01", "cd.start"], "prompt")
        await self.speaker.wait_idle()
        self.tracker.ema.reset()                                 # NEVER the SideSelector here
        self.engine = RepEngine(self.ex.rest, self.ex.start, self.ex.minPeak, self.rx.minSecondsPerRep)
        self.set_open = True
        self.last_rep_at = None

    async def _run_set(self) -> str:
        await self._enter("set")
        start = self.loop_time()
        cap = start + self.t.set_cap(self.rx.reps, self.rx.minSecondsPerRep)
        self.last_valid_at = start
        while True:
            if self.engine and len(self.engine.reps) >= self.rx.reps:
                return "completed"
            now = self.loop_time()
            idle_deadline = (self.last_rep_at + self.t.idle_after_rep) if self.last_rep_at else start + self.t.idle_no_rep
            deadline = min(idle_deadline, cap)
            if now >= deadline:
                return "idle"
            self._rep_event.clear()
            await self._wait_any(self._rep_event, min(deadline - now, 1.0))
            self._maybe_cant_see()

    def _maybe_cant_see(self) -> None:
        now = self.loop_time()
        if (self.last_valid_at is not None and now - self.last_valid_at > self.t.cant_see_after
                and now - self.last_cant_see >= self.t.cant_see_every):
            self.last_cant_see = now
            self.speaker.say_ids(["pos.cant_see"], "prompt")

    async def _summary(self, stop_reason: str) -> None:
        await self._enter("summary")
        m = set_metrics(self.engine.reps if self.engine else [], self.rx.reps, self.rx.targetAngle)
        rule_ids = rule_note_ids(m, self.ex.mode)
        rule = render_note(rule_ids)
        self.speaker.say_ids(["set.done"], "prompt")
        note, source = rule, "rules"
        if self.note_fn:
            note, source = await self.note_fn(note_metrics(m, self.ex.id, self.ex.mode, self.rx.minSecondsPerRep), rule)
            if source == "llm" and not (self.prefetch and await self.prefetch(note["ml"])):
                note, source = rule, "rules"                     # captions, audio and DB always agree
        self.last_summary = {"set": self.set_index, "repsDone": m.reps_done, "repsPlanned": m.reps_planned,
                             "avgPeak": m.avg_peak, "bestPeak": m.best_peak, "fastReps": m.fast_reps,
                             "score": m.score, "target": self.rx.targetAngle}
        if source == "llm":
            self.speaker.say_text(note["ml"], note["en"], "note")
        else:
            self.speaker.say_ids(rule_ids, "note")
        await self.send("pc.set_summary", setIndex=self.set_index, repsDone=m.reps_done, repsPlanned=m.reps_planned,
                        avgPeak=m.avg_peak, bestPeak=m.best_peak, target=self.rx.targetAngle, fastReps=m.fast_reps,
                        score=m.score, feedbackSource=source)
        await asyncio.shield(self._post_set_result(m, note, source, stop_reason))
        await self.speaker.wait_idle()

    async def _post_set_result(self, m: SetMetrics, note: dict, source: str, stop_reason: str) -> None:
        if not self.set_open:
            return
        self.set_open = False
        self.completed_sets.add(self.set_index)
        await self.outbox.post({
            "type": "set_result", "setIndex": self.set_index, "repsDone": m.reps_done, "repsPlanned": m.reps_planned,
            "targetAngle": self.rx.targetAngle, "side": self.tracker.sides.locked, "avgPeak": m.avg_peak,
            "bestPeak": m.best_peak, "lowestPeak": m.lowest_peak, "avgRepSeconds": m.avg_rep_seconds,
            "fastReps": m.fast_reps, "score": m.score, "perRep": m.per_rep[:60], "feedbackMl": note["ml"],
            "feedbackEn": note["en"], "feedbackSource": source, "stopReason": stop_reason})

    async def _post_partial(self, stop_reason: str) -> None:
        """A running set ends early (halt, disconnect): post what was done, with the rule note."""
        if not self.set_open:
            return
        if self.engine:
            self.engine.abort_in_progress()
        m = set_metrics(self.engine.reps if self.engine else [], self.rx.reps, self.rx.targetAngle)
        await self._post_set_result(m, render_note(rule_note_ids(m, self.ex.mode)), "rules", stop_reason)

    async def _await_pain(self, idx: int) -> None:
        await self._enter("await_pain")
        ev = self._pain.setdefault(idx, asyncio.Event())
        if ev.is_set():
            return
        self.speaker.say_ids(["pain.ask"], "prompt")
        await self.send("pc.request_pain", setIndex=idx)
        if not await self._wait_any(ev, self.t.pain_reask):
            self.speaker.say_ids(["pain.ask"], "prompt")
            await self.send("pc.request_pain", setIndex=idx)
            if not await self._wait_any(ev, self.t.pain_timeout - self.t.pain_reask):
                log.info("no pain score for set %d: continuing with pain = null", idx)

    async def _rest(self) -> None:
        self._ready.clear()
        await self._enter("rest")
        self.speaker.say_ids(["set.rest"], "prompt")
        self._rest_deadline = self.loop_time() + self.t.rest
        try:                                                     # interruptible: ready_to_continue / halt
            while not self._ready.is_set():
                left = self._rest_deadline - self.loop_time()
                if left <= 0:
                    break
                await self._wait_any(self._ready, left)
        finally:
            self._rest_deadline = None

    async def _done(self) -> None:
        await self._enter("done")
        self.speaker.say_ids(["bye"], "prompt")
        await self._bounded(self.speaker.wait_idle(), self.t.say_bye_max)

    # ================================================================ halt / cancel
    async def _halt_sequence(self) -> int:
        reason, event_id, d = self._halt_reason, self._halt_event_id, self._halt_detail
        self.phase = "halted"
        self.phases.append("halted")
        if self.engine:
            self.engine.abort_in_progress()                      # a half-done rep is never counted
        alert = {"reason": reason}
        callback: dict[str, Any] = {"type": "safety_alert", "kind": reason, "clientEventId": event_id}
        if d.get("score") is not None:
            alert["score"] = callback["painScore"] = d["score"]
        if d.get("symptom"):
            alert["symptom"] = callback["symptom"] = d["symptom"]
        if self.set_index:
            alert["setIndex"] = callback["setIndex"] = self.set_index
        await self.send("pc.safety_alert", **alert)              # awaited: both UIs show the red banner
        await asyncio.shield(self.outbox.post(callback))
        await asyncio.shield(self._post_partial(STOP_REASON[reason]))
        self.overlay = replace(self.overlay, halted=True, banner=BANNERS["halted"])
        await self.speaker.safety()                              # caption now; audio after the physio gate
        await self.send("pc.state", phase="halted", setIndex=self.set_index, setsPlanned=self.rx.sets, reason=reason)
        # Stay in the call, silent, no new set, until the physio ends it or the patient leaves.
        self._interrupt.clear()
        await self._wait_any(self._patient_gone, None, also=self._ended)
        return 4 if self._patient_gone.is_set() and not self._ended.is_set() else 0

    async def _on_cancel(self) -> None:
        await self._post_partial("disconnected")
        if self._cancel_reason == "sigterm" and (self.bye_allowed is None or await self.bye_allowed()):
            self.speaker.say_ids(["bye"], "prompt")
            await self._bounded(self.speaker.wait_idle(), self.t.say_bye_max)

    # ================================================================ helpers
    async def send(self, type_: str, **fields) -> None:
        try:
            await self.agent.send_custom_event(envelope(type_, **fields))
        except Exception as e:  # noqa: BLE001 - client events are best effort; the outbox carries the record
            log.warning("send_custom_event %s failed: %s", type_, e)

    async def _ready_loop(self) -> None:
        """pc.ready every 5 s until the first client input arrives (handshake, §7.7)."""
        while not self.first_input.is_set():
            await self.send("pc.ready", agentVersion=__version__)
            try:
                await asyncio.wait_for(self.first_input.wait(), self.t.ready_every)
            except asyncio.TimeoutError:
                pass

    async def _wait_any(self, ev: asyncio.Event, timeout: Optional[float], also: Optional[asyncio.Event] = None) -> bool:
        """Wait for `ev` (or `also`) up to `timeout`. Returns ev.is_set()."""
        if ev.is_set():
            return True
        waiters = [asyncio.create_task(ev.wait())]
        if also is not None:
            waiters.append(asyncio.create_task(also.wait()))
        try:
            await asyncio.wait(waiters, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for w in waiters:
                w.cancel()
        return ev.is_set()

    async def _bounded(self, coro, timeout: float) -> None:
        try:
            await asyncio.wait_for(coro, timeout)
        except asyncio.TimeoutError:
            pass

    def _fire(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
