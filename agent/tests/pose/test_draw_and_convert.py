"""Pose helpers and the tile renderer. Needs cv2 (Docker test image); skipped in the native core run."""

from types import SimpleNamespace

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")

from physiocoach.pose.base import COCO_INDEX, MEDIAPIPE_INDEX, coco_to_keypoints, landmarks_to_keypoints  # noqa: E402
from physiocoach.pose.draw import OverlayState, draw_overlay, letterbox, placeholder_frame  # noqa: E402


def lm(x, y, vis=0.9, pres=0.8):
    return SimpleNamespace(x=x, y=y, z=0.0, visibility=vis, presence=pres)


def test_mediapipe_conversion_uses_min_conf_and_zeroes_off_frame():
    lms = [lm(0.5, 0.5) for _ in range(33)]
    lms[MEDIAPIPE_INDEX["left_ankle"]] = lm(0.5, 1.07, vis=0.95, pres=0.95)    # extrapolated off-frame
    kp = landmarks_to_keypoints(lms, 1280, 720)
    assert kp["left_knee"] == (640.0, 360.0, 0.8)                              # min(visibility, presence)
    assert kp["left_ankle"][2] == 0.0


def test_mediapipe_conversion_without_presence_field():
    lms = [SimpleNamespace(x=0.1, y=0.2, visibility=0.7) for _ in range(33)]
    assert landmarks_to_keypoints(lms, 100, 100)["right_hip"] == pytest.approx((10.0, 20.0, 0.7))


def test_coco_conversion_and_wrist_labels():
    arr = np.zeros((17, 3), dtype=np.float32)
    arr[9] = (11, 12, 0.9)                     # COCO 9 is the LEFT wrist (the YOLO plugin mislabels it)
    kp = coco_to_keypoints(arr)
    assert kp["left_wrist"] == pytest.approx((11.0, 12.0, 0.9))
    assert len(kp) == len(COCO_INDEX) == 12


def test_letterbox_keeps_aspect():
    canvas, scale, dx, dy = letterbox(np.full((720, 960, 3), 200, np.uint8), 960, 540)
    assert canvas.shape == (540, 960, 3)
    assert scale == pytest.approx(0.75) and dy == 0 and dx == 120
    assert canvas[270, 0].tolist() == [0, 0, 0] and canvas[270, 480].tolist() == [200, 200, 200]


def test_draw_overlay_shapes_and_marks():
    rgb = np.zeros((720, 1280, 3), np.uint8)
    kp = {"left_hip": (600, 200, 0.9), "left_knee": (600, 400, 0.9), "left_ankle": (700, 560, 0.9)}
    st = OverlayState(banner="Set", reps=3, reps_planned=10, set_index=1, sets_planned=2, target=60,
                      value=48, rep_peak=50, raw_angle=132, side="left", joints=("hip", "knee", "ankle"))
    out = draw_overlay(rgb, kp, st, 960, 540)
    assert out.shape == (540, 960, 3) and out.dtype == np.uint8
    assert out.any()
    halted = draw_overlay(rgb, None, OverlayState(halted=True), 640, 360)
    assert halted[180, 4].tolist() == [220, 38, 38]                          # red stop banner, left edge


def test_placeholder_is_cached_and_never_contains_input():
    a = placeholder_frame(960, 540)
    assert a is placeholder_frame(960, 540, OverlayState.idle())
    assert a.shape == (540, 960, 3) and not a.flags.writeable
