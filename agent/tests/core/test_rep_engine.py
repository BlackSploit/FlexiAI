import pytest

from physiocoach.core.exercises import load_exercises
from physiocoach.core.rep_engine import RepEngine, RepRejected
from physiocoach.replay import synthetic
from physiocoach.replay.cli import run_set

EX = load_exercises()
KNEE = EX["knee_bend"]


def run(frames, exercise=KNEE, target=60, reps=10, min_seconds=2.0):
    data = [(f.t, synthetic.keypoints(f, exercise.joints, exercise.mode)) for f in frames]
    return run_set(data, exercise, target, reps, min_seconds)


def test_clean_ten_reps():
    r = run(synthetic.clean())
    assert r.metrics.reps_done == 10 and r.metrics.fast_reps == 0
    assert r.metrics.avg_peak == pytest.approx(65, abs=1.5)
    assert not r.rejected


def test_fast_reps_count_but_are_too_fast():
    r = run(synthetic.fast())
    assert r.metrics.reps_done == 10 and r.metrics.fast_reps == 10


def test_shallow_reps_are_rejected():
    r = run(synthetic.shallow())
    assert r.metrics.reps_done == 0
    assert [x["reason"] for x in r.rejected] == ["shallow"] * 10


def test_too_short_excursions_are_rejected():
    r = run(synthetic.too_short())
    assert r.metrics.reps_done == 0
    assert r.rejected and all(x["reason"] == "too_short" for x in r.rejected)


def test_jitter_keeps_exact_count():
    assert run(synthetic.jitter(synthetic.clean(), amp=6, seed=42)).metrics.reps_done == 10


def test_short_dropouts_keep_count():
    assert run(synthetic.dropout(synthetic.clean())).metrics.reps_done == 10


def test_prebent_start_counts_nothing():
    r = run(synthetic.prebent())
    assert r.metrics.reps_done == 0 and not r.rejected


def test_long_dropout_discards_the_rep_then_recovers():
    r = run(synthetic.long_dropout())
    assert r.metrics.reps_done == 1              # only the normal rep after the held one


def test_boundary_duration_exactly_min_is_not_counted():
    e = RepEngine(15, 25, 35, 2)
    e.update(-1.0, 5)
    e.update(0.0, 40)
    ev = e.update(0.6, 5)                         # exactly 0.6 s: strict ">" rejects it
    assert isinstance(ev, RepRejected) and ev.reason == "too_short"
    assert e.reps == []


def test_boundary_peak_exactly_min_peak_is_counted():
    e = RepEngine(15, 25, 35, 2)
    e.update(0.0, 5)
    e.update(1.0, 35)
    rep = e.update(3.5, 5)                        # 2.5 s: slow enough
    assert rep.n == 1 and rep.peak == 35 and not rep.too_fast


def test_abort_in_progress_never_counts_and_disarms():
    e = RepEngine(15, 25, 35, 2)
    e.update(0.0, 5)
    e.update(1.0, 50)
    e.abort_in_progress()
    assert e.update(2.0, 5) is None and e.reps == []
    e2 = RepEngine(15, 25, 35, 2)
    e2.update(0.0, 5)
    e2.update(1.0, 50)
    e2.abort_in_progress()
    e2.update(2.0, 50)                            # still bent: disarmed, does not re-enter moving
    assert e2.state == "rest" and not e2.armed


def test_long_gap_while_moving_aborts():
    e = RepEngine(15, 25, 35, 2)
    e.update(0.0, 5)
    e.update(1.0, 50)
    assert e.update(4.5, 50) is None              # 3.5 s gap -> aborted, disarmed
    assert e.update(5.0, 5) is None and e.reps == []


def test_engine_requires_ordered_thresholds():
    with pytest.raises(AssertionError):
        RepEngine(25, 15, 35, 2)


def test_elbow_bend_clean_signal():
    ex = EX["elbow_bend"]
    r = run(synthetic.clean(peak=105), exercise=ex, target=100)
    assert r.metrics.reps_done == 10


def test_shoulder_raise_clean_signal_direct_mode():
    ex = EX["shoulder_raise"]
    r = run(synthetic.clean(peak=95), exercise=ex, target=90)
    assert r.metrics.reps_done == 10
    assert r.metrics.avg_peak == pytest.approx(95, abs=1.5)
