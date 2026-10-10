"""DEV ONLY pose backend (`POSE_BACKEND=synthetic`): ignores the video and emits keypoints from a
periodic synthetic knee-bend signal, so the whole live flow (positioning, countdown, reps, cues,
note, pain) can be exercised in a real call without a recorded clip.

SYNTHETIC_PEAK (default 48, the demo movement), SYNTHETIC_REP_S (2.5), SYNTHETIC_GAP_S (1.0).
"""

import os

import numpy as np

from ..replay import synthetic
from .base import Keypoints


class SyntheticBackend:
    def __init__(self) -> None:
        self.peak = float(os.getenv("SYNTHETIC_PEAK", "48"))
        self.move_s = float(os.getenv("SYNTHETIC_REP_S", "2.5")) + synthetic.MOVE_EXTRA_S
        self.gap_s = float(os.getenv("SYNTHETIC_GAP_S", "1.0"))
        self.name = f"synthetic:peak{self.peak:g}"
        self._t0: int | None = None

    def infer(self, rgb: np.ndarray, t_ms: int) -> Keypoints | None:
        if self._t0 is None:
            self._t0 = t_ms
        tau = ((t_ms - self._t0) / 1000.0) % (self.move_s + self.gap_s)
        value = synthetic._shape(tau, self.move_s, self.peak) if tau < self.move_s else synthetic.BASE
        kp = synthetic.keypoints(synthetic.Frame(0.0, value), ("hip", "knee", "ankle"), "flex")
        sx, sy = rgb.shape[1] / 1280.0, rgb.shape[0] / 720.0       # synthetic coords assume 1280x720
        return {k: (x * sx, y * sy, c) for k, (x, y, c) in kp.items()}

    def close(self) -> None:
        pass
