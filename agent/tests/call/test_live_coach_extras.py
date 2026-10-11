"""Live Coach WP1b: camera stills (D5, H1), request_rest / repeat_instructions (D6) and optional partial
transcripts (H3). Pure: the real Flow/Speaker with a FakePort, or the unit coach with a manual clock."""

import base64

import pytest
from conftest import FAST, Rig, config, to_set  # noqa: F401
from test_live_coach import SLOW_REST, TWO_SETS, settle, unit_coach

from physiocoach.call.flow import REST_EXTEND_MAX, REST_EXTEND_S, FlowTiming
from physiocoach.call.live_coach import (
    STILL_MAX_B64, STILL_MIN_INTERVAL_S, STILL_QUALITY, STILL_WIDTH, TOOL_SPECS, LiveCoach, LiveCoachSettings,
    public_result,
)
from physiocoach.core import phrases
from physiocoach.core.contracts import agent_event_adapter

JPEG = b"\xff\xd8\xff\xe0" + b"x" * 2000 + b"\xff\xd9"
PARTIALS = LiveCoachSettings(enabled=True, reason="test", partials=True)
NO_VIDEO = LiveCoachSettings(enabled=True, reason="test", video=False)


class StillPose:
    def __init__(self, jpeg=JPEG):
        self.jpeg = jpeg
        self.calls: list[dict] = []

    def latest_jpeg(self, **kw):
        self.calls.append(kw)
        return self.jpeg


def stills(events) -> list[dict]:
    out = []
    for e in events:
        if e.get("type") == "conversation.item.create" and e["item"].get("role") == "user":
            out += [c for c in e["item"]["content"] if c.get("type") == "input_image"]
    return out


def still_coach(settings=None, jpeg=JPEG):
    u = unit_coach(settings) if settings is not None else unit_coach()
    u.pose = StillPose(jpeg)
    u.coach.pose = u.pose
    return u


SPEECH = {"type": "input_audio_buffer.speech_started"}


# ------------------------------------------------------------------ stills (D5)

async def test_still_goes_with_a_patient_turn_as_one_input_image_and_never_a_response():
    u = still_coach()
    assert u.coach.on_rt_event(SPEECH) is False                             # not swallowed: the plugin sees it
    await settle()
    imgs = stills(u.port.events)
    assert len(imgs) == 1 and u.coach.stats.stills == ["turn"]
    assert imgs[0]["image_url"] == "data:image/jpeg;base64," + base64.b64encode(JPEG).decode()
    assert imgs[0]["detail"] == "low"
    item = u.port.types("conversation.item.create")[0]["item"]
    assert (item["type"], item["role"]) == ("message", "user")
    assert "[CAMERA STILL]" in item["content"][0]["text"]
    assert u.pose.calls == [{"width": STILL_WIDTH, "quality": STILL_QUALITY}] == [{"width": 384, "quality": 60}]
    assert not u.port.types("response.create")


async def test_still_is_off_with_live_coach_video_off():
    u = still_coach(NO_VIDEO)
    u.coach.on_rt_event(SPEECH)
    assert not u.coach.maybe_send_still("rest")
    await settle()
    assert not stills(u.port.events) and u.pose.calls == []


@pytest.mark.parametrize("phase", ["greeting", "await_consent"])
async def test_no_still_before_consent(phase):
    u = still_coach()
    u.flow.consent_given, u.flow.phase = False, phase
    u.coach.on_rt_event(SPEECH)
    assert not u.coach.maybe_send_still("rest")
    u.flow.phase = "positioning"                                            # even in a conversational phase
    assert not u.coach.maybe_send_still("turn")
    await settle()
    assert not stills(u.port.events) and u.pose.calls == []


@pytest.mark.parametrize("phase", ["countdown", "set", "halted", "done"])
async def test_no_still_in_protected_phases(phase):
    u = still_coach()
    u.flow.phase = phase
    u.coach.on_rt_event(SPEECH)                                             # swallowed in countdown/set/halted
    assert not u.coach.maybe_send_still("turn")
    await settle()
    assert not stills(u.port.events) and u.pose.calls == []


