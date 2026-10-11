"""Deterministic voice spotter for the live coach (D4): runs on every FINAL user transcript, in every phase.

`match(text)` returns "stop" | "chest_pain" | "dizziness" | "sharp_pain" | None. It is a convenience
path next to the on-screen Stop button (which stays the primary safety control).

* NFC-normalised, lower-cased; English triggers must start at a word boundary, Malayalam triggers are
  stems matched inside a word (Malayalam inflects by suffix: നിർത്ത് / നിർത്തൂ / നിർത്തണം).
* Negation guard: "no / not / don't / never ..." up to 2 tokens before the trigger, or ഇല്ല / illa up to
  2 tokens after it (also as a suffix on the same word: തലകറക്കമില്ല = "no dizziness").
* Bare "pain" / വേദന never halts: pain is reported as a number (report_pain) or with the buttons.

REVIEW ml: the Malayalam stems below need a native-speaker check.
"""

import re
import unicodedata
from typing import Optional

TRIGGERS: dict[str, tuple[str, ...]] = {
    "chest_pain": ("chest pain", "നെഞ്ചുവേദന", "നെഞ്ച് വേദന", "നെഞ്ചു വേദന", "nenju vedana", "nenjuvedana"),
    "dizziness": ("dizzy", "dizziness", "തലകറക്ക", "തല കറങ്ങ", "തലകറങ്ങ", "thala karang", "thalakarang"),
    "sharp_pain": ("sharp pain", "കഠിനമായ വേദന", "വല്ലാത്ത വേദന"),
    "stop": ("stop", "nirthu", "നിർത്ത", "can't breathe", "cannot breathe", "can not breathe",
             "ശ്വാസം മുട്ട"),
}
PRIORITY = ("chest_pain", "dizziness", "sharp_pain", "stop")       # most specific first

NEG_BEFORE = {"no", "not", "don't", "dont", "never", "didn't", "didnt", "doesn't", "doesnt", "isn't", "isnt",
              "won't", "wont", "without", "nothing"}
NEG_AFTER = ("ഇല്ല", "illa", "വേണ്ട", "venda")
NEG_SUFFIX = ("ില്ല", "ഇല്ല", "രുത")                 # -രുത്: "do not" (നിർത്തരുത്)

_ML_BLOCK = chr(0x0D00) + "-" + chr(0x0D7F)          # Malayalam letters, vowel signs, virama
_ZW = chr(0x200C) + chr(0x200D)                        # ZWNJ / ZWJ (chillu and conjunct control)
_PUNCT = re.compile(r"[^\w\s'" + _ML_BLOCK + _ZW + "]", re.UNICODE)
_QUOTES = {ord(chr(0x2019)): "'", ord(chr(0x2018)): "'"}


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFC", text or "").lower().translate(_QUOTES)
    return " ".join(_PUNCT.sub(" ", t).split())


def _is_latin(s: str) -> bool:
    return all(ord(c) < 0x0D00 for c in s)


def _occurrences(norm: str, trig: str):
    t = unicodedata.normalize("NFC", trig).lower()
    if _is_latin(t):
        for m in re.finditer(r"(?<![a-z0-9'])" + re.escape(t), norm):
            yield m.start(), m.end()
    else:
        start = norm.find(t)
        while start != -1:
            yield start, start + len(t)
            start = norm.find(t, start + 1)


def _negated(norm: str, start: int, end: int) -> bool:
    before = norm[:start].split()
    if any(tok in NEG_BEFORE for tok in before[-2:]):
        return True
    rest_of_word = norm[end:].split(" ", 1)[0]
    if any(s in rest_of_word for s in NEG_SUFFIX):
        return True
    after = norm[end:].split()
    after = after[1:] if norm[end:end + 1] not in (" ", "") else after     # skip the trigger word's tail
    return any(tok.startswith(n) for tok in after[:2] for n in NEG_AFTER)


def match(text: str) -> Optional[str]:
    norm = normalize(text)
    if not norm:
        return None
    for kind in PRIORITY:
        for trig in TRIGGERS[kind]:
            for s, e in _occurrences(norm, trig):
                if not _negated(norm, s, e):
                    return kind
    return None
