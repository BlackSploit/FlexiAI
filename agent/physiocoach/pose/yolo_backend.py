"""Ultralytics YOLO pose backend (`POSE_BACKEND=yolo`), called directly (DEV-13).

Vision Agents' YOLOPoseProcessor discards keypoints, handles only person 0, has no participant
filter and mislabels the wrists, so we read `r.keypoints.data` ourselves.
"""

import os

import numpy as np
from ultralytics import YOLO

from .base import Keypoints, coco_to_keypoints, models_dir


class YoloBackend:
    name = "yolo"

    def __init__(self, weights: str | None = None, imgsz: int = 640):
        path = models_dir() / (weights or os.getenv("POSE_YOLO_WEIGHTS", "yolo26n-pose.pt"))
        self.name = f"yolo:{path.stem}"
        self._model = YOLO(str(path))
        self._imgsz = imgsz

    def infer(self, rgb: np.ndarray, t_ms: int) -> Keypoints | None:
        # Ultralytics treats numpy input as BGR (OpenCV convention).
        bgr = np.ascontiguousarray(rgb[..., ::-1])
        r = self._model(bgr, verbose=False, device="cpu", imgsz=self._imgsz)[0]
        if r.keypoints is None or r.boxes is None or len(r.boxes) == 0:
            return None
        conf = r.boxes.conf.cpu().numpy()
        wh = r.boxes.xywh.cpu().numpy()[:, 2:4]
        best = int(np.argmax(conf * wh[:, 0] * wh[:, 1]))     # most confident x largest person
        return coco_to_keypoints(r.keypoints.data[best].cpu().numpy())

    def close(self) -> None:
        pass
