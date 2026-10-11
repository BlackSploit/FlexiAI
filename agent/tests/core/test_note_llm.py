import asyncio
import json
import time
from types import SimpleNamespace

import pytest

from physiocoach.core import note_llm
from physiocoach.core.coach_rules import rule_note
from physiocoach.core.scoring import SetMetrics

DEMO = SetMetrics(10, 10, 60, 48.0, 50.0, 46.0, 2.5, 0, 88.0, [])
METRICS = note_llm.note_metrics(DEMO, "knee_bend", "flex", 2.0)
RULE = rule_note(DEMO, "flex")

GOOD_ML = "നല്ല ശ്രമം, നിങ്ങൾ ശരാശരി 48 ഡിഗ്രി വരെ മടക്കി, ലക്ഷ്യം 60 ഡിഗ്രി ആണ്. ഇനി 3 തവണ കൂടി പതുക്കെ ചെയ്യൂ."
GOOD_EN = "Good effort: you bent to 48 degrees on average against a target of 60 degrees. Next, do 3 more reps slowly."
GOOD = {"ml": GOOD_ML, "en": GOOD_EN}

_UNSET = object()


class FakeCompletions:
    """Stands in for client.chat.completions; records every request, never touches the network."""

    def __init__(self, content=None, finish_reason="stop", refusal=None, delay=0.0, raises=None, choices=_UNSET):
        self.content, self.finish_reason, self.refusal = content, finish_reason, refusal
        self.delay, self.raises, self.choices = delay, raises, choices
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.raises is not None:
            raise self.raises
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.choices is not _UNSET:
            return SimpleNamespace(choices=self.choices)
        message = SimpleNamespace(role="assistant", content=self.content, refusal=self.refusal)
        return SimpleNamespace(choices=[SimpleNamespace(index=0, finish_reason=self.finish_reason, message=message)])


def fake_client(monkeypatch, payload=None, **kw) -> FakeCompletions:
    text = payload if isinstance(payload, str) or payload is None else json.dumps(payload, ensure_ascii=False)
    completions = FakeCompletions(text, **kw)
    client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    monkeypatch.setattr(note_llm, "_client", lambda: client)
    return completions


