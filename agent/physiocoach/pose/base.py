"""Pose backend protocol and joint index maps (§8.3).

"left"/"right" are the SUBJECT's anatomical sides in both models. Backends never mirror coordinates.
"""

import os
from pathlib import Path
from typing import Callable, Mapping, Protocol, Sequence

import numpy as np

JOINTS = ("shoulder", "elbow", "wrist", "hip", "knee", "ankle")
# Named joint keys: "left_knee", "right_hip", ... -> (x_px, y_px, confidence 0..1)
Keypoints = Mapping[str, tuple[float, float, float]]

COCO_INDEX = {   # Ultralytics YOLO pose, 17 COCO keypoints
    "left_shoulder": 5, "right_shoulder": 6, "left_elbow": 7, "right_elbow": 8,
    "left_wrist": 9, "right_wrist": 10, "left_hip": 11, "right_hip": 12,
    "left_knee": 13, "right_knee": 14, "left_ankle": 15, "right_ankle": 16,
}
MEDIAPIPE_INDEX = {  # MediaPipe Pose, 33 landmarks
    "left_shoulder": 11, "right_shoulder": 12, "left_elbow": 13, "right_elbow": 14,
    "left_wrist": 15, "right_wrist": 16, "left_hip": 23, "right_hip": 24,
    "left_knee": 25, "right_knee": 26, "left_ankle": 27, "right_ankle": 28,
}
# Per side; plus shoulder-shoulder and hip-hip across the body.
SKELETON_EDGES = [("shoulder", "elbow"), ("elbow", "wrist"), ("shoulder", "hip"), ("hip", "knee"), ("knee", "ankle")]


class PoseBackend(Protocol):
    name: str

    def infer(self, rgb: np.ndarray, t_ms: int) -> Keypoints | None:
        """One person (the most confident / largest). Pixel coordinates in the INPUT frame. None if nobody."""

    def close(self) -> None: ...


def models_dir() -> Path:
    """`PC_MODELS_DIR` (Docker: /opt/models), else agent/models."""
    env = os.getenv("PC_MODELS_DIR")
    return Path(env) if env else Path(__file__).resolve().parents[2] / "models"


def landmarks_to_keypoints(landmarks: Sequence, width: int, height: int) -> dict[str, tuple[float, float, float]]:
    """MediaPipe normalised landmarks -> pixel keypoints.

    Confidence = min(visibility, presence) when presence exists. A landmark outside [0, 1] gets
    confidence 0: MediaPipe extrapolates off-frame joints (an ankle cut off at the bottom) with
    deceptively usable values.
    """
    out: dict[str, tuple[float, float, float]] = {}
    for name, i in MEDIAPIPE_INDEX.items():
        lm = landmarks[i]
        vis = getattr(lm, "visibility", None)
        pres = getattr(lm, "presence", None)
        conf = min(c for c in (vis, pres) if c is not None) if (vis is not None or pres is not None) else 0.0
        if not (0.0 <= lm.x <= 1.0 and 0.0 <= lm.y <= 1.0):
            conf = 0.0
        out[name] = (lm.x * width, lm.y * height, float(conf))
    return out


def coco_to_keypoints(kpts: np.ndarray) -> dict[str, tuple[float, float, float]]:
    """One person's (17, 3) COCO array (x_px, y_px, conf) -> named keypoints."""
    return {name: (float(kpts[i, 0]), float(kpts[i, 1]), float(kpts[i, 2])) for name, i in COCO_INDEX.items()}


def backend_factory_from_env() -> Callable[[], PoseBackend]:
    """`POSE_BACKEND` = mediapipe (default) | yolo. Returns a zero-arg factory (built in the worker thread)."""
    kind = os.getenv("POSE_BACKEND", "mediapipe")
    if kind == "yolo":
        from .yolo_backend import YoloBackend
        return YoloBackend
    if kind == "mediapipe":
        from .mediapipe_backend import MediaPipeBackend
        return MediaPipeBackend
    raise ValueError(f"unknown POSE_BACKEND {kind!r}")
