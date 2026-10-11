import pytest

from physiocoach.call.voice_safety import match, normalize


@pytest.mark.parametrize("text,kind", [
    ("Stop!", "stop"),
    ("please STOP now", "stop"),
    ("നിർത്തൂ", "stop"),
    ("നിർത്ത്", "stop"),
    ("nirthu", "stop"),
    ("I can't breathe", "stop"),
    ("I can’t breathe", "stop"),                       # typographic apostrophe
    ("ശ്വാസം മുട്ടുന്നു", "stop"),
    ("I have chest pain", "chest_pain"),
    ("നെഞ്ചുവേദന", "chest_pain"),
    ("നെഞ്ച് വേദനിക്കുന്നു", "chest_pain"),
    ("nenju vedana", "chest_pain"),
    ("I feel dizzy", "dizziness"),
    ("some dizziness", "dizziness"),
    ("എനിക്ക് തല കറങ്ങുന്നു", "dizziness"),
    ("തലകറക്കം ഉണ്ട്", "dizziness"),
    ("thala karangunnu", "dizziness"),
    ("a sharp pain in my knee", "sharp_pain"),
    ("കഠിനമായ വേദന", "sharp_pain"),
    ("stop, my chest pain is bad", "chest_pain"),           # the most specific kind wins
])
def test_triggers(text, kind):
    assert match(text) == kind


@pytest.mark.parametrize("text", [
    "", "pain", "വേദന", "my knee has some pain", "ചെറിയ വേദന",       # bare pain never halts
    "I don't feel dizzy", "no chest pain", "not dizzy at all", "don't stop", "never stop",
    "തലകറക്കമില്ല", "തല കറങ്ങുന്നില്ല", "നെഞ്ചുവേദന ഇല്ല", "നിർത്തരുത്", "നിർത്തണ്ട വേണ്ട",
    "nonstop", "I am ready", "ഞാൻ തയ്യാറാണ്",
])
def test_no_trigger(text):
    assert match(text) is None


def test_normalize_is_nfc_lowercase_and_strips_punctuation():
    assert normalize("  STOP!!  now?? ") == "stop now"
    decomposed = "നിർത്ത"                 # already NFC; stays intact
    assert normalize(decomposed) == decomposed