async def test_no_still_while_halted_paused_or_port_down():
    u = still_coach()
    u.flow.halted = True
    assert not u.coach.maybe_send_still("turn")
    u.flow.halted, u.flow.paused = False, True
    assert not u.coach.maybe_send_still("turn")
    u.flow.paused, u.port.is_up = False, False
    assert not u.coach.maybe_send_still("turn")
    await settle()
    assert u.port.events == [] and u.pose.calls == []


async def test_no_still_while_a_clip_plays_because_speech_started_is_swallowed():
    u = still_coach()
    u.speaker.busy = True
    assert u.coach.on_rt_event(SPEECH) is True
    await settle()
    assert not stills(u.port.events)


async def test_stills_are_rate_limited():
    u = still_coach()
    u.coach.on_rt_event(SPEECH)
    u.clock.t += 1.0
    u.coach.on_rt_event(SPEECH)
    assert not u.coach.maybe_send_still("rest")
    u.clock.t += STILL_MIN_INTERVAL_S - 1.0 + 0.01
    assert u.coach.maybe_send_still("rest")
    await settle()
    assert len(stills(u.port.events)) == 2 and u.coach.stats.stills == ["turn", "rest"]


async def test_no_frame_sends_nothing_and_does_not_use_up_the_interval():
    u = still_coach(jpeg=None)
    assert not u.coach.maybe_send_still("turn")
    u.pose.jpeg = JPEG
    assert u.coach.maybe_send_still("turn")                                 # immediately: no frame != a still
    await settle()
    assert len(stills(u.port.events)) == 1


async def test_oversized_still_is_skipped():
    big = b"\xff\xd8" + bytes(range(256)) * 160                              # ~41 KB -> ~55 KB of base64
    assert len(base64.b64encode(big)) > STILL_MAX_B64
    u = still_coach(jpeg=big)
    assert not u.coach.maybe_send_still("turn")
    await settle()
    assert not stills(u.port.events) and u.coach.stats.stills_skipped == 1


async def test_a_failing_pose_never_breaks_the_event_pump():
    u = still_coach()

    def boom(**kw):
        raise RuntimeError("cv2 missing")

    u.pose.latest_jpeg = boom
    assert u.coach.on_rt_event(SPEECH) is False and u.coach.user_speaking
    assert not u.coach.maybe_send_still("rest")


async def test_rest_cue_carries_one_still_before_the_cue(rig):
    r = rig(live=True, cfg=config(prescription=TWO_SETS), timing=SLOW_REST)
    pose = StillPose()
    r.pose.latest_jpeg = pose.latest_jpeg
    await to_set(r)
    await r.until(lambda: r.flow.phase == "await_pain")
    assert not stills(r.port.events)                                        # nothing during countdown/set
    await r.send("pat", "pc.pain_score", score=1, setIndex=1)
    await r.until(lambda: r.port.types("response.create"), timeout=3)
    ev = r.port.events
    img = next(i for i, e in enumerate(ev) if stills([e]))
    cue = next(i for i, e in enumerate(ev) if "[COACH CUE]" in str(e))
    assert img < cue < ev.index(r.port.types("response.create")[0])
    assert len(stills(ev)) == 1 and r.coach.stats.stills == ["rest"]


# ------------------------------------------------------------------ tools (D6)

def test_tool_specs_now_list_seven_unique_object_schemas():
    names = [n for n, _, _ in TOOL_SPECS]
    assert len(names) == len(set(names)) == 7
    assert names[-2:] == ["request_rest", "repeat_instructions"]
    assert all(s["type"] == "object" and s["additionalProperties"] is False for _, _, s in TOOL_SPECS)


async def test_new_tools_before_bind_are_not_ready():
    coach = LiveCoach(config(), LiveCoachSettings(enabled=True), None)
    for name in ("request_rest", "repeat_instructions"):
        assert (await getattr(coach.tools, name)()) == {"error": "not_ready"}


