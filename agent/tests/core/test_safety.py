import pytest

from physiocoach.core.contracts import ConsentEvent, PainScoreEvent, StopEvent, SymptomEvent
from physiocoach.core.safety import is_safety_trigger

E = {"v": 1, "eventId": "evt_0001abcd", "ts": 1}


def test_pain_threshold_is_seven():
    assert is_safety_trigger(PainScoreEvent(type="pc.pain_score", score=6, setIndex=1, **E)) is None
    assert is_safety_trigger(PainScoreEvent(type="pc.pain_score", score=7, setIndex=1, **E)) == "pain"


def test_stop_button():
    assert is_safety_trigger(StopEvent(type="pc.stop", reason="button", **E)) == "stop"


@pytest.mark.parametrize("kind", ["dizziness", "chest_pain", "sharp_pain"])
def test_every_symptom(kind):
    assert is_safety_trigger(SymptomEvent(type="pc.symptom", kind=kind, **E)) == "symptom"


def test_consent_is_not_a_trigger():
    assert is_safety_trigger(ConsentEvent(type="pc.consent", agreed=True, **E)) is None
