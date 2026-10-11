"""Live Coach logic (WP1a cases a-s): the real Flow/Speaker/InputRouter with a FakePort instead of OpenAI,
plus unit tests of the gates with stub flow/speaker objects and a manual clock."""

import asyncio
import time
from types import SimpleNamespace

import pytest
from conftest import FAST, FakePort, Rig, config, to_set  # noqa: F401

from physiocoach.call.flow import FlowTiming
from physiocoach.call.live_coach import (
    HOLD_MAX_S, CoachFacade, LiveCoach, LiveCoachSettings, ResponseScheduler, public_result,
)
from physiocoach.call.speaker import Speaker
from physiocoach.core import phrases
from physiocoach.core.contracts import agent_event_adapter

TWO_SETS = {"side": "auto", "targetAngle": 60, "reps": 10, "sets": 2, "minSecondsPerRep": 2}
SLOW_REST = FlowTiming(**{**FAST.__dict__, "rest": 30.0})
ON = LiveCoachSettings(enabled=True, reason="test")


# ------------------------------------------------------------------ unit helpers

class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class StubFlow:
    def __init__(self):
        self.phase, self.halted, self.paused, self.consent_given = "positioning", False, False, True
        self.set_index = 1
        self.rx = SimpleNamespace(sets=2)
        self.halt_listeners = []


class StubSpeaker:
    def __init__(self):
        self.busy = False
        self.physio_speaking = False

    async def wait_idle(self):
        return None


def unit_coach(settings=ON, up=True):
    clock, sent = Clock(), []

    async def send_custom(p):
        sent.append(p)

    coach = LiveCoach(config(), settings, send_custom, clock=clock)
    flow, speaker, port = StubFlow(), StubSpeaker(), FakePort()
    port.is_up = up
    coach.bind(flow, SimpleNamespace(), speaker)
    coach.attach_port(port)
    return SimpleNamespace(coach=coach, flow=flow, speaker=speaker, port=port, clock=clock, custom=sent)


async def settle():
    for _ in range(5):
        await asyncio.sleep(0)


async def live_rig(rig, **kw):
    r = rig(live=True, **kw)
    return r


# ------------------------------------------------------------------ (a)-(h): tools through the real Flow

async def test_a_pain_8_by_voice_halts_exactly_like_the_button(rig):
    r = await live_rig(rig)
    await to_set(r)
    res = await r.coach.tools.report_pain(8)
    assert res["recorded"] and res["halted"] and public_result(res)[1] is False     # no spoken reply
    await r.until(lambda: r.outbox.of("safety_alert") and r.agent.types("pc.safety_alert"))
    alert = r.outbox.of("safety_alert")[0]
    assert (alert["kind"], alert["painScore"], alert["setIndex"]) == ("pain", 8, 1)
    assert r.outbox.of("pain_recorded")[0]["clientEventId"] == alert["clientEventId"]
    assert r.agent.types("pc.safety_alert")[0]["score"] == 8
    await r.until(lambda: phrases.get("safety.stop").ml in r.agent.said)


async def test_b_pain_3_in_await_pain_thanks_then_rest_without_response_create(rig):
    r = await live_rig(rig, cfg=config(prescription=TWO_SETS), timing=SLOW_REST)
    await to_set(r)
    await r.until(lambda: r.flow.phase == "await_pain")
    res = await r.coach.tools.report_pain("3")                  # raw model arguments are coerced
    public, reply = public_result(res)
    assert public == {"recorded": True, "halted": False} and reply is False
    r.coach.send_tool_output("call_1", "{}", reply)
    await r.until(lambda: r.flow.phase == "rest")
    assert phrases.get("pain.thanks").ml in r.agent.said
    assert r.outbox.of("pain_recorded")[0]["setIndex"] == 1
    assert not r.port.types("response.create")                  # the clip acknowledges, no model turn
    assert r.port.types("conversation.item.create")
    # H11: one proactive rest cue follows once the set.rest clip is done: a [COACH CUE] item, then one response.
    await r.until(lambda: r.port.types("response.create"), timeout=3)
    cue = [e for e in r.port.events if e.get("type") == "conversation.item.create"
           and "[COACH CUE]" in str(e)]
    assert len(cue) == 1 and r.port.events.index(cue[0]) < r.port.events.index(r.port.types("response.create")[0])
    assert len(r.port.types("response.create")) == 1


