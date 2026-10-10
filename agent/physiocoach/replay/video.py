"""Video input for the offline replay (§8.17). Needs cv2 and a pose backend (Docker image).

Frames are read with the clip's own timestamps (CAP_PROP_POS_MSEC) and downsampled BY TIMESTAMP
to `fps` (keep a frame when t - last_t >= 1/fps): the EMA (0.6/0.4 per sample) has a different time
constant at 30 fps than at 12 fps, so offline results must use the live rate to validate the live
pipeline.
"""

from typing import Iterator

import cv2
import numpy as np

from ..core.exercises import Exercise
from ..pose.base import PoseBackend
from ..pose.draw import OverlayState, draw_overlay
from .cli import SetRun, run_set


def read_frames(path: str, fps: int) -> Iterator[tuple[float, np.ndarray]]:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise FileNotFoundError(path)
    last_t: float | None = None
    try:
        while True:
            ok, bgr = cap.read()
            if not ok:
                return
            t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            if last_t is not None and t - last_t < 1.0 / fps - 1e-6:
                continue
            last_t = t
            yield t, cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    finally:
        cap.release()


def make_backend(kind: str) -> PoseBackend:
    if kind == "yolo":
        from ..pose.yolo_backend import YoloBackend
        return YoloBackend()
    from ..pose.mediapipe_backend import MediaPipeBackend
    return MediaPipeBackend()


def run_video(path: str, exercise: Exercise, target: float, reps: int, min_seconds: float, side: str,
              fps: int, backend_kind: str, out: str | None = None, out_size: tuple[int, int] = (960, 540)) -> SetRun:
    backend = make_backend(backend_kind)
    writer = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*"mp4v"), fps, out_size) if out else None
    current: dict[str, np.ndarray] = {}

    def frames() -> Iterator[tuple[float, dict | None]]:
        for t, rgb in read_frames(path, fps):
            current["rgb"] = rgb
            yield t, backend.infer(rgb, int(t * 1000))

    def observer(t, kp, sample, engine) -> None:
        if writer is None:
            return
        st = OverlayState(
            banner=f"replay {backend.name}", reps=len(engine.reps), reps_planned=reps, set_index=1, sets_planned=1,
            target=target, value=sample.value if sample else None, raw_angle=sample.raw_angle if sample else None,
            rep_peak=engine.peak if engine.state == "moving" else None, side=sample.side if sample else None,
            joints=exercise.joints)
        img = draw_overlay(current["rgb"], kp, st, *out_size)
        writer.write(cv2.cvtColor(img, cv2.COLOR_RGB2BGR))

    try:
        return run_set(frames(), exercise, target, reps, min_seconds, side, observer)
    finally:
        backend.close()
        if writer:
            writer.release()
