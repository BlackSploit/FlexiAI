"""Optional LLM post-set note (§8.9). The rule note is always computed first and wins on ANY failure.

Input is set metrics only (no name, phone or other personal data). Output is ONLY {"ml", "en"},
validated for shape and semantics (Malayalam ratio, 2-3 sentences, numbers from the input only,
deny-list). Called with the OpenAI SDK directly (Chat Completions, strict json_schema), not through
the Vision Agents `llm=` slot.

Env (a set-but-empty variable counts as unset; unparsable numbers fall back to the default):
  OPENAI_API_KEY           gate: without it the rule note is used and nothing touches the network
  NOTE_LLM_ENABLED         "true" (default) or anything else to disable
  NOTE_LLM_MODEL           note-only model override; else OPENAI_MODEL; else "gpt-5-mini"
  OPENAI_REASONING_EFFORT  default "minimal"; sent only to reasoning models (gpt-5*, o<digit>*);
                           "omit" leaves the parameter out
  NOTE_LLM_TIMEOUT_S       total budget in seconds, default 3.5
"""

import asyncio
import json
import logging
import math
import os
import re
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field

from .coach_rules import next_more_reps, split_sentences
from .scoring import SetMetrics

if TYPE_CHECKING:
    import openai

log = logging.getLogger(__name__)

DEFAULT_MODEL = "gpt-5-mini"
DEFAULT_EFFORT = "minimal"
DEFAULT_TIMEOUT_S = 3.5
MAX_COMPLETION_TOKENS = 800          # includes reasoning tokens on reasoning models
_REASONING_MODEL = re.compile(r"^(gpt-5|o\d)")


def _env(name: str) -> str | None:
    """A set-but-empty (or whitespace-only) variable means unset."""
    value = os.getenv(name)
    if value is None or not value.strip():
        return None
    return value.strip()


def _model() -> str:
    return _env("NOTE_LLM_MODEL") or _env("OPENAI_MODEL") or DEFAULT_MODEL


def _reasoning_effort(model: str) -> str | None:
    """None means: do not send `reasoning_effort` (non-reasoning model, or OPENAI_REASONING_EFFORT=omit)."""
    if not _REASONING_MODEL.match(model.lower()):
        return None
    effort = (_env("OPENAI_REASONING_EFFORT") or DEFAULT_EFFORT).lower()
    return None if effort == "omit" else effort


def _timeout_s() -> float:
    try:
        value = float(_env("NOTE_LLM_TIMEOUT_S") or DEFAULT_TIMEOUT_S)
    except ValueError:
        return DEFAULT_TIMEOUT_S
    return value if math.isfinite(value) and value > 0 else DEFAULT_TIMEOUT_S


def _enabled() -> bool:
    return (_env("NOTE_LLM_ENABLED") or "true").lower() == "true"


_CLIENT: "openai.AsyncOpenAI | None" = None


def _client() -> "openai.AsyncOpenAI":
    """Built on first use: constructing it needs OPENAI_API_KEY, and the rules path never does.
    The import is lazy too, so physiocoach.core stays importable where openai is not installed."""
    global _CLIENT
    if _CLIENT is None:
        import openai

        _CLIENT = openai.AsyncOpenAI(timeout=_timeout_s(), max_retries=0)   # stay inside the budget
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


def build_request(metrics: dict[str, Any]) -> dict[str, Any]:
    """The exact Chat Completions kwargs (shared with devtools.check_openai). No temperature: reasoning
    models reject it."""
    model = _model()
    req: dict[str, Any] = dict(
        model=model,
        max_completion_tokens=MAX_COMPLETION_TOKENS,
        messages=[{"role": "system", "content": SYSTEM},
                  {"role": "user", "content": json.dumps(metrics, ensure_ascii=False)}],
        response_format={"type": "json_schema",
                         "json_schema": {"name": "post_set_note", "strict": True, "schema": NOTE_SCHEMA}},
    )
    effort = _reasoning_effort(model)
    if effort is not None:
        req["reasoning_effort"] = effort
    return req


def parse_completion(resp: Any) -> NoteOut:
    """Raises on anything but a complete, non-refused JSON answer (the caller falls back to rules)."""
    if not getattr(resp, "choices", None):
        raise ValueError("no choice")
    choice = resp.choices[0]
    if choice.finish_reason != "stop":                       # "length", "content_filter", ... -> rules
        raise ValueError(f"finish_reason={choice.finish_reason}")
    if getattr(choice.message, "refusal", None):
        raise ValueError("refusal")
    text = choice.message.content
    if not text or not text.strip():
        raise ValueError("empty content")
    return NoteOut.model_validate_json(text)


async def _call_llm(metrics: dict[str, Any]) -> NoteOut:
    resp = await _client().chat.completions.create(**build_request(metrics))
    return parse_completion(resp)


async def post_set_note(metrics: dict[str, Any], rule_note: dict[str, str]) -> tuple[dict[str, str], str]:
    """Returns (note, source). rule_note is already computed (instant fallback)."""
    if not _enabled() or not _env("OPENAI_API_KEY"):
        return rule_note, "rules"
    try:
        note = await asyncio.wait_for(_call_llm(metrics), _timeout_s())
        validate_note(note, metrics)                         # raises on any violation
        return note.model_dump(), "llm"
    except Exception as e:                                   # timeout, network, refusal, JSON, validation
        log.info("LLM note rejected, using rules: %s", type(e).__name__)
        return rule_note, "rules"