async def test_c_pain_3_in_positioning_is_rejected_and_set_1_is_still_asked(rig):
    r = await live_rig(rig)
    r.flow.on_patient_joined()
    await r.until(lambda: r.flow.phase == "await_consent")
    r.feeding = False
    await r.send("pat", "pc.consent", agreed=True)
    await r.until(lambda: r.flow.phase == "positioning")
    res = await r.coach.tools.report_pain(3)
    assert res == {"accepted": False, "reason": "not asked"}
    assert not (1 in r.flow._pain and r.flow._pain[1].is_set())
    assert not r.outbox.of("pain_recorded")


async def test_d_two_voice_symptoms_and_a_button_give_one_alert(rig):
    r = await live_rig(rig)
    await to_set(r)
    assert (await r.coach.tools.report_symptom("dizziness"))["halted"]
    await r.coach.tools.report_symptom("DIZZINESS")
    await r.send("pat", "pc.symptom", kind="dizziness")
    await r.until(lambda: r.outbox.of("safety_alert") and r.agent.types("pc.safety_alert"))
    await asyncio.sleep(0.05)
    assert len(r.outbox.of("safety_alert")) == 1 and len(r.agent.types("pc.safety_alert")) == 1
    assert r.outbox.of("safety_alert")[0]["symptom"] == "dizziness"
    assert (await r.coach.tools.report_symptom("headache"))["error"].startswith("kind must be")


async def test_e_request_stop_takes_effect_within_one_tick(rig):
    r = await live_rig(rig)
    await to_set(r)
    t0 = time.monotonic()
    res = await r.coach.tools.request_stop()
    assert res["halted"] and r.flow.halted                       # synchronous
    await r.until(lambda: r.agent.types("pc.safety_alert"))
    assert time.monotonic() - t0 < 0.05
    assert r.outbox.of("safety_alert")[0]["kind"] == "stop"


@pytest.mark.parametrize("bad", [11, -1, "abc", 3.5, True, None, "7.2"])
async def test_f_invalid_pain_scores_return_an_error(rig, bad):
    r = await live_rig(rig)
    await to_set(r)
    res = await r.coach.tools.report_pain(bad)
    assert "error" in res and not r.flow.halted and not r.outbox.of("pain_recorded")


async def test_g_ready_to_continue_ends_rest_in_under_50ms(rig):
    r = await live_rig(rig, cfg=config(prescription=TWO_SETS), timing=SLOW_REST)
    await to_set(r)
    assert (await r.coach.tools.ready_to_continue()) == {"accepted": False, "reason": "set"}
    await r.until(lambda: r.flow.phase == "await_pain")
    await r.send("pat", "pc.pain_score", score=1, setIndex=1)
    await r.until(lambda: r.flow.phase == "rest")
    t0 = time.monotonic()
    assert (await r.coach.tools.ready_to_continue())["accepted"]
    await r.until(lambda: r.flow.phases.count("countdown") == 2)
    assert time.monotonic() - t0 < 0.05


async def test_h_get_progress_returns_only_flow_numbers(rig):
    r = await live_rig(rig)
    await to_set(r)
    await r.until(lambda: r.flow.phase == "await_pain")
    p = await r.coach.tools.get_progress()
    assert p.pop("rule") == "only quote these numbers"
    assert p == r.flow.progress()


async def test_tools_before_bind_are_not_ready():
    coach = LiveCoach(config(), ON, None)
    for name in ("get_progress", "report_pain", "report_symptom", "request_stop", "ready_to_continue"):
        assert (await getattr(coach.tools, name)()) == {"error": "not_ready"}
    assert public_result({"error": "not_ready"})[1] is False


# ------------------------------------------------------------------ (i) input gate matrix

