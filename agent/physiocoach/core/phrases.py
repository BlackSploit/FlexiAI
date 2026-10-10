"""Phrase catalogue (§8.8): `id -> Phrase(ml, en, category)`, loaded from shared/phrases.json.

Parametrised entries (`"params": {"N": [lo, hi]}`) expand to concrete ids `"<id>.<value>"`
over the inclusive range, e.g. `note.achieved_bend.48`.
"""

import json
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterator


@dataclass(frozen=True)
class Phrase:
    id: str
    ml: str
    en: str
    category: str
    review: str = "pending"


def nfc(s: str) -> str:
    """Malayalam chillu letters and ZWJ/ZWNJ variants hash differently unless NFC-normalised."""
    return unicodedata.normalize("NFC", s).strip()


@dataclass(frozen=True)
class _Template:
    entry: dict
    param: str
    lo: int
    hi: int

    def render(self, value: int) -> Phrase:
        token = "{" + self.param + "}"
        e = self.entry
        return Phrase(f"{e['id']}.{value}", nfc(e["ml"].replace(token, str(value))),
                      nfc(e["en"].replace(token, str(value))), e["category"], e.get("review", "pending"))


class Catalogue:
    def __init__(self, path: Path | None = None):
        if path is None:
            from .config import shared_dir
            path = shared_dir() / "phrases.json"
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        self.version: int = data["version"]
        self._fixed: dict[str, Phrase] = {}
        self._templates: dict[str, _Template] = {}
        for e in data["phrases"]:
            if e["id"] in self._fixed or e["id"] in self._templates:
                raise ValueError(f"duplicate phrase id {e['id']}")
            params = e.get("params")
            if params:
                if len(params) != 1:
                    raise ValueError(f"{e['id']}: exactly one parameter supported")
                (name, (lo, hi)), = params.items()
                self._templates[e["id"]] = _Template(e, name, int(lo), int(hi))
            else:
                self._fixed[e["id"]] = Phrase(e["id"], nfc(e["ml"]), nfc(e["en"]), e["category"],
                                              e.get("review", "pending"))

    def get(self, phrase_id: str) -> Phrase:
        """Raises KeyError on unknown ids (including out-of-range parameters)."""
        if phrase_id in self._fixed:
            return self._fixed[phrase_id]
        base, _, raw = phrase_id.rpartition(".")
        tpl = self._templates.get(base)
        if tpl and raw.isdigit() and str(int(raw)) == raw and tpl.lo <= int(raw) <= tpl.hi:
            return tpl.render(int(raw))
        raise KeyError(phrase_id)

    def __contains__(self, phrase_id: str) -> bool:
        try:
            self.get(phrase_id)
            return True
        except KeyError:
            return False

    def expand_all(self) -> Iterator[Phrase]:
        """Every concrete phrase the coach can emit (renderer and voice contract test use this)."""
        yield from self._fixed.values()
        for tpl in self._templates.values():
            for v in range(tpl.lo, tpl.hi + 1):
                yield tpl.render(v)


@lru_cache(maxsize=1)
def catalogue() -> Catalogue:
    return Catalogue()


def get(phrase_id: str) -> Phrase:
    return catalogue().get(phrase_id)


def expand_all() -> Iterator[Phrase]:
    return catalogue().expand_all()
