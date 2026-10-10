"""MediaPipe PoseLandmarker backend (default, `POSE_BACKEND=mediapipe`), VIDEO running mode, one person."""

import os

import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from .base import Keypoints, landmarks_to_keypoints, models_dir


class MediaPipeBackend:
    name = "mediapipe"

    def __init__(self, model: str | None = None):
        variant = model or os.getenv("POSE_MEDIAPIPE_MODEL", "pose_landmarker_full")
        path = models_dir() / f"{variant}.task"
        options = vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(path)),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
        )
        self.name = f"mediapipe:{variant}"
        self._landmarker = vision.PoseLandmarker.create_from_options(options)
        self._last_t_ms = -1

    def infer(self, rgb: np.ndarray, t_ms: int) -> Keypoints | None:
        t_ms = max(t_ms, self._last_t_ms + 1)           # VIDEO mode requires strictly increasing timestamps
        self._last_t_ms = t_ms
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        result = self._landmarker.detect_for_video(image, t_ms)
        if not result.pose_landmarks:
            return None
        h, w = rgb.shape[:2]
        return landmarks_to_keypoints(result.pose_landmarks[0], w, h)

    def close(self) -> None:
        self._landmarker.close()