def test_i_input_gate_matrix():
    u = unit_coach()
    c, f, sp, clock = u.coach, u.flow, u.speaker, u.clock
    assert c.input_open("pat")
    assert not c.input_open("phy") and not c.input_open(None)              # the patient only
    sp.busy = True
    assert not c.input_open("pat")                                          # a clip is playing (B6)
    sp.busy = False
    c.last_rt_pcm_at = clock.t - 0.1
    assert not c.input_open("pat")                                          # the coach is audible
    clock.t += 0.15
    assert not c.input_open("pat")                                          # ...plus the 300 ms tail
    clock.t += 0.1
    assert c.input_open("pat")
    c.last_rt_pcm_at = clock.t
    c.settings = LiveCoachSettings(enabled=True, barge_in=True)
    assert c.input_open("pat")                                              # LIVE_COACH_BARGE_IN=on
    c.settings = ON
    c.last_rt_pcm_at = -1e9
    f.paused = True
    assert not c.input_open("pat")
    f.paused = False
    sp.physio_speaking = True
    assert not c.input_open("pat")
    sp.physio_speaking = False
    f.consent_given = False
    assert not c.input_open("pat")                                          # nothing before consent (D12)
    f.consent_given = True
    for phase in ("countdown", "set"):
        f.phase = phase
        sp.busy = True                                                      # count clips play during a set
        assert c.input_open("pat")                                          # LIVE_COACH_SET_LISTEN=on
        c.settings = LiveCoachSettings(enabled=True, set_listen=False)
        assert not c.input_open("pat")
        c.settings = ON
    sp.busy = False
    for phase in ("greeting", "await_consent", "done", "halted"):
        f.phase = phase
        assert not c.input_open("pat")
    f.phase = "rest"
    f.halted = True
    assert not c.input_open("pat")
    f.halted = False
    u.port.is_up = False
    assert not c.input_open("pat")                                          # port down: nothing forwarded


# ------------------------------------------------------------------ (j) hold, (k) preempt

def test_j_hold_never_for_safety_or_counts_and_at_most_5s_for_prompts():
    u = unit_coach()
    c, clock = u.coach, u.clock
    assert c.hold("prompt") == 0.0                                          # coach idle
    c.rt_state, c._rt_at = "speaking", clock.t
    assert c.hold("safety") == 0.0 and c.hold("count") == 0.0
    assert c.hold("prompt") == pytest.approx(HOLD_MAX_S)
    clock.t += 3.0
    c._rt_at = clock.t
    assert c.hold("prompt") == pytest.approx(2.0)
    clock.t += 2.5
    c._rt_at = clock.t
    assert c.hold("prompt") == 0.0                                          # 5 s window used up: play
    c.rt_state = "idle"
    c.user_speaking, c._user_at = True, clock.t                             # patient mid-utterance
    assert c.hold("note") == pytest.approx(HOLD_MAX_S)
    u.flow.phase = "set"
    assert c.hold("prompt") == 0.0                                          # never in protected phases


async def test_j_safety_during_a_hold_plays_first_and_the_stale_prompt_is_dropped():
    u = unit_coach()
    c = u.coach
    agent_said: list[str] = []

    class A:
        async def say(self, text, interrupt=False):
            agent_said.append(text)

        async def send_custom_event(self, p):
            return None

    sp = Speaker(A(), lambda t: 0.01, hold=c.hold, before_play=c.before_clip)
    c.speaker = sp
    c.rt_state, c._rt_at = "speaking", c.clock()
    task = asyncio.create_task(sp.run())
    sp.say_ids(["pos.ok"], "prompt")
    await asyncio.sleep(0.1)
    assert agent_said == []                                                 # held while the coach speaks
    await sp.safety()
    await asyncio.sleep(0.1)
    assert agent_said == [phrases.get("safety.stop").ml]
    task.cancel()


def test_k_before_clip_without_recent_realtime_pcm_never_flushes_locally():
    u = unit_coach()
    c, clock = u.coach, u.clock
    c.before_clip("count")
    assert u.port.flushes == 0 and c.stats.local_flushes == 0               # coach idle: nothing at all
    c.rt_state, c._rt_at = "thinking", clock.t
    c.before_clip("count")
    assert u.port.flushes == 0 and c.suppress and c.rt_state == "idle"      # cancelled upstream only
    assert [e["type"] for e in c._out] == ["response.cancel", "output_audio_buffer.clear"] or \
        [e["type"] for e in c.stats.sent] == ["response.cancel", "output_audio_buffer.clear"]


async def test_k_before_clip_with_recent_realtime_pcm_flushes_once():
    u = unit_coach()
    c, clock = u.coach, u.clock
    c.on_response_created()
    c.on_rt_started()
    assert c.accept_rt_pcm(True)
    c.before_clip("prompt")
    await settle()
    assert u.port.flushes == 1
    assert [e["type"] for e in u.port.events] == ["response.cancel", "output_audio_buffer.clear"]
    clock.t += 0.1
    assert not c.accept_rt_pcm(True)                                        # the rest of that reply is dropped


# ------------------------------------------------------------------ (l) halt listener, (m) observe before send

