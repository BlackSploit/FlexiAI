"""Safety triggers (§1.4 #8): Stop, pain >= 7, or any reported symptom halts the set at once."""

from typing import Literal, Optional

from .config import PAIN_ALERT_THRESHOLD
from .contracts import PainScoreEvent, StopEvent, SymptomEvent

SafetyReason = Literal["stop", "pain", "symptom"]


def is_safety_trigger(event: object) -> Optional[SafetyReason]:
    if isinstance(event, StopEvent):
        return "stop"
    if isinstance(event, SymptomEvent):
        return "symptom"
    if isinstance(event, PainScoreEvent) and event.score >= PAIN_ALERT_THRESHOLD:
        return "pain"
    return None
