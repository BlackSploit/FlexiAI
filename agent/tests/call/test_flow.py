"""Call-flow state machine (§8.15, §12.1): fake agent/pose/outbox, the real Speaker, shrunken timeouts."""

import asyncio
import time
from types import SimpleNamespace

import pytest

from physiocoach.call.flow import Flow, FlowTiming
from physiocoach.call.inputs import InputRouter
from physiocoach.call.speaker import Speaker
from physiocoach.core import phrases
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

    async def say(self, text, interrupt=False):
        self.said.append(text)

    async def send_custom_event(self, payload):
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


class Rig:
    def __init__(self, cfg=None, timing=FAST, peak=65.0, clip_s=0.0, **flow_kw):
        self.agent, self.outbox, self.pose = FakeAgent(), FakeOutbox(), FakePose()
        self.interrupts = 0

        async def interrupt():
            self.interrupts += 1

        self.speaker = Speaker(self.agent, lambda t: clip_s, interrupt_audio=interrupt)
        self.cfg = cfg or config()
        self.flow = Flow(self.agent, self.pose, self.cfg, self.speaker, self.outbox, timing=timing, **flow_kw)
        self.router = InputRouter(self.flow, "pat", "phy", "agent")
        self.peak, self.feeding = peak, True
        self.tasks = [asyncio.create_task(self.speaker.run()), asyncio.create_task(self._feed())]
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


# ------------------------------------------------------------------ happy path and gates

async def test_happy_path_phases_callbacks_and_events(rig):
    r = rig()
    await to_set(r)
    await r.until(lambda: r.flow.phase == "await_pain")
    await r.send("pat", "pc.pain_score", score=2, setIndex=1)
    assert await asyncio.wait_for(r.run, 5) == 0
    assert r.flow.phases == ["greeting", "await_consent", "positioning", "countdown", "set", "summary", "await_pain", "done"]
    assert [e["type"] for e in r.outbox.posted][:2] == ["agent_joined", "consent_given"]
    sr = r.outbox.of("set_result")[0]
    assert (sr["repsDone"], sr["stopReason"], sr["feedbackSource"], sr["side"]) == (10, "completed", "rules", "left")
    assert len(sr["perRep"]) == 10 and r.outbox.of("pain_recorded")[0]["score"] == 2
    assert [e["phase"] for e in r.agent.types("pc.state")] == r.flow.phases
    assert len(r.agent.types("pc.rep")) == 10 and r.agent.types("pc.set_summary")[0]["repsDone"] == 10
    assert r.agent.said[-1] == phrases.get("bye").ml


async def test_consent_gate_no_pose_frames_before_consent(rig):
    r = rig()
    r.flow.on_patient_joined()
    await r.until(lambda: r.flow.phase == "await_consent")
    await asyncio.sleep(0.05)
    assert not r.pose.enabled and r.pose.frames_while_disabled > 0
    assert r.flow.tracker.last_ok_t is None                  # no keypoints were ever analysed
    r.feeding = False                                        # hold positioning so the test can observe it
    await r.send("pat", "pc.consent", agreed=True)
    await r.until(lambda: r.flow.phase == "positioning")
    assert r.pose.enabled


async def test_consent_given_on_restart_skips_await_consent(rig):
    r = rig(cfg=config(consentGiven=True, startSetIndex=1))
    r.flow.on_patient_joined()
    await r.until(lambda: r.flow.phase == "set")
    assert "await_consent" not in r.flow.phases
    assert phrases.get("resume").ml in r.agent.said


async def test_patient_never_joins_exits_3(rig):
    r = rig(timing=FlowTiming(**{**FAST.__dict__, "patient_join": 0.1}))
    assert await asyncio.wait_for(r.run, 3) == 3


async def test_no_consent_exits_5(rig):
    r = rig()
    r.flow.on_patient_joined()
    assert await asyncio.wait_for(r.run, 5) == 5
    assert r.agent.said.count(phrases.get("consent.ask").ml) >= 2       # re-asked


# ------------------------------------------------------------------ safety

@pytest.mark.parametrize("phase", ["positioning", "countdown", "set"])
async def test_stop_halts_in_any_phase_within_one_tick(rig, phase):
    r = rig(clip_s=0.3 if phase == "countdown" else 0.0)     # real clip durations make the countdown last
    r.flow.on_patient_joined()
    await r.until(lambda: r.flow.phase == "await_consent")
    if phase == "positioning":
        r.feeding = False                                    # no frames: positioning waits
    await r.send("pat", "pc.consent", agreed=True)
    await r.until(lambda: r.flow.phase == phase)
    t0 = time.monotonic()
    await r.send("pat", "pc.stop", reason="button")
    await r.until(lambda: r.agent.types("pc.safety_alert"))
    assert time.monotonic() - t0 < 0.05
    alert = r.outbox.of("safety_alert")[0]
    assert alert["kind"] == "stop" and alert["clientEventId"].startswith("evt")
    if phase == "set":
        assert r.outbox.of("set_result")[0]["stopReason"] == "stop_pressed"
    await r.until(lambda: phrases.get("safety.stop").ml in r.agent.said)
    assert r.flow.phase == "halted" and not r.run.done()     # stays in the call, silent