async def test_l_halt_listener_silences_the_coach_before_the_safety_alert_is_sent(rig):
    r = await live_rig(rig)
    snapshots = []
    original = r.agent.send_custom_event

    async def spy(p):
        if p["type"] == "pc.safety_alert":
            snapshots.append((r.coach.halted_latch, r.coach.suppress, r.coach.output_open(),
                              [e["type"] for e in list(r.coach._out) + r.port.events]))
        await original(p)

    r.agent.send_custom_event = spy
    r.flow.on_patient_joined()
    await r.until(lambda: r.flow.phase == "await_consent")
    r.feeding = False
    await r.send("pat", "pc.consent", agreed=True)
    await r.until(lambda: r.flow.phase == "positioning" and r.port.is_up)
    await r.until(lambda: not r.speaker.busy)
    r.coach.on_response_created()                                           # the coach is mid-reply
    r.coach.on_rt_started()
    assert r.coach.accept_rt_pcm(True)
    await r.send("pat", "pc.stop", reason="button")
    assert r.coach.halted_latch                                             # same tick as Flow.halt
    await r.until(lambda: snapshots)
    latch, suppress, open_, events = snapshots[0]
    assert latch and suppress and not open_ and "response.cancel" in events
    assert r.port.flushes == 1                                              # coach PCM was recent


async def test_m_a_failed_send_still_observes(rig):
    u = unit_coach()
    agent = SimpleNamespace(events=[])

    async def failing(p):
        raise RuntimeError("stream down")

    agent.send_custom_event = failing
    facade = CoachFacade(agent, None, u.coach)
    with pytest.raises(RuntimeError):
        await facade.send_custom_event({"type": "pc.state", "phase": "countdown", "setIndex": 1, "setsPlanned": 2})
    await settle()
    updates = u.port.types("session.update")
    assert updates and updates[0]["session"]["audio"]["input"]["turn_detection"]["type"] == "server_vad"


async def test_m_flow_send_failure_still_mutes_the_coach_in_countdown(rig):
    r = await live_rig(rig)
    r.flow.on_patient_joined()
    await r.until(lambda: r.flow.phase == "await_consent" and r.port.is_up)
    r.agent.fail_sends = True                                               # Stream is down from now on
    await r.send("pat", "pc.consent", agreed=True)
    await r.until(lambda: r.flow.phase == "set")
    assert any(e["type"] == "session.update" for e in r.port.events)


# ------------------------------------------------------------------ (n) scheduler, (o) errors

def test_n_scheduler_keeps_one_response_in_flight_and_coalesces():
    sent, ok = [], {"v": True}
    s = ResponseScheduler(sent.append, lambda: ok["v"], clock=Clock())
    assert s.request() is True
    assert s.request() is False and s.request() is False                     # coalesced into one pending
    assert len(sent) == 1 and s.pending
    s.on_done()
    assert len(sent) == 2 and not s.pending                                  # the pending one fires once
    s.on_done()
    assert len(sent) == 2
    ok["v"] = False
    assert s.request() is False and len(sent) == 2                           # gate closed: nothing sent
    ok["v"] = True
    s.request()
    s.on_active_conflict()                                                   # server: already active
    s.on_done()
    assert len(sent) == 4


def test_n_scheduler_unsticks_after_6s():
    clock = Clock()
    sent = []
    s = ResponseScheduler(sent.append, lambda: True, clock=clock)
    s.request()
    clock.t += 7
    assert s.request() is True and len(sent) == 2


def test_o_harmless_errors_never_take_the_coach_down_but_3_failed_responses_do():
    u = unit_coach()
    c = u.coach
    for code in ("conversation_already_has_active_response", "response_cancel_not_active", "item_not_found"):
        c.on_rt_event({"type": "error", "error": {"code": code, "message": "x"}})
    c.on_rt_event({"type": "error", "error": {"type": "invalid_request_error", "message": "bad"}})
    assert c.up and not c.down
    for _ in range(2):
        c.on_rt_event({"type": "response.done", "response": {"status": "failed"}})
    c.on_rt_event({"type": "response.done", "response": {"status": "completed"}})    # resets the streak
    for _ in range(2):
        c.on_rt_event({"type": "response.done", "response": {"status": "failed"}})
    assert c.up
    c.on_rt_event({"type": "response.done", "response": {"status": "failed"}})
    assert c.down and not c.up and not c.input_open("pat") and c.hold("prompt") == 0.0


async def test_o_down_announces_voice_off_once():
    u = unit_coach()
    u.coach._was_up = True
    u.coach.mark_down("transport failed")
    u.coach.mark_down("again")
    await settle()
    voice = [p for p in u.custom if p["type"] == "pc.voice"]
    assert [(p["state"], p["live"]) for p in voice] == [("off", False)]


