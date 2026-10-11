"""Regression tests for the adversarial review of the Live Coach (WP1a/WP1b)."""

from types import SimpleNamespace

from conftest import config  # noqa: F401
from test_live_coach import settle, unit_coach

from physiocoach.call.live_coach import LiveCoachSettings
from physiocoach.call.speaker import Speaker

PARTIALS = LiveCoachSettings(enabled=True, reason="test", partials=True)


def _real_speaker_coach():
    u = unit_coach()

    async def say(_text):
        return None

    async def send(_p):
        return None

    sp = Speaker(SimpleNamespace(say=say, send_custom_event=send), lambda _t: 1.0, hold=u.coach.hold,
                 before_play=u.coach.before_clip)
    u.coach.speaker = sp
    return u, sp


async def test_input_stays_open_while_a_queued_clip_is_held_for_the_patients_utterance():
    # Patient mid-utterance, then a prompt is queued: the Speaker holds it (max 5 s) for the end of the turn.
    # The input must keep flowing, or OpenAI never hears the silence, never commits, and the hold always
    # runs the full 5 s (and user_speaking sticks for 15 s, holding every later prompt too).
    u, sp = _real_speaker_coach()
    c = u.coach
    c.on_rt_event({"type": "input_audio_buffer.speech_started"})
    assert c.user_speaking
    sp.say_ids(["pos.ok"], "prompt")
    assert sp.busy and sp.playing_kind is None
    assert c.hold("prompt") > 0                                           # held for the patient
    assert c.input_open("pat")                                            # nothing audible: keep listening
    c.on_rt_event({"type": "input_audio_buffer.committed"})
    assert not c.user_speaking and c.hold("prompt") == 0.0                # the clip is released at once
    assert not c.input_open("pat")                                        # about to play: half-duplex again


async def test_input_still_closes_while_a_clip_is_audible_or_not_held():
    u, sp = _real_speaker_coach()
    c = u.coach
    sp.say_ids(["pos.ok"], "prompt")
    assert not c.input_open("pat")                                        # queued, patient silent: closed
    c.on_rt_event({"type": "input_audio_buffer.speech_started"})          # swallowed: a clip is queued
    assert not c.user_speaking and not c.input_open("pat")
    c.user_speaking, c._user_at = True, c.clock()
    assert c.hold("prompt") > 0
    sp.busy_until = sp.clock() + 5                                        # a clip is audible (echo): closed
    sp._last_kind = "prompt"
    assert not c.input_open("pat")


async def test_input_gate_with_a_speaker_without_playing_kind_stays_closed():
    u = unit_coach()
    c = u.coach
    c.user_speaking, c._user_at = True, c.clock()
    u.speaker.busy = True
    assert c.hold("prompt") > 0
    assert not c.input_open("pat")                                        # unknown audibility: closed


async def test_coach_partial_is_not_shown_while_a_clip_is_queued_or_playing():
    # The transcript delta beats the audio; with a clip busy the first PCM frame is dropped and the response
    # cancelled, so a partial caption would show words the patient never hears.
    u = unit_coach(PARTIALS)
    c = u.coach
    c.on_response_created()
    u.speaker.busy = True
    c.on_coach_delta("c1", "Nice work today. ")
    await settle()
    assert not [p for p in u.custom if p.get("type") == "pc.transcript"]
    u.speaker.busy = False
    c.clock.t += 1.01
    c.on_coach_delta("c1", "Rest now. ")
    await settle()
    tr = [p for p in u.custom if p.get("type") == "pc.transcript"]
    assert [(p["final"], p["text"]) for p in tr] == [(False, "Nice work today. Rest now.")]