@pytest.fixture(autouse=True)
def api_key(monkeypatch):
    for name in ("NOTE_LLM_MODEL", "NOTE_LLM_TIMEOUT_S", "OPENAI_MODEL", "OPENAI_REASONING_EFFORT"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("NOTE_LLM_ENABLED", "true")


async def test_valid_note_is_used(monkeypatch):
    fake_client(monkeypatch, GOOD)
    note, source = await note_llm.post_set_note(METRICS, RULE)
    assert source == "llm" and note == GOOD


async def test_request_shape(monkeypatch):
    fake = fake_client(monkeypatch, GOOD)
    await note_llm.post_set_note(METRICS, RULE)
    req = fake.calls[0]
    assert req["model"] == "gpt-5-mini"
    assert req["reasoning_effort"] == "minimal"
    assert req["max_completion_tokens"] == 800
    assert "temperature" not in req and "max_tokens" not in req
    rf = req["response_format"]
    assert rf["type"] == "json_schema"
    assert rf["json_schema"]["strict"] is True and rf["json_schema"]["schema"] == note_llm.NOTE_SCHEMA
    assert rf["json_schema"]["name"]
    system, user = req["messages"]
    assert system == {"role": "system", "content": note_llm.SYSTEM}
    assert user["role"] == "user"
    sent = json.loads(user["content"])
    assert sent == METRICS and "name" not in sent           # metrics only, no personal data


@pytest.mark.parametrize("model", ["gpt-4.1-mini", "gpt-4o"])
async def test_effort_omitted_for_non_reasoning_models(monkeypatch, model):
    monkeypatch.setenv("OPENAI_MODEL", model)
    fake = fake_client(monkeypatch, GOOD)
    _, source = await note_llm.post_set_note(METRICS, RULE)
    assert source == "llm"
    assert fake.calls[0]["model"] == model and "reasoning_effort" not in fake.calls[0]


@pytest.mark.parametrize("model", ["gpt-5", "gpt-5-mini", "gpt-5.2", "o4-mini", "o3"])
def test_effort_sent_for_reasoning_models(monkeypatch, model):
    monkeypatch.setenv("OPENAI_MODEL", model)
    assert note_llm.build_request(METRICS)["reasoning_effort"] == "minimal"


@pytest.mark.parametrize(("value", "expected"), [("low", "low"), ("", "minimal"), ("  ", "minimal"),
                                                 ("omit", None)])
def test_effort_env(monkeypatch, value, expected):
    monkeypatch.setenv("OPENAI_REASONING_EFFORT", value)
    assert note_llm.build_request(METRICS).get("reasoning_effort") == expected


@pytest.mark.parametrize("kw", [
    {"finish_reason": "length"},
    {"finish_reason": "content_filter"},
    {"refusal": "I can't help with that."},
])
async def test_incomplete_or_refused_completion_falls_back(monkeypatch, kw):
    fake_client(monkeypatch, GOOD, **kw)
    assert await note_llm.post_set_note(METRICS, RULE) == (RULE, "rules")


@pytest.mark.parametrize("content", [None, "", "   "])
async def test_empty_content_falls_back(monkeypatch, content):
    fake_client(monkeypatch, content)
    assert await note_llm.post_set_note(METRICS, RULE) == (RULE, "rules")


async def test_no_choice_falls_back(monkeypatch):
    fake_client(monkeypatch, GOOD, choices=[])
    assert await note_llm.post_set_note(METRICS, RULE) == (RULE, "rules")


async def test_api_connection_error_falls_back(monkeypatch):
    openai = pytest.importorskip("openai")
    import httpx
    err = openai.APIConnectionError(request=httpx.Request("POST", "https://api.openai.com/v1/chat/completions"))
    fake_client(monkeypatch, raises=err)
    assert await note_llm.post_set_note(METRICS, RULE) == (RULE, "rules")


async def test_any_exception_falls_back(monkeypatch):
    fake_client(monkeypatch, raises=RuntimeError("boom"))
    assert await note_llm.post_set_note(METRICS, RULE) == (RULE, "rules")


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
    fake_client(monkeypatch, GOOD, delay=1.0)
    assert await note_llm.post_set_note(METRICS, RULE) == (RULE, "rules")


@pytest.mark.parametrize(("value", "expected"), [("", 3.5), ("abc", 3.5), ("0", 3.5), ("-1", 3.5),
                                                 ("nan", 3.5), ("2.5", 2.5)])
def test_timeout_env_falls_back_to_default(monkeypatch, value, expected):
    monkeypatch.setenv("NOTE_LLM_TIMEOUT_S", value)
    assert note_llm._timeout_s() == expected


@pytest.mark.parametrize("kw", [
    {"payload": "not json"},
    {"payload": GOOD, "refusal": "no"},
    {"payload": GOOD, "finish_reason": "length"},
    {"payload": {"ml": GOOD_ML, "en": GOOD_EN + " See a doctor."}},
])
async def test_rule_fallback_is_instant(monkeypatch, kw):
    fake_client(monkeypatch, kw.pop("payload"), **kw)
    t0 = time.perf_counter()
    note, source = await note_llm.post_set_note(METRICS, RULE)
    assert (note, source) == (RULE, "rules")
    assert note is RULE                                      # the precomputed rule note, not rebuilt
    assert time.perf_counter() - t0 < 0.1


@pytest.mark.parametrize(("note_model", "openai_model", "expected"), [
    (None, None, "gpt-5-mini"),
    (None, "gpt-5", "gpt-5"),
    ("gpt-4.1-mini", "gpt-5", "gpt-4.1-mini"),               # NOTE_LLM_MODEL wins
    ("", "gpt-5", "gpt-5"),                                  # empty means unset
    (None, "", "gpt-5-mini"),                                # empty OPENAI_MODEL -> default
    ("", "", "gpt-5-mini"),
])
async def test_model_env_precedence(monkeypatch, note_model, openai_model, expected):
    for name, value in (("NOTE_LLM_MODEL", note_model), ("OPENAI_MODEL", openai_model)):
        if value is not None:
            monkeypatch.setenv(name, value)
    fake = fake_client(monkeypatch, GOOD)
    await note_llm.post_set_note(METRICS, RULE)
    assert fake.calls[0]["model"] == expected


@pytest.mark.parametrize("key", [None, "", "  "])
async def test_no_api_key_skips_the_network(monkeypatch, key):
    if key is None:
        monkeypatch.delenv("OPENAI_API_KEY")
    else:
        monkeypatch.setenv("OPENAI_API_KEY", key)
    fake = fake_client(monkeypatch, GOOD)
    assert await note_llm.post_set_note(METRICS, RULE) == (RULE, "rules")
    assert not fake.calls


async def test_disabled_flag_skips_the_network(monkeypatch):
    monkeypatch.setenv("NOTE_LLM_ENABLED", "false")
    fake = fake_client(monkeypatch, GOOD)
    assert await note_llm.post_set_note(METRICS, RULE) == (RULE, "rules")
    assert not fake.calls


def test_metrics_input_suggested_next_step():
    assert METRICS["suggestedNextStep"] == {"moreReps": 3, "slowly": True}
    assert METRICS["verb"] == "bend" and METRICS["avgPeak"] == 48
    done = SetMetrics(10, 10, 60, 62.0, 64.0, 60.0, 2.5, 0, 100.0, [])
    assert note_llm.note_metrics(done, "shoulder_raise", "direct", 2.0)["suggestedNextStep"] == {
        "keepReps": 10, "slowly": True}


async def test_rules_path_never_builds_a_client(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY")
    monkeypatch.setattr(note_llm, "_CLIENT", None)
    assert await note_llm.post_set_note(METRICS, RULE) == (RULE, "rules")
    assert note_llm._CLIENT is None


def test_client_is_built_lazily(monkeypatch):
    openai = pytest.importorskip("openai")
    monkeypatch.setattr(note_llm, "_CLIENT", None)
    c = note_llm._client()
    assert isinstance(c, openai.AsyncOpenAI) and note_llm._client() is c
    assert c.max_retries == 0