# ------------------------------------------------------------------ (p) transcripts, (q) tripwire

async def test_p_transcripts_are_finals_only_and_schema_valid():
    u = unit_coach()
    c = u.coach
    c.on_rt_event({"type": "conversation.item.input_audio_transcription.delta", "item_id": "i1", "delta": "എന്റെ"})
    c.on_rt_event({"type": "conversation.item.input_audio_transcription.completed", "item_id": "item_user_1",
                   "transcript": "എന്റെ കാൽ ശരിയായി കാണുന്നുണ്ടോ?"})
    c.on_response_created()
    c.on_rt_started()
    c.on_rt_event({"type": "response.output_audio_transcript.delta", "item_id": "item_c1", "delta": "Yes, I can "})
    c.on_rt_event({"type": "response.output_audio_transcript.delta", "item_id": "item_c1", "delta": "see your leg."})
    c.on_rt_event({"type": "response.output_audio_transcript.done", "item_id": "item_c1",
                   "transcript": "Yes, I can see your leg. " + "x" * 600})
    await settle()
    tr = [p for p in u.custom if p["type"] == "pc.transcript"]
    assert [(p["role"], p["final"]) for p in tr] == [("user", True), ("coach", True)]
    assert tr[0]["lang"] == "ml" and tr[1]["lang"] == "en" and len(tr[1]["text"]) == 400
    for p in tr + [p for p in u.custom if p["type"] == "pc.voice"]:
        agent_event_adapter.validate_python(p)


async def test_p_coach_text_is_suppressed_while_the_output_gate_is_closed():
    u = unit_coach()
    c = u.coach
    u.flow.phase = "set"
    c.on_response_created()
    c.on_rt_event({"type": "response.output_audio_transcript.done", "item_id": "c2", "transcript": "Keep going"})
    await settle()
    assert not [p for p in u.custom if p["type"] == "pc.transcript"]


async def test_q_tripwire_cuts_medication_advice_but_not_the_redirect():
    u = unit_coach()
    c = u.coach
    c.on_response_created()
    c.on_rt_started()
    assert c.accept_rt_pcm(True)
    c.on_coach_delta("r1", "I can't advise on medicine; please ask your physiotherapist. ")
    assert c.stats.trips == 0 and not c.suppress
    c.on_coach_delta("r1", "You could take a paracetamol")
    assert c.stats.trips == 0                                               # sentence not finished yet
    c.on_coach_delta("r1", " tablet. ")
    assert c.stats.trips == 1 and c.suppress
    await settle()
    types = [e["type"] for e in u.port.events]
    assert "response.cancel" in types and u.port.flushes == 1
    assert any("correction" in str(e) for e in u.port.events)
    c.on_coach_done("r1", "")
    await settle()
    assert not [p for p in u.custom if p["type"] == "pc.transcript"]       # the cut reply is never captioned


# ------------------------------------------------------------------ (r) port down, (s) spotter

async def test_r_port_down_sends_nothing_and_tools_still_work(rig):
    r = await live_rig(rig, port=FakePort(auto_up=False))
    await to_set(r)
    assert r.port.connects == 1 and not r.coach.up
    r.coach.observe({"type": "pc.rep", "n": 1, "repsPlanned": 10, "setIndex": 1})
    r.coach.before_clip("prompt")
    r.coach.scheduler.request()
    res = await r.coach.tools.report_symptom("chest_pain")
    assert res["halted"]
    await r.until(lambda: r.outbox.of("safety_alert"))
    await settle()
    assert r.port.events == [] and r.port.flushes == 0
    assert not [p for p in r.agent.events if p["type"] in ("pc.voice", "pc.transcript")]


async def test_s_spotter_halts_on_a_malayalam_dizziness_transcript(rig):
    r = await live_rig(rig)
    await to_set(r)
    r.coach.on_rt_event({"type": "conversation.item.input_audio_transcription.completed", "item_id": "u9",
                         "transcript": "എനിക്ക് തല കറങ്ങുന്നു"})
    await r.until(lambda: r.outbox.of("safety_alert"))
    alert = r.outbox.of("safety_alert")[0]
    assert (alert["kind"], alert["symptom"]) == ("symptom", "dizziness")
    assert r.coach.stats.spotted == ["dizziness"]


