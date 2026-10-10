import pytest

from physiocoach.core import phrases
from physiocoach.core.coach_rules import (
    live_cue_ids, next_more_reps, render_note, rule_note, rule_note_ids, split_sentences,
)
from physiocoach.core.rep_engine import Rep
from physiocoach.core.scoring import SetMetrics


def metrics(avg=48.0, done=10, planned=10, fast=0, target=60) -> SetMetrics:
    return SetMetrics(done, planned, target, avg, avg, avg, 2.5, fast, 0.0, [])


# ---------- live cues ----------

def test_count_only_when_deep_enough_and_slow():
    assert live_cue_ids(Rep(3, 58, 2.5, False), 60, "flex") == ["count.03"]


def test_depth_cue_below_target_minus_8():
    assert live_cue_ids(Rep(1, 51.9, 2.5, False), 60, "flex") == ["count.01", "cue.bend_more"]
    assert live_cue_ids(Rep(1, 52.0, 2.5, False), 60, "flex") == ["count.01"]


def test_slow_cue_when_fast_and_deep_enough():
    assert live_cue_ids(Rep(10, 60, 1.2, True), 60, "flex") == ["count.10", "cue.slow"]


def test_depth_wins_over_tempo():
    assert live_cue_ids(Rep(2, 40, 1.2, True), 60, "flex") == ["count.02", "cue.bend_more"]


def test_direct_mode_uses_raise_verb():
    assert live_cue_ids(Rep(5, 60, 2.5, False), 90, "direct") == ["count.05", "cue.raise_more"]


# ---------- rule note ----------

DEMO_EN = "Good effort, you bent to 48° on average, but the target is 60°. Next: do 3 more reps, slowly."
DEMO_ML = ("നല്ല ശ്രമം, നിങ്ങൾ ശരാശരി 48 ഡിഗ്രി വരെ മടക്കി, പക്ഷേ ലക്ഷ്യം 60 ഡിഗ്രി ആണ്. "
           "ഇനി 3 തവണ കൂടി പതുക്കെ ചെയ്യൂ.")


def test_demo_note():
    m = metrics()
    assert rule_note_ids(m, "flex") == ["note.good_effort", "note.achieved_bend.48", "note.target.60",
                                        "note.more_reps.3"]
    note = rule_note(m, "flex")
    assert note["en"] == DEMO_EN
    assert note["ml"] == phrases.nfc(DEMO_ML)


def test_near_target_branch():
    assert rule_note_ids(metrics(avg=55), "flex") == ["note.well_done", "note.achieved_bend.55", "note.target.60",
                                                      "note.keep_reps.10"]


def test_target_reached_branch():
    assert rule_note_ids(metrics(avg=62), "flex") == ["note.well_done", "note.achieved_bend.62",
                                                      "note.target_reached.60", "note.keep_reps.10"]
    assert render_note(rule_note_ids(metrics(avg=62), "flex"))["en"] == (
        "Well done, you bent to 62° on average, and you reached the target of 60°. "
        "Next time, do 10 reps the same way, slowly.")


def test_target_reached_but_fast():
    assert rule_note_ids(metrics(avg=62, fast=4), "flex") == [
        "note.well_done", "note.achieved_bend.62", "note.target_reached.60", "note.too_fast", "note.more_reps.3"]


def test_short_and_fast():
    assert rule_note_ids(metrics(avg=40, fast=2), "flex")[-2:] == ["note.too_fast", "note.more_reps.3"]


def test_zero_reps():
    assert rule_note_ids(metrics(avg=0, done=0), "flex") == ["note.no_reps"]


def test_reps_short_of_planned_capped_at_10():
    assert next_more_reps(metrics(done=4, planned=10)) == 6
    assert next_more_reps(metrics(done=2, planned=30)) == 10
    assert rule_note_ids(metrics(avg=62, done=7, planned=10), "flex")[-1] == "note.more_reps.3"


def test_direct_mode_note_uses_raise():
    assert rule_note_ids(metrics(avg=70, target=90), "direct")[1] == "note.achieved_raise.70"


BRANCHES = [
    metrics(), metrics(avg=55), metrics(avg=62), metrics(avg=62, fast=4), metrics(avg=40, fast=2),
    metrics(avg=0, done=0), metrics(avg=62, done=7), metrics(avg=70, target=90),
]


@pytest.mark.parametrize("m", BRANCHES)
@pytest.mark.parametrize("mode", ["flex", "direct"])
def test_every_branch_renders_two_to_three_sentences_and_known_ids(m, mode):
    ids = rule_note_ids(m, mode)
    for i in ids:
        assert i in phrases.catalogue()
    note = render_note(ids)
    for text in (note["ml"], note["en"]):
        assert 2 <= len(split_sentences(text)) <= 3, text


def test_sentence_splitter_ignores_decimal_points():
    assert split_sentences("Aim for 2.5 seconds per rep. Good!") == ["Aim for 2.5 seconds per rep", "Good"]
    assert split_sentences("ഒന്ന്। രണ്ട്.") == ["ഒന്ന്", "രണ്ട്"]
