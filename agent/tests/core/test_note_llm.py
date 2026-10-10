import asyncio
import json
from types import SimpleNamespace

import anthropic
import pytest

from physiocoach.core import note_llm
from physiocoach.core.coach_rules import rule_note
from physiocoach.core.scoring import SetMetrics

DEMO = SetMetrics(10, 10, 60, 48.0, 50.0, 46.0, 2.5, 0, 88.0, [])
METRICS = note_llm.note_metrics(DEMO, "knee_bend", "flex", 2.0)
RULE = rule_note(DEMO, "flex")

GOOD_ML = "നല്ല ശ്രമം, നിങ്ങൾ ശരാശരി 48 ഡിഗ്രി വരെ മടക്കി, ലക്ഷ്യം 60 ഡിഗ്രി ആണ്. ഇനി 3 തവണ കൂടി പതുക്കെ ചെയ്യൂ."
GOOD_EN = "Good effort: you bent to 48 degrees on average against a target of 60 degrees. Next, do 3 more reps slowly."


class FakeMessages:
    def __init__(self, text=None, stop_reason="end_turn", delay=0.0):
        self.text, self.stop_reason, self.delay = text, stop_reason, delay
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.delay:
            await asyncio.sleep(self.delay)
        content = [SimpleNamespace(type="thinking", thinking="")]
        if self.text is not None:
            content.append(SimpleNamespace(type="text", text=self.text))
        return SimpleNamespace(stop_reason=self.stop_reason, content=content)


def fake_client(monkeypatch, payload=None, **kw):
    text = payload if isinstance(payload, str) or payload is None else json.dumps(payload, ensure_ascii=False)
    beta, std = FakeMessages(text, **kw), FakeMessages(text, **kw)
    client = SimpleNamespace(beta=SimpleNamespace(messages=beta), messages=std)
    monkeypatch.setattr(note_llm, "_client", lambda: client)
    return beta, std


@pytest.fixture(autouse=True)
def api_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("NOTE_LLM_ENABLED", "true")
    monkeypatch.setenv("NOTE_LLM_SERVER_FALLBACK", "true")


async def test_valid_note_is_used(monkeypatch):
    beta, _ = fake_client(monkeypatch, {"ml": GOOD_ML, "en": GOOD_EN})
    note, source = await note_llm.post_set_note(METRICS, RULE)
    assert source == "llm" and note == {"ml": GOOD_ML, "en": GOOD_EN}


async def test_request_shape_with_server_fallback(monkeypatch):
    beta, std = fake_client(monkeypatch, {"ml": GOOD_ML, "en": GOOD_EN})
    await note_llm.post_set_note(METRICS, RULE)
    req = beta.calls[0]
    assert not std.calls
    assert req["model"] == "claude-sonnet-5-5"
    assert req["thinking"] == {"type": "between_tools"}
    assert req["output_config"]["effort"] == "low"
    assert req["output_config"]["format"]["type"] == "json_schema"
    assert req["betas"] == ["server-side-fallback-2026-07-01"] and req["fallbacks"] == "default"
    sent = json.loads(req["messages"][0]["content"])
    assert sent == METRICS and "name" not in sent           # metrics only, no personal data


async def test_without_server_fallback_uses_standard_endpoint(monkeypatch):
    monkeypatch.setenv("NOTE_LLM_SERVER_FALLBACK", "false")
    beta, std = fake_client(monkeypatch, {"ml": GOOD_ML, "en": GOOD_EN})
    _, source = await note_llm.post_set_note(METRICS, RULE)
    assert source == "llm" and not beta.calls
    assert "betas" not in std.calls[0] and "fallbacks" not in std.calls[0]