async def test_s_spotter_stop_and_negation(rig):
    r = await live_rig(rig)
    await to_set(r)
    r.coach.on_rt_event({"type": "conversation.item.input_audio_transcription.completed", "item_id": "u1",
                         "transcript": "I don't feel dizzy"})
    await asyncio.sleep(0.05)
    assert not r.flow.halted
    r.coach.on_rt_event({"type": "conversation.item.input_audio_transcription.completed", "item_id": "u2",
                         "transcript": "stop please"})
    await r.until(lambda: r.outbox.of("safety_alert"))
    assert r.outbox.of("safety_alert")[0]["kind"] == "stop"


# ------------------------------------------------------------------ output gate, speech_started, lifecycle

def test_output_gate_drops_pcm_unless_speaking_and_cancels_once():
    u = unit_coach()
    c, sp = u.coach, u.speaker
    assert not c.accept_rt_pcm(True)                                        # idle: OpenAI silence frames
    c.on_response_created()
    assert not c.accept_rt_pcm(False)                                       # thinking + silence: dropped
    assert c.accept_rt_pcm(True)                                            # first real audio beats .started
    sp.busy = True                                                          # a clip starts
    assert not c.accept_rt_pcm(True) and c.suppress
    assert not c.accept_rt_pcm(True)
    cancels = [e for e in list(c._out) + c.stats.sent if e["type"] == "response.cancel"]
    assert len(cancels) == 1                                                # once per response
    sp.busy = False
    assert not c.accept_rt_pcm(True)                                        # suppressed until a new response
    c.on_response_created()
    c.on_rt_started()
    assert c.accept_rt_pcm(True)


@pytest.mark.parametrize("phase", ["positioning", "summary", "await_pain", "rest"])
def test_output_gate_open_only_in_conversational_phases(phase):
    u = unit_coach()
    u.flow.phase = phase
    u.coach.on_response_created()
    u.coach.on_rt_started()
    assert u.coach.accept_rt_pcm(True)


@pytest.mark.parametrize("phase", ["greeting", "await_consent", "countdown", "set", "done", "halted"])
def test_output_gate_closed_elsewhere(phase):
    u = unit_coach()
    u.flow.phase = phase
    u.coach.on_response_created()
    u.coach.on_rt_started()
    assert not u.coach.accept_rt_pcm(True)


def test_speech_started_is_swallowed_while_a_clip_plays_or_in_protected_phases():
    u = unit_coach()
    c, f, sp = u.coach, u.flow, u.speaker
    assert c.on_rt_event({"type": "input_audio_buffer.speech_started"}) is False   # conversational: super
    assert c.user_speaking
    sp.busy = True
    assert c.on_rt_event({"type": "input_audio_buffer.speech_started"}) is True
    sp.busy = False
    for phase in ("countdown", "set", "halted"):
        f.phase = phase
        assert c.on_rt_event({"type": "input_audio_buffer.speech_started"}) is True
    f.phase = "rest"
    c.on_rt_event({"type": "input_audio_buffer.committed"})
    assert not c.user_speaking


def test_rt_state_auto_resets_after_6s():
    u = unit_coach()
    c, clock = u.coach, u.clock
    c.on_response_created()
    assert c.hold("prompt") > 0
    clock.t += 6.5
    assert c.hold("prompt") == 0.0 and c.rt_state == "idle"


async def test_connect_starts_at_greeting_and_voice_events_follow(rig):
    r = await live_rig(rig)
    assert r.port.connects == 0
    r.flow.on_patient_joined()
    await r.until(lambda: r.flow.phase == "await_consent")
    assert r.port.connects == 1 and r.coach.up
    r.feeding = False
    await r.send("pat", "pc.consent", agreed=True)
    await r.until(lambda: r.flow.phase == "positioning")
    await r.until(lambda: any(p["type"] == "pc.voice" and p["state"] == "listening" for p in r.agent.events))
    voices = [p for p in r.agent.events if p["type"] == "pc.voice"]
    assert voices[0]["live"] is True
    for p in voices:
        agent_event_adapter.validate_python(p)
    states = [e for e in r.port.events if "[STATE]" in str(e)]
    assert any("phase=positioning" in str(e) for e in states)
    assert all(e["item"]["role"] == "system" for e in states)


async def test_physio_barge_in_preempts_and_stop_is_synchronous(rig):
    u = unit_coach()
    c = u.coach
    c.on_response_created()
    c.on_rt_started()
    assert c.accept_rt_pcm(True)
    u.speaker.physio_speaking = True
    await c.on_physio_started()
    await settle()
    assert "response.cancel" in [e["type"] for e in u.port.events] and not c.output_open()
    u.speaker.physio_speaking = False
    assert c.on_physio_stopped() is None                                    # plain function, not a coroutine
