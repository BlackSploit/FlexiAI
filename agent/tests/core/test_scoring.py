import pytest

from physiocoach.core.rep_engine import Rep
from physiocoach.core.scoring import compute_score, set_metrics


def test_worked_example_scores_88():
    reps = [Rep(i + 1, 48.0, 2.5, False) for i in range(10)]
    m = set_metrics(reps, planned=10, target=60)
    assert m.score == 88.0
    assert (m.avg_peak, m.best_peak, m.lowest_peak, m.avg_rep_seconds, m.fast_reps) == (48.0, 48.0, 48.0, 2.5, 0)
    assert m.per_rep[0] == {"peak": 48.0, "seconds": 2.5, "tooFast": False}


def test_zero_reps_scores_zero():
    m = set_metrics([], planned=10, target=60)
    assert m.score == 0.0 and m.reps_done == 0 and m.per_rep == []
    assert compute_score(50, 60, 0, 0, 10) == 0.0
    assert compute_score(50, 0, 0, 5, 10) == 0.0


def test_terms_cap_and_clamp():
    assert compute_score(80, 60, 0, 10, 10) == 100.0          # avgPeak above target caps at 1
    assert compute_score(60, 60, 10, 10, 10) == 75.0          # all fast: tempo term 0
    assert compute_score(60, 60, 0, 12, 10) == 100.0          # reps above planned cap at 1
    assert 0 <= compute_score(1, 180, 3, 3, 30) <= 100


def test_metrics_mixed_reps():
    reps = [Rep(1, 50, 2.0, False), Rep(2, 40, 1.5, True), Rep(3, 60, 3.0, False)]
    m = set_metrics(reps, planned=5, target=60)
    assert m.avg_peak == 50.0 and m.best_peak == 60.0 and m.lowest_peak == 40.0
    assert m.fast_reps == 1 and m.avg_rep_seconds == pytest.approx(2.17, abs=0.01)