async def test_request_rest_is_refused_during_countdown_and_set(rig):
    r = rig(live=True, cfg=config(prescription=TWO_SETS), timing=SLOW_REST)
    await to_set(r)
    res = await r.coach.tools.request_rest()
    assert res["accepted"] is False and "advice" in res
    assert r.flow._rest_extensions == 0


async def test_request_rest_extends_the_running_rest_at_most_twice(rig):
    r = rig(live=True, cfg=config(prescription=TWO_SETS), timing=SLOW_REST)
    await to_set(r)
    await r.until(lambda: r.flow.phase == "await_pain")
    await r.send("pat", "pc.pain_score", score=1, setIndex=1)
    await r.until(lambda: r.flow.phase == "rest" and r.flow._rest_deadline is not None)
    d0 = r.flow._rest_deadline
    for i in range(REST_EXTEND_MAX):
        res = await r.coach.tools.request_rest()
        assert res["accepted"] is True and public_result(res)[1] is True     # the coach may acknowledge
    assert r.flow._rest_deadline == pytest.approx(d0 + REST_EXTEND_MAX * REST_EXTEND_S)
    assert (await r.coach.tools.request_rest()) == {"accepted": False, "reason": "limit"}
    assert (await r.coach.tools.ready_to_continue())["accepted"]            # ready still ends it at once
    await r.until(lambda: r.flow.phases.count("countdown") == 2)


async def test_request_rest_after_a_set_lengthens_the_coming_rest(rig):
    r = rig(live=True, cfg=config(prescription=TWO_SETS), timing=SLOW_REST)
    await to_set(r)
    await r.until(lambda: r.flow.phase == "await_pain")
    res = await r.coach.tools.request_rest()
    assert res == {"accepted": True, "restSeconds": 60}
    await r.send("pat", "pc.pain_score", score=1, setIndex=1)
    await r.until(lambda: r.flow.phase == "rest" and r.flow._rest_deadline is not None)
    assert r.flow._rest_deadline - r.flow.loop_time() == pytest.approx(60.0, abs=0.5)
    assert (await r.coach.tools.request_rest())["accepted"]                 # second (last) one
    assert (await r.coach.tools.request_rest())["reason"] == "limit"


async def test_request_rest_after_the_last_set_is_refused(rig):
    r = rig(live=True)                                                      # one set: no rest follows
    await to_set(r)
    await r.until(lambda: r.flow.phase == "await_pain")
    res = await r.coach.tools.request_rest()
    assert res["accepted"] is False and "last set" in res["reason"]


async def test_flow_rest_really_waits_for_the_moved_deadline(rig):
    timing = FlowTiming(**{**FAST.__dict__, "rest": 0.2})
    r = rig(cfg=config(prescription=TWO_SETS), timing=timing)
    await to_set(r)
    await r.until(lambda: r.flow.phase == "await_pain")
    await r.send("pat", "pc.pain_score", score=1, setIndex=1)
    await r.until(lambda: r.flow.phase == "rest" and r.flow._rest_deadline is not None)
    t0 = r.flow.loop_time()
    assert r.flow.request_rest(extra=0.4)["accepted"]
    await r.until(lambda: r.flow.phases.count("countdown") == 2)
    assert r.flow.loop_time() - t0 >= 0.45


async def test_request_rest_when_halted_is_refused(rig):
    r = rig(live=True, cfg=config(prescription=TWO_SETS), timing=SLOW_REST)
    await to_set(r)
    await r.coach.tools.request_stop()
    assert (await r.coach.tools.request_rest())["accepted"] is False


async def test_repeat_instructions_replays_the_positioning_clips_outside_a_set(rig):
    r = rig(live=True)
    r.flow.on_patient_joined()
    await r.until(lambda: r.flow.phase == "await_consent")
    r.feeding = False
    await r.send("pat", "pc.consent", agreed=True)
    await r.until(lambda: r.flow.phase == "positioning")
    await r.until(lambda: not r.speaker.busy)
    side, leg = phrases.get("pos.side"), phrases.get("pos.leg_in_frame")
    before = r.agent.said.count(side.ml)
    res = await r.coach.tools.repeat_instructions()
    public, reply = public_result(res)
    assert public == {"played": True, "text_en": f"{side.en} {leg.en}"} and reply is False   # the clip is the reply
    assert r.flow.instruction_ids() == ["pos.side", "pos.leg_in_frame"]
    await r.until(lambda: r.agent.said.count(side.ml) == before + 1 and leg.ml in r.agent.said)