@pytest.mark.parametrize("payload", [
    "not json",
    {"ml": GOOD_ML, "en": GOOD_EN, "extra": "x"},                                         # extra keys
    {"ml": GOOD_ML, "en": GOOD_EN.replace("48", "52")},                                   # wrong number
    {"ml": GOOD_ML, "en": "Good effort at 48 degrees against 60 degrees."},               # 1 sentence
    {"ml": GOOD_ML, "en": "Good. You bent to 48 degrees. The target is 60. Do 3 more slowly."},   # 4 sentences
    {"ml": GOOD_ML, "en": GOOD_EN + " See a doctor if it hurts."},                        # deny-list
    {"ml": GOOD_ML + " മരുന്ന് കഴിക്കൂ.", "en": GOOD_EN},                                   # ml deny-list
    {"ml": "Good effort, you bent to 48 degrees. Next do 3 more.", "en": GOOD_EN},        # English in ml
    {"ml": "", "en": GOOD_EN},
])
async def test_invalid_outputs_fall_back_to_rules(monkeypatch, payload):
    fake_client(monkeypatch, payload)
    note, source = await note_llm.post_set_note(METRICS, RULE)
    assert (note, source) == (RULE, "rules")


async def test_correct_tempo_number_is_allowed(monkeypatch):
    fast = SetMetrics(10, 10, 60, 62.0, 64.0, 60.0, 1.4, 4, 90.0, [])
    metrics = note_llm.note_metrics(fast, "knee_bend", "flex", 2.0)
    en = "Well done, you reached the target of 60 degrees. Aim for 2 seconds per rep and do 3 more reps slowly."
    ml = "വളരെ നന്നായി, ലക്ഷ്യമായ 60 ഡിഗ്രി എത്തി. ഓരോ തവണയും 2 സെക്കൻഡ് എടുത്ത് 3 തവണ കൂടി പതുക്കെ ചെയ്യൂ."
    fake_client(monkeypatch, {"ml": ml, "en": en})
    _, source = await note_llm.post_set_note(metrics, rule_note(fast, "flex"))
    assert source == "llm"


async def test_timeout_falls_back(monkeypatch):
    monkeypatch.setenv("NOTE_LLM_TIMEOUT_S", "0.05")
    fake_client(monkeypatch, {"ml": GOOD_ML, "en": GOOD_EN}, delay=1.0)
    assert await note_llm.post_set_note(METRICS, RULE) == (RULE, "rules")


async def test_refusal_falls_back(monkeypatch):
    fake_client(monkeypatch, {"ml": GOOD_ML, "en": GOOD_EN}, stop_reason="refusal")
    assert await note_llm.post_set_note(METRICS, RULE) == (RULE, "rules")


async def test_no_api_key_skips_the_network(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    beta, std = fake_client(monkeypatch, {"ml": GOOD_ML, "en": GOOD_EN})
    assert await note_llm.post_set_note(METRICS, RULE) == (RULE, "rules")
    assert not beta.calls and not std.calls


async def test_disabled_flag_skips_the_network(monkeypatch):
    monkeypatch.setenv("NOTE_LLM_ENABLED", "false")
    beta, _ = fake_client(monkeypatch, {"ml": GOOD_ML, "en": GOOD_EN})
    assert await note_llm.post_set_note(METRICS, RULE) == (RULE, "rules")
    assert not beta.calls


def test_metrics_input_suggested_next_step():
    assert METRICS["suggestedNextStep"] == {"moreReps": 3, "slowly": True}
    assert METRICS["verb"] == "bend" and METRICS["avgPeak"] == 48
    done = SetMetrics(10, 10, 60, 62.0, 64.0, 60.0, 2.5, 0, 100.0, [])
    assert note_llm.note_metrics(done, "shoulder_raise", "direct", 2.0)["suggestedNextStep"] == {
        "keepReps": 10, "slowly": True}


def test_client_is_built_lazily(monkeypatch):
    monkeypatch.setattr(note_llm, "_CLIENT", None)
    c = note_llm._client()
    assert isinstance(c, anthropic.AsyncAnthropic) and note_llm._client() is c
