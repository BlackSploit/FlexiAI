import pytest

from physiocoach.core.angles import (
    AngleTracker, Ema, SideSelector, joint_angle, mode_value, normalised_to_px, side_confidence,
)
from physiocoach.core.rep_engine import RepEngine

KNEE = ("hip", "knee", "ankle")


def kp(side: str, conf: float, other_conf: float = 0.2, angle_pts=((0, -100), (0, 0), (100, 0))):
    other = "right" if side == "left" else "left"
    out = {}
    for j, (x, y) in zip(KNEE, angle_pts):
        out[f"{side}_{j}"] = (x, y, conf)
        out[f"{other}_{j}"] = (x, y, other_conf)
    return out


def test_joint_angle_basic_shapes():
    assert joint_angle((1, 0), (0, 0), (0, 1)) == pytest.approx(90)
    assert joint_angle((-1, 0), (0, 0), (1, 0)) == pytest.approx(180)
    assert joint_angle((1, 0), (0, 0), (1, 1e-4)) == pytest.approx(0, abs=0.01)
    assert joint_angle((0, 0), (0, 0), (1, 1)) is None


def test_pixel_space_differs_from_naive_normalised_math():
    w, h = 1280, 720
    a, b, c = (0.4, 0.3), (0.5, 0.5), (0.7, 0.6)
    naive = joint_angle(a, b, c)
    px = joint_angle(normalised_to_px(*a, w, h), normalised_to_px(*b, w, h), normalised_to_px(*c, w, h))
    assert naive == pytest.approx(143.13, abs=0.01)
    assert px == pytest.approx(147.35, abs=0.02)        # hand-computed: v1=(-128,-144), v2=(256,72)


def test_mode_value():
    assert mode_value(120, "flex") == 60
    assert mode_value(180, "flex") == 0
    assert mode_value(90, "direct") == 90


def test_ema_initialises_then_blends():
    e = Ema()
    assert e.update(0) == 0
    assert e.update(10) == pytest.approx(4.0)
    e.reset()
    assert e.value is None


def test_confidence_gate_skips_frame_without_touching_ema():
    tr = AngleTracker(KNEE, "flex", "left")
    assert tr.update(0.0, kp("left", 0.9)) is not None
    before = tr.ema.value
    low = kp("left", 0.9)
    low["left_ankle"] = (100, 0, 0.4)
    assert tr.update(0.1, low) is None
    assert tr.ema.value == before
    missing = kp("left", 0.9)
    del missing["left_knee"]
    assert tr.update(0.2, missing) is None
    assert tr.last_ok_t == 0.0


def test_tracker_gates_degenerate_geometry():
    tr = AngleTracker(KNEE, "flex", "left")
    assert tr.update(0.0, kp("left", 0.9, angle_pts=((0, 0), (0, 0), (1, 1)))) is None


def test_tracker_sample_value_is_smoothed_mode_value():
    tr = AngleTracker(KNEE, "flex", "left")
    s = tr.update(1.0, kp("left", 0.9))         # 90 degree knee -> flex value 90
    assert s.raw_angle == pytest.approx(90) and s.value == pytest.approx(90)
    assert s.side == "left" and s.min_conf == 0.9


def test_side_confidence_sums_the_three_joints():
    assert side_confidence(kp("left", 0.9), KNEE, "left") == pytest.approx(2.7)
    assert side_confidence({}, KNEE, "right") == 0


def test_side_selector_auto_locks_after_window():
    sel = SideSelector("auto", window=5)
    for _ in range(4):
        assert sel.observe(kp("right", 0.9), KNEE) == "right"
        assert sel.locked is None
    assert sel.observe(kp("right", 0.9), KNEE) == "right"
    assert sel.locked == "right"
    for _ in range(50):                          # the left side becomes clearer: the lock holds
        assert sel.observe(kp("left", 0.99, other_conf=0.0), KNEE) == "right"


def test_side_selector_fixed_ignores_confidence():
    sel = SideSelector("left")
    assert sel.observe(kp("right", 0.99, other_conf=0.0), KNEE) == "left"
    assert sel.force_lock() == "left"


def test_force_lock_with_partial_window():
    sel = SideSelector("auto", window=30)
    sel.observe(kp("right", 0.9), KNEE)
    assert sel.locked is None
    assert sel.force_lock() == "right"
    assert sel.observe(kp("left", 0.99, other_conf=0.0), KNEE) == "right"


def test_countdown_never_changes_the_locked_side_only_reset_repicks():
    tr = AngleTracker(KNEE, "flex", "auto")
    for i in range(3):
        tr.update(i / 12, kp("left", 0.9))
    assert tr.sides.force_lock() == "left"           # end of positioning
    tr.ema.reset()                                   # countdown: new EMA and RepEngine only
    RepEngine(15, 25, 35, 2)
    s = tr.update(1.0, kp("right", 0.99, other_conf=0.9))
    assert s.side == "left"
    tr.sides.reset()                                 # re-entering positioning (patient rejoined)
    assert tr.sides.locked is None
    assert tr.update(2.0, kp("right", 0.99, other_conf=0.1)).side == "right"