async def test_repeat_instructions_is_refused_in_a_set_and_when_halted(rig):
    r = rig(live=True)
    await to_set(r)
    assert (await r.coach.tools.repeat_instructions()) == {"played": False, "reason": "set"}
    assert not any("pos.side" in u.ids for u in r.speaker._queue)
    await r.coach.tools.request_stop()
    assert (await r.coach.tools.repeat_instructions()) == {"played": False, "reason": "halted"}


# ------------------------------------------------------------------ partial transcripts (H3)

def _tr(u):
    return [p for p in u.custom if p["type"] == "pc.transcript"]


async def test_partials_are_off_by_default():
    u = unit_coach()
    u.coach.on_rt_event({"type": "conversation.item.input_audio_transcription.delta", "item_id": "u1",
                         "delta": "hello"})
    u.coach.on_response_created()
    u.coach.on_rt_started()
    u.coach.on_rt_event({"type": "response.output_audio_transcript.delta", "item_id": "c1", "delta": "Good. "})
    await settle()
    assert _tr(u) == []


async def test_user_partials_are_rate_limited_then_the_final_follows():
    u = unit_coach(PARTIALS)
    c, clock = u.coach, u.clock
    d = "conversation.item.input_audio_transcription.delta"
    c.on_rt_event({"type": d, "item_id": "u1", "delta": "എന്റെ "})
    c.on_rt_event({"type": d, "item_id": "u1", "delta": "കാൽ "})                # within 1 s: no event
    clock.t += 1.01
    c.on_rt_event({"type": d, "item_id": "u1", "delta": "ശരിയാണോ"})
    c.on_rt_event({"type": "conversation.item.input_audio_transcription.completed", "item_id": "u1",
                   "transcript": "എന്റെ കാൽ ശരിയാണോ?"})
    await settle()
    tr = _tr(u)
    assert [(p["final"], p["text"]) for p in tr] == [(False, "എന്റെ"), (False, "എന്റെ കാൽ ശരിയാണോ"),
                                                     (True, "എന്റെ കാൽ ശരിയാണോ?")]
    assert {p["turnId"] for p in tr} == {"u1"} and all(p["role"] == "user" for p in tr)
    for p in tr:
        agent_event_adapter.validate_python(p)


async def test_user_partials_never_before_consent():
    u = unit_coach(PARTIALS)
    u.flow.consent_given = False
    u.coach.on_rt_event({"type": "conversation.item.input_audio_transcription.delta", "item_id": "u1",
                         "delta": "hello"})
    await settle()
    assert _tr(u) == []


async def test_coach_partials_are_whole_checked_sentences_only_and_never_a_cut_one():
    u = unit_coach(PARTIALS)
    c, clock = u.coach, u.clock
    c.on_response_created()
    c.on_rt_started()
    assert c.accept_rt_pcm(True)
    c.on_coach_delta("c1", "Nice work")
    await settle()
    assert _tr(u) == []                                                     # no sentence end yet
    c.on_coach_delta("c1", " today. Keep")
    await settle()
    assert [(p["role"], p["final"], p["text"]) for p in _tr(u)] == [("coach", False, "Nice work today.")]
    clock.t += 1.01
    c.on_coach_delta("c1", " taking a paracetamol tablet. ")                # tripwire: cut, never captioned
    c.on_coach_done("c1", "")
    await settle()
    assert c.stats.trips == 1 and len(_tr(u)) == 1


async def test_coach_partials_are_suppressed_while_the_output_gate_is_closed():
    u = unit_coach(PARTIALS)
    u.flow.phase = "set"
    u.coach.on_response_created()
    u.coach.on_coach_delta("c2", "Keep going. ")
    await settle()
    assert _tr(u) == []
