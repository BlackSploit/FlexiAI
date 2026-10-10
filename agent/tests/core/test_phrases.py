import json

import pytest

from physiocoach.core import phrases
from physiocoach.core.config import shared_dir

# Every fixed id the call flow speaks (§8.15, §9.1).
FLOW_IDS = [
    "intro.greet", "intro.watch", "consent.ask", "consent.thanks", "pos.side", "pos.front", "pos.leg_in_frame",
    "pos.arm_in_frame", "pos.step_back", "pos.light", "pos.cant_see", "pos.ok", "cd.ready", "cd.start",
    "cue.bend_more", "cue.raise_more", "cue.slow", "set.done", "set.rest", "note.no_reps", "note.too_fast",
    "pain.ask", "pain.thanks", "safety.stop", "physio.joined", "bye", "zero", "resume",
] + [f"count.{n:02d}" for n in range(1, 31)]


@pytest.mark.parametrize("pid", FLOW_IDS)
def test_flow_ids_exist(pid):
    p = phrases.get(pid)
    assert p.ml and p.en


def test_parametrised_ids_expand_within_range():
    assert phrases.get("note.achieved_bend.48").en == "you bent to 48° on average,"
    assert phrases.get("note.target.10").ml.startswith("പക്ഷേ ലക്ഷ്യം 10")
    assert phrases.get("note.keep_reps.30").en == "Next time, do 30 reps the same way, slowly."
    for bad in ("note.target.9", "note.target.181", "note.more_reps.11", "note.target.060", "note.target.x",
                "nope", "count.31"):
        with pytest.raises(KeyError):
            phrases.get(bad)
        assert bad not in phrases.catalogue()


def test_expand_all_is_complete_and_unique():
    data = json.loads((shared_dir() / "phrases.json").read_text(encoding="utf-8"))
    fixed = [e for e in data["phrases"] if "params" not in e]
    expected = len(fixed) + 181 * 2 + 171 * 2 + 10 + 30
    ids = [p.id for p in phrases.expand_all()]
    assert len(ids) == expected == len(set(ids))


def test_text_is_nfc_and_review_pending():
    for p in phrases.expand_all():
        assert p.ml == phrases.nfc(p.ml) and p.en == phrases.nfc(p.en)
        assert p.review == "pending"          # nothing is approved until the native-speaker review


def test_duplicate_and_multi_param_entries_are_rejected(tmp_path):
    dup = tmp_path / "dup.json"
    dup.write_text(json.dumps({"version": 1, "phrases": [
        {"id": "a", "category": "x", "ml": "x", "en": "x"}, {"id": "a", "category": "x", "ml": "y", "en": "y"}]}),
        encoding="utf-8")
    with pytest.raises(ValueError):
        phrases.Catalogue(dup)
    multi = tmp_path / "multi.json"
    multi.write_text(json.dumps({"version": 1, "phrases": [
        {"id": "b", "category": "x", "ml": "{N}{K}", "en": "{N}{K}", "params": {"N": [0, 1], "K": [0, 1]}}]}),
        encoding="utf-8")
    with pytest.raises(ValueError):
        phrases.Catalogue(multi)
