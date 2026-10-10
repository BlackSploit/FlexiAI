"""Optional LLM post-set note (§8.9). The rule note is always computed first and wins on ANY failure.

Input is set metrics only (no name, phone or other personal data). Output is ONLY {"ml", "en"},
validated for shape and semantics (Malayalam ratio, 2-3 sentences, numbers from the input only,
deny-list). Called with the Anthropic SDK directly, not through the Vision Agents `llm=` slot.
"""

import asyncio
import json
import logging
import os
import re
from typing import Any

import anthropic
from pydantic import BaseModel, ConfigDict, Field

from .coach_rules import next_more_reps, split_sentences
from .scoring import SetMetrics

log = logging.getLogger(__name__)

MODEL = "claude-sonnet-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"


def _timeout_s() -> float:
    return float(os.getenv("NOTE_LLM_TIMEOUT_S", "3.5"))


def _server_fallback() -> bool:
    return os.getenv("NOTE_LLM_SERVER_FALLBACK", "true") == "true"


_CLIENT: anthropic.AsyncAnthropic | None = None


def _client() -> anthropic.AsyncAnthropic:
    """Built on first use: constructing it needs ANTHROPIC_API_KEY, and the rules path never does."""
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = anthropic.AsyncAnthropic(timeout=_timeout_s(), max_retries=0)   # stay inside the budget
    return _CLIENT


class NoteOut(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)   # spec: output is ONLY {"ml","en"}
    ml: str = Field(min_length=1, max_length=400)
    en: str = Field(min_length=1, max_length=400)


NOTE_SCHEMA = {"type": "object", "properties": {"ml": {"type": "string"}, "en": {"type": "string"}},
               "required": ["ml", "en"], "additionalProperties": False}

SYSTEM = (
    "You write a short spoken note for a patient who just finished one set of an exercise prescribed by their "
    "physiotherapist, supervised by an AI exercise coach. The input is JSON metrics for that set. "
    "Return JSON with two fields that say the same thing: 'ml' in natural, simple spoken Malayalam (Malayalam script; "
    "write numbers as digits) and 'en' in plain English for the physiotherapist. Each is 2-3 short sentences. "
    "Cover: the achieved angle versus the target angle; tempo ONLY if fastReps > 0; and exactly one concrete next step, "
    "taken from suggestedNextStep. Use only numbers that appear in the input; minSecondsPerRep is the only tempo "
    "number to use. Never diagnose, never name a condition, injury, cause of pain or medication, never suggest "
    "changing the target, reps, sets or frequency, and never give medical advice beyond doing the prescribed exercise."
)

DENY_EN = ("diagnos", "injur", "tear", "arthritis", "fracture", "surgery", "medicat", "medicine", "painkiller",
           "ibuprofen", "paracetamol", "inflamm", "condition", "prescription", "increase your target",
           "change your", "dose", "ice pack", "heat pack", "see a doctor")
DENY_ML = ("രോഗ", "മരുന്ന്", "ശസ്ത്രക്രിയ", "പരിക്ക്")   # NATIVE REVIEW REQUIRED
MALAYALAM_MIN_RATIO = 0.6
_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def note_metrics(m: SetMetrics, exercise_id: str, mode: str, min_seconds_per_rep: float) -> dict[str, Any]:
    """The LLM input (§8.9). suggestedNextStep mirrors coach_rules.next_step_id."""
    short = m.avg_peak < m.target - 8
    if short or m.fast_reps or m.reps_done < m.reps_planned:
        step: dict[str, Any] = {"moreReps": next_more_reps(m), "slowly": True}
    else:
        step = {"keepReps": m.reps_planned, "slowly": True}
    return {
        "exerciseId": exercise_id, "mode": mode, "verb": "bend" if mode == "flex" else "raise",
        "targetAngle": int(m.target), "repsPlanned": m.reps_planned, "repsDone": m.reps_done,
        "avgPeak": round(m.avg_peak), "bestPeak": m.best_peak, "lowestPeak": m.lowest_peak,
        "avgRepSeconds": m.avg_rep_seconds, "minSecondsPerRep": min_seconds_per_rep,
        "fastReps": m.fast_reps, "suggestedNextStep": step,
    }


def _allowed_numbers(metrics: dict[str, Any]) -> set[float]:
    step = metrics.get("suggestedNextStep") or {}
    k = step.get("moreReps", step.get("keepReps", metrics["repsPlanned"]))
    spr, ars = metrics["minSecondsPerRep"], metrics["avgRepSeconds"]
    vals = {round(metrics["avgPeak"]), round(metrics["bestPeak"]), round(metrics["lowestPeak"]),
            metrics["targetAngle"], metrics["repsDone"], metrics["repsPlanned"], metrics["fastReps"], k,
            0, 1, spr, round(spr), round(ars, 1), round(ars)}
    return {float(v) for v in vals}


def _malayalam_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if "ഀ" <= c <= "ൿ") / len(letters)


def validate_note(note: NoteOut, metrics: dict[str, Any]) -> None:
    """Raises ValueError on any semantic violation (shape is already checked by NoteOut)."""
    if _malayalam_ratio(note.ml) < MALAYALAM_MIN_RATIO:
        raise ValueError("ml is not mostly Malayalam")
    for field, text in (("ml", note.ml), ("en", note.en)):
        n = len(split_sentences(text))
        if not 2 <= n <= 3:
            raise ValueError(f"{field} has {n} sentences")
    allowed = _allowed_numbers(metrics)
    for text in (note.ml, note.en):
        for num in _NUMBER.findall(text):
            if float(num) not in allowed:
                raise ValueError(f"number {num} not in the input")
    en = note.en.lower()
    for word in DENY_EN:
        if word in en:
            raise ValueError(f"deny-listed en term {word!r}")
    for word in DENY_ML:
        if word in note.ml:
            raise ValueError("deny-listed ml term")


async def _call_llm(metrics: dict[str, Any]) -> NoteOut:
    req: dict[str, Any] = dict(
        model=MODEL, max_tokens=600, system=SYSTEM,
        thinking={"type": "between_tools"},                  # thinking off on Sonnet 5.5; "disabled" is a 400
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": NOTE_SCHEMA}},
        messages=[{"role": "user", "content": json.dumps(metrics, ensure_ascii=False)}],
    )
    client = _client()
    if _server_fallback():
        # Claude API only. A between_tools request that falls back to Sonnet 5 runs there with thinking disabled.
        resp = await client.beta.messages.create(**req, betas=[FALLBACK_BETA], fallbacks="default")
    else:
        resp = await client.messages.create(**req)
    if resp.stop_reason != "end_turn":                       # "refusal", "max_tokens", ... -> rules
        raise ValueError(f"stop_reason={resp.stop_reason}")
    text = next(b.text for b in resp.content if b.type == "text")
    return NoteOut.model_validate_json(text)


async def post_set_note(metrics: dict[str, Any], rule_note: dict[str, str]) -> tuple[dict[str, str], str]:
    """Returns (note, source). rule_note is already computed (instant fallback)."""
    if os.getenv("NOTE_LLM_ENABLED", "true") != "true" or not os.getenv("ANTHROPIC_API_KEY"):
        return rule_note, "rules"
    try:
        note = await asyncio.wait_for(_call_llm(metrics), _timeout_s())
        validate_note(note, metrics)                         # raises on any violation
        return note.model_dump(), "llm"
    except Exception as e:                                   # timeout, network, refusal, JSON, validation
        log.info("LLM note rejected, using rules: %s", type(e).__name__)
        return rule_note, "rules"
