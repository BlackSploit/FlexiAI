"""Pose backend benchmark and sanity check (dev only, Spike A tasks 4-5).

    python -m physiocoach.devtools.backend_bench [--image path] [--frames 60] [--size 960x540]

For each backend: ms/frame (p50/p95) at the input size, joints found, and an annotated PNG in
cache/bench/. For YOLO it also compares RGB vs BGR input (Ultralytics treats numpy as BGR).
Default image: Ultralytics' bundled bus.jpg (people standing).
"""

import argparse
import json
import statistics
import time
from pathlib import Path

import cv2
import numpy as np

from ..pose.draw import OverlayState, draw_overlay


def _load(path: str | None, size: tuple[int, int]) -> np.ndarray:
    if path is None:
        import ultralytics
        path = str(Path(ultralytics.__file__).parent / "assets" / "bus.jpg")
    bgr = cv2.imread(path)
    if bgr is None:
        raise SystemExit(f"cannot read {path}")
    return cv2.cvtColor(cv2.resize(bgr, size, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)


def _bench(backend, rgb: np.ndarray, frames: int) -> dict:
    ms, kp = [], None
    for i in range(frames):
        t0 = time.perf_counter()
        kp = backend.infer(rgb, i * 83)
        ms.append((time.perf_counter() - t0) * 1000)
    ms = ms[3:]                                           # drop warm-up frames
    found = {k: round(v[2], 2) for k, v in (kp or {}).items() if v[2] >= 0.5}
    return {"backend": backend.name, "p50_ms": round(statistics.median(ms), 1),
            "p95_ms": round(statistics.quantiles(ms, n=20)[18], 1), "joints_conf_ge_0.5": len(found), "kp": kp}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--image")
    p.add_argument("--frames", type=int, default=60)
    p.add_argument("--size", default="960x540")
    p.add_argument("--out", default="cache/bench")
    args = p.parse_args()
    w, h = (int(x) for x in args.size.split("x"))
    rgb = _load(args.image, (w, h))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    from ..pose.mediapipe_backend import MediaPipeBackend
    from ..pose.yolo_backend import YoloBackend

    rows = []
    for factory in (lambda: MediaPipeBackend("pose_landmarker_full"), lambda: MediaPipeBackend("pose_landmarker_lite"),
                    YoloBackend):
        t0 = time.perf_counter()
        b = factory()
        load_s = round(time.perf_counter() - t0, 2)
        r = _bench(b, rgb, args.frames)
        r["load_s"] = load_s
        side = "left" if (r["kp"] or {}).get("left_knee", (0, 0, 0))[2] >= (r["kp"] or {}).get("right_knee", (0, 0, 0))[2] else "right"
        st = OverlayState(banner=r["backend"], side=side, joints=("hip", "knee", "ankle"))
        img = draw_overlay(rgb, r.pop("kp"), st, w, h)
        cv2.imwrite(str(out / f"{r['backend'].replace(':', '_')}.png"), cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
        rows.append(r)
        b.close()

    # R8: Ultralytics colour order. Our backend flips RGB -> BGR; feeding RGB unflipped is the wrong order.
    from ultralytics import YOLO
    from ..pose.base import models_dir
    model = YOLO(str(models_dir() / "yolo26n-pose.pt"))
    conf = lambda arr: float(model(arr, verbose=False, device="cpu")[0].boxes.conf.max().item())  # noqa: E731
    color = {"bgr_input_max_person_conf": round(conf(np.ascontiguousarray(rgb[..., ::-1])), 3),
             "rgb_input_max_person_conf": round(conf(rgb), 3)}
    print(json.dumps({"size": args.size, "frames": args.frames, "backends": rows, "yolo_color_order": color}, indent=2))


if __name__ == "__main__":
    main()
