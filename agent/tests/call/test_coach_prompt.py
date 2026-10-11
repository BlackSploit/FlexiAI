import pytest
from conftest import config

from physiocoach.call.coach_prompt import MAX_BYTES, REDIRECT_EN, REDIRECT_ML, build_instructions
from physiocoach.call.live_coach import tripwire_hit


@pytest.mark.parametrize("lang", ["ml", "en"])
def test_prompt_is_small_has_no_at_sign_and_no_personal_data(lang):
    cfg = config(patient={"id": "pat", "name": "Ammini Varghese", "lang": lang})
    text = build_instructions(cfg)
    assert len(text.encode("utf-8")) <= MAX_BYTES
    assert "@" not in text                         # Vision Agents treats @file.md as a file reference
    assert "Ammini" not in text and "pat" != text  # no patient name goes to OpenAI
    assert ("Reply in Malayalam" if lang == "ml" else "Reply in English") in text


def test_prompt_carries_the_prescription_and_the_rules():
    text = build_instructions(config())
    for needle in ("knee bend", "1 sets of 10", "60 degrees", "2 seconds", "[STATE]", "get_progress",
                   "report_pain", "report_symptom", "request_stop", "ready_to_continue", "[COACH CUE]",
                   "Never count", "button", "physiotherapist", REDIRECT_EN, REDIRECT_ML):
        assert needle in text, needle


def test_redirect_lines_do_not_trip_the_guardrail():
    assert not tripwire_hit(REDIRECT_EN)
    assert not tripwire_hit(REDIRECT_ML)
    assert not tripwire_hit("I can't advise on medicine; please ask your physiotherapist.")    # H4
    assert tripwire_hit("You could take a paracetamol for that.")
