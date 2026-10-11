import pytest

from physiocoach.call.live_coach import (
    build_realtime_session, build_set_update, resolve_live_coach_settings, transcription_language,
)


def test_off_without_a_key():
    s = resolve_live_coach_settings({})
    assert not s.enabled and not s.warn and "OPENAI_API_KEY" in s.reason


def test_on_with_a_key_by_default():
    s = resolve_live_coach_settings({"OPENAI_API_KEY": "sk-test"})
    assert s.enabled and s.reason == "OPENAI_API_KEY set"
    assert (s.realtime_model, s.voice, s.video, s.set_listen, s.barge_in, s.partials) == \
        ("gpt-realtime-2", "marin", False, True, False, False)
    assert (s.connect_timeout_s, s.vad_eagerness, s.speed, s.transcribe_lang) == (6.0, "medium", 0.95, "patient")


@pytest.mark.parametrize("flag", ["off", "OFF", "false", "0", "no", " Off "])
def test_kill_switch(flag):
    s = resolve_live_coach_settings({"OPENAI_API_KEY": "sk-test", "LIVE_COACH": flag})
    assert not s.enabled


def test_on_without_key_warns_and_stays_off():
    s = resolve_live_coach_settings({"LIVE_COACH": "on"})
    assert not s.enabled and s.warn


def test_empty_strings_mean_unset():
    env = {k: "" for k in ("LIVE_COACH", "OPENAI_REALTIME_MODEL", "OPENAI_REALTIME_VOICE", "LIVE_COACH_VIDEO",
                           "LIVE_COACH_SET_LISTEN", "LIVE_COACH_BARGE_IN", "LIVE_COACH_PARTIALS",
                           "LIVE_COACH_CONNECT_TIMEOUT_S", "LIVE_COACH_SPEED", "LIVE_COACH_VAD_EAGERNESS",
                           "LIVE_COACH_TRANSCRIBE_LANG", "OPENAI_REALTIME_REASONING_EFFORT")}
    assert not resolve_live_coach_settings({**env, "OPENAI_API_KEY": ""}).enabled     # empty key == no key
    s = resolve_live_coach_settings({**env, "OPENAI_API_KEY": "sk-test"})
    assert s.enabled and s.realtime_model == "gpt-realtime-2" and s.voice == "marin" and s.set_listen
    assert s.connect_timeout_s == 6.0 and s.speed == 0.95 and s.reasoning_effort is None


def test_bad_numbers_and_choices_fall_back_to_defaults():
    s = resolve_live_coach_settings({"OPENAI_API_KEY": "k", "LIVE_COACH_CONNECT_TIMEOUT_S": "soon",
                                     "LIVE_COACH_SPEED": "9", "LIVE_COACH_VAD_EAGERNESS": "eager",
                                     "LIVE_COACH_TRANSCRIBE_LANG": "malayalam!", "LIVE_COACH_VIDEO": "maybe"})
    assert (s.connect_timeout_s, s.speed, s.vad_eagerness, s.transcribe_lang, s.video) == \
        (6.0, 0.95, "medium", "patient", False)
    s = resolve_live_coach_settings({"OPENAI_API_KEY": "k", "LIVE_COACH_CONNECT_TIMEOUT_S": "nan"})
    assert s.connect_timeout_s == 6.0


def test_overrides():
    s = resolve_live_coach_settings({"OPENAI_API_KEY": "k", "LIVE_COACH": "on", "OPENAI_REALTIME_MODEL": "gpt-realtime",
                                     "OPENAI_REALTIME_VOICE": "cedar", "LIVE_COACH_VIDEO": "on",
                                     "LIVE_COACH_SET_LISTEN": "off", "LIVE_COACH_BARGE_IN": "true",
                                     "LIVE_COACH_PARTIALS": "1", "LIVE_COACH_CONNECT_TIMEOUT_S": "8",
                                     "LIVE_COACH_TRANSCRIBE_LANG": "auto", "LIVE_COACH_NOISE_REDUCTION": "off"})
    assert s.reason == "LIVE_COACH=on"
    assert (s.realtime_model, s.voice, s.video, s.set_listen, s.barge_in, s.partials, s.connect_timeout_s) == \
        ("gpt-realtime", "cedar", True, False, True, True, 8.0)
    assert s.transcribe_lang is None and s.noise_reduction is None


def test_session_dicts_always_carry_type_and_full_audio_input():
    s = resolve_live_coach_settings({"OPENAI_API_KEY": "k"})
    lang = transcription_language(s, "ml")
    full = build_realtime_session(s, lang=lang, instructions="hi")
    assert full["type"] == "realtime" and full["model"] == "gpt-realtime-2" and full["instructions"] == "hi"
    ai = full["audio"]["input"]
    assert ai["transcription"]["language"] == "ml" and ai["transcription"]["model"] == "gpt-4o-mini-transcribe"
    assert ai["turn_detection"] == {"type": "semantic_vad", "eagerness": "medium", "create_response": True,
                                    "interrupt_response": True}
    assert ai["noise_reduction"] == {"type": "far_field"}
    assert full["audio"]["output"] == {"voice": "marin", "speed": 0.95}
    assert "reasoning" not in full and "@" not in str(full)
    minimal = build_realtime_session(s, lang=lang, instructions="hi", minimal=True)
    assert minimal["audio"]["input"] == {"transcription": {"model": "gpt-4o-mini-transcribe"},
                                         "turn_detection": {"type": "semantic_vad"}}
    assert minimal["audio"]["output"] == {"voice": "marin"} and minimal["instructions"] == "hi"
    upd = build_set_update(s, in_set=True, lang=lang)
    assert upd["type"] == "session.update" and upd["session"]["type"] == "realtime"
    td = upd["session"]["audio"]["input"]["turn_detection"]
    assert td == {"type": "server_vad", "silence_duration_ms": 450, "create_response": False,
                  "interrupt_response": False}
    assert upd["session"]["audio"]["input"]["transcription"]["language"] == "ml"
    back = build_set_update(s, in_set=False, lang=lang)
    assert back["session"]["audio"]["input"] == ai                   # restores the full conversational input


def test_transcription_language():
    s = resolve_live_coach_settings({"OPENAI_API_KEY": "k"})
    assert transcription_language(s, "en") == "en"
    s = resolve_live_coach_settings({"OPENAI_API_KEY": "k", "LIVE_COACH_TRANSCRIBE_LANG": "auto"})
    assert transcription_language(s, "ml") is None
    assert "language" not in build_realtime_session(s, lang=None)["audio"]["input"]["transcription"]
