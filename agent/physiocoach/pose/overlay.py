"""What the annotated tile shows (pure; the flow updates it, pose/draw.py renders it)."""

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class OverlayState:
    banner: str = ""                              # phase banner, English
    reps: int = 0
    reps_planned: int = 0
    set_index: int = 0
    sets_planned: int = 1
    target: Optional[float] = None                # mode value
    value: Optional[float] = None                 # current smoothed mode value
    rep_peak: Optional[float] = None              # peak of the rep in progress / last rep
    raw_angle: Optional[float] = None             # joint angle at the vertex
    side: Optional[str] = None
    joints: Optional[tuple[str, str, str]] = None
    halted: bool = False

    @staticmethod
    def idle() -> "OverlayState":
        return OverlayState(banner="Waiting for consent")