async def test_pain_7_in_await_pain_halts_and_posts_both_records(rig):
    r = rig()
    await to_set(r)
    await r.until(lambda: r.flow.phase == "await_pain")
    await r.send("pat", "pc.pain_score", score=8, setIndex=1)
    await r.until(lambda: r.outbox.of("safety_alert"))
    alert = r.outbox.of("safety_alert")[0]
    assert (alert["kind"], alert["painScore"]) == ("pain", 8)
    assert r.outbox.of("pain_recorded")[0]["clientEventId"] == alert["clientEventId"]   # one row on the web
    assert r.agent.types("pc.safety_alert")[0]["score"] == 8


async def test_symptom_halts(rig):
    r = rig()
    await to_set(r)
    await r.send("pat", "pc.symptom", kind="dizziness")
    await r.until(lambda: r.outbox.of("safety_alert"))
    assert r.outbox.of("safety_alert")[0]["symptom"] == "dizziness"
    assert r.outbox.of("set_result")[0]["stopReason"] == "symptom"


async def test_physio_can_stop_but_not_consent(rig):
    r = rig()
    r.flow.on_patient_joined()
    await r.until(lambda: r.flow.phase == "await_consent")
    await r.send("phy", "pc.consent", agreed=True)           # only the patient can consent
    await asyncio.sleep(0.05)
    assert r.flow.phase == "await_consent"
    await r.send("phy", "pc.stop", reason="button")
    await r.until(lambda: r.flow.phase == "halted")


async def test_stop_during_slow_llm_note_halts_within_50ms(rig):
    started = asyncio.Event()

    async def slow_note(metrics, rule):
        started.set()
        await asyncio.sleep(3)
        return rule, "llm"

    r = rig(note_fn=slow_note)
    await to_set(r)
    await asyncio.wait_for(started.wait(), 5)
    t0 = time.monotonic()
    await r.send("pat", "pc.stop", reason="button")
    await r.until(lambda: r.flow.phase == "halted")
    assert time.monotonic() - t0 < 0.05


async def test_stop_during_rest_halts_within_50ms(rig):
    r = rig(cfg=config(prescription={"side": "auto", "targetAngle": 60, "reps": 10, "sets": 2, "minSecondsPerRep": 2}),
            timing=FlowTiming(**{**FAST.__dict__, "rest": 30.0}))
    await to_set(r)
    await r.until(lambda: r.flow.phase == "await_pain")
    await r.send("pat", "pc.pain_score", score=1, setIndex=1)
    await r.until(lambda: r.flow.phase == "rest")
    t0 = time.monotonic()
    await r.send("pat", "pc.stop", reason="button")
    await r.until(lambda: r.flow.phase == "halted")
    assert time.monotonic() - t0 < 0.05


async def test_stop_while_physio_speaks_alerts_now_audio_waits_for_the_gate(rig):
    r = rig()
    await to_set(r)
    await r.speaker.physio_started()
    t0 = time.monotonic()
    await r.send("pat", "pc.stop", reason="button")
    await r.until(lambda: r.outbox.of("safety_alert") and r.agent.types("pc.safety_alert"))
    assert time.monotonic() - t0 < 0.05                         # halt, event and callback: immediate
    assert any(e["type"] == "pc.caption" and e["kind"] == "safety" for e in r.agent.events)
    await asyncio.sleep(0.05)
    assert phrases.get("safety.stop").ml not in r.agent.said    # only the audio waits
    r.speaker.physio_stopped()
    await r.until(lambda: phrases.get("safety.stop").ml in r.agent.said)


async def test_halted_session_ends_cleanly_when_the_physio_ends_it(rig):
    r = rig()
    await to_set(r)
    await r.send("pat", "pc.stop", reason="button")
    await r.until(lambda: r.flow.phase == "halted")
    r.flow.cancel("call_ended")
    assert await asyncio.wait_for(r.run, 2) == 0


# ------------------------------------------------------------------ lifecycle

async def test_call_ended_mid_set_posts_partial_and_exits_0(rig):
    r = rig()
    await to_set(r)
    r.flow.cancel("call_ended")
    assert await asyncio.wait_for(r.run, 2) == 0
    assert r.outbox.of("set_result")[0]["stopReason"] == "disconnected"
    assert phrases.get("bye").ml not in r.agent.said             # the call is gone: no goodbye


async def test_sigterm_for_restart_skips_bye(rig):
    async def restart():
        return False

    r = rig(bye_allowed=restart)
    await to_set(r)
    r.flow.cancel("sigterm")
    assert await asyncio.wait_for(r.run, 2) == 0
    assert phrases.get("bye").ml not in r.agent.said


