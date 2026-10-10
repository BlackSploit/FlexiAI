"""Exercise library, loaded from shared/exercises.json (single source with the web seed)."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


@dataclass(frozen=True)
class Exercise:
    id: str
    name_en: str
    name_ml: str
    joints: tuple[str, str, str]   # (a, b = vertex, c)
    mode: Literal["flex", "direct"]
    rest: float                    # thresholds apply to the mode-adjusted value
    start: float
    min_peak: float
    default_target: int
    camera_view: Literal["side", "front"]


def load_exercises(path: Path | None = None) -> dict[str, Exercise]:
    if path is None:
        from .config import shared_dir
        path = shared_dir() / "exercises.json"
    rows = json.loads(Path(path).read_text(encoding="utf-8"))
    return {
        r["id"]: Exercise(
            id=r["id"],
            name_en=r["nameEn"],
            name_ml=r["nameMl"],
            joints=tuple(r["joints"]),
            mode=r["mode"],
            rest=float(r["rest"]),
            start=float(r["start"]),
            min_peak=float(r["minPeak"]),
            default_target=int(r["defaultTarget"]),
            camera_view=r.get("cameraView", "side"),
        )
        for r in rows
    }