async def test_patient_leaves_and_returns_resumes_at_positioning(rig):
    r = rig()
    await to_set(r)
    r.flow.on_patient_left()
    await asyncio.sleep(0.05)
    r.flow.on_patient_joined()
    await r.until(lambda: r.flow.phases.count("positioning") == 2)
    assert r.flow.phases.count("await_consent") == 1             # consent is kept
    await r.until(lambda: r.flow.phases.count("set") == 2)
    assert not r.outbox.of("set_result")                          # the interrupted set restarts, nothing posted


async def test_patient_gone_too_long_exits_4_with_partial_set(rig):
    r = rig()
    await to_set(r)
    r.flow.on_patient_left()
    assert await asyncio.wait_for(r.run, 3) == 4
    assert r.outbox.of("set_result")[0]["stopReason"] == "disconnected"


async def test_physio_join_is_announced_once(rig):
    r = rig()
    await to_set(r)
    r.flow.on_physio_joined()
    r.flow.on_physio_joined()
    await r.until(lambda: phrases.get("physio.joined").ml in r.agent.said)
    await asyncio.sleep(0.02)
    assert r.agent.said.count(phrases.get("physio.joined").ml) == 1


@pytest.mark.parametrize("lang", ["ml", "en"])
async def test_audio_is_malayalam_for_every_patient_language(rig, lang):
    r = rig(cfg=config(patient={"id": "pat", "name": "P", "lang": lang}))
    r.flow.on_patient_joined()
    await r.until(lambda: r.flow.phase == "await_consent")
    catalogue_ml = {p.ml for p in phrases.expand_all()}
    assert r.agent.said and all(s in catalogue_ml for s in r.agent.said)     # DEV-16


# ------------------------------------------------------------------ notes

async def test_llm_note_with_failed_tts_prefetch_falls_back_to_rules_everywhere(rig):
    async def llm_note(metrics, rule):
        return {"ml": "എൽഎൽഎം കുറിപ്പ്. രണ്ടാം വാക്യം.", "en": "LLM note. Second sentence."}, "llm"

    async def prefetch_fails(text):
        return False

    r = rig(note_fn=llm_note, prefetch=prefetch_fails)
    await to_set(r)
    await r.until(lambda: r.outbox.of("set_result"))
    sr = r.outbox.of("set_result")[0]
    assert sr["feedbackSource"] == "rules" and sr["feedbackEn"].startswith("Well done")
    assert r.agent.types("pc.set_summary")[0]["feedbackSource"] == "rules"
    assert "എൽഎൽഎം കുറിപ്പ്. രണ്ടാം വാക്യം." not in r.agent.said


async def test_llm_note_with_prefetched_audio_is_spoken_whole(rig):
    async def llm_note(metrics, rule):
        return {"ml": "എൽഎൽഎം കുറിപ്പ്. രണ്ടാം വാക്യം.", "en": "LLM note. Second sentence."}, "llm"

    async def prefetch_ok(text):
        return True

    r = rig(note_fn=llm_note, prefetch=prefetch_ok)
    await to_set(r)
    await r.until(lambda: r.outbox.of("set_result"))
    assert r.outbox.of("set_result")[0]["feedbackSource"] == "llm"
    await r.until(lambda: "എൽഎൽഎം കുറിപ്പ്. രണ്ടാം വാക്യം." in r.agent.said)


# ------------------------------------------------------------------ inputs

async def test_duplicate_event_id_is_processed_once_and_wrong_sender_ignored(rig):
    r = rig()
    r.flow.on_patient_joined()
    await r.until(lambda: r.flow.phase == "await_consent")
    ev = {"type": "pc.pain_score", "v": 1, "eventId": "dup00001", "ts": 1, "score": 3, "setIndex": 1}
    await r.router.handle("pat", ev)
    await r.router.handle("pat", ev)                              # the backup copy of the same event
    await r.router.handle("stranger", {**ev, "eventId": "dup00002"})
    await r.router.handle("agent", {**ev, "eventId": "dup00003"})  # our own echo
    await r.router.handle("pat", {"type": "pc.pain_score", "v": 1, "eventId": "bad", "ts": 1, "score": 11, "setIndex": 1})
    assert len(r.outbox.of("pain_recorded")) == 1


async def test_replay_mode_attaches_the_clip_and_auto_consents(rig):
    attached = SimpleNamespace(done=False)

    async def attach():
        attached.done = True

    r = rig(cfg=config(mode="replay", clip="knee_demo.mp4"), attach_replay=attach)
    await r.until(lambda: r.flow.phase == "set")
    assert attached.done and "await_consent" in r.flow.phases and r.outbox.of("consent_given")
    assert phrases.get("consent.ask").ml not in r.agent.said
