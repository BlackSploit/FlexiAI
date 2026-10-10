"""Joint angles in pixel space, EMA smoothing and side selection (§8.4, ported exactly)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, Mapping, Optional

CONF_MIN = 0.5            # ignore frames whose minimum joint confidence is below this
EMA_OLD, EMA_NEW = 0.6, 0.4
Side = Literal["left", "right"]
Mode = Literal["flex", "direct"]

Keypoints = Mapping[str, tuple[float, float, float]]   # "left_knee" -> (x_px, y_px, conf)


def joint_angle(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> Optional[float]:
    """Interior angle ABC at vertex b, in degrees, 0..180. Inputs MUST be pixel coordinates."""
    v1x, v1y = a[0] - b[0], a[1] - b[1]
    v2x, v2y = c[0] - b[0], c[1] - b[1]
    n1, n2 = math.hypot(v1x, v1y), math.hypot(v2x, v2y)
    if n1 < 1e-6 or n2 < 1e-6:
        return None
    cos = max(-1.0, min(1.0, (v1x * v2x + v1y * v2y) / (n1 * n2)))
    return math.degrees(math.acos(cos))


def normalised_to_px(x: float, y: float, width: int, height: int) -> tuple[float, float]:
    return x * width, y * height   # avoids aspect distortion (spec)


def mode_value(angle: float, mode: Mode) -> float:
    return 180.0 - angle if mode == "flex" else angle   # flex: straight limb = 0, bent = larger


def side_confidence(kp: Keypoints, joints: tuple[str, str, str], side: Side) -> float:
    return sum(kp.get(f"{side}_{j}", (0, 0, 0.0))[2] for j in joints)


class SideSelector:
    """Pick the side with the higher SUMMED confidence unless the prescription fixes it.
    Implementation choice (prototype unavailable): accumulate over the first `window` usable frames
    (positioning phase), then LOCK for the whole set so the side never flips mid-rep."""

    def __init__(self, fixed: Literal["auto", "left", "right"], window: int = 30):
        self.fixed, self.window = fixed, window
        self.totals = {"left": 0.0, "right": 0.0}
        self.n = 0
        self.locked: Optional[Side] = None if fixed == "auto" else fixed  # type: ignore[assignment]

    def observe(self, kp: Keypoints, joints: tuple[str, str, str]) -> Optional[Side]:
        if self.locked:
            return self.locked
        for s in ("left", "right"):
            self.totals[s] += side_confidence(kp, joints, s)  # type: ignore[arg-type]
        self.n += 1
        if self.n >= self.window:
            self.locked = "left" if self.totals["left"] >= self.totals["right"] else "right"
        return self.locked or ("left" if self.totals["left"] >= self.totals["right"] else "right")

    def force_lock(self) -> Side:
        """End of positioning: lock with the current totals even if the window is not full."""
        if not self.locked:
            self.locked = "left" if self.totals["left"] >= self.totals["right"] else "right"
        return self.locked

    def reset(self) -> None:
        """ONLY when re-entering positioning (e.g. the patient rejoined)."""
        self.__init__(self.fixed, self.window)


class Ema:
    def __init__(self) -> None:
        self.value: Optional[float] = None

    def update(self, x: float) -> float:
        self.value = x if self.value is None else EMA_OLD * self.value + EMA_NEW * x
        return self.value

    def reset(self) -> None:
        self.value = None


@dataclass(frozen=True)
class Sample:
    t: float            # seconds
    raw_angle: float    # joint angle, degrees
    value: float        # EMA-smoothed mode value fed to the RepEngine
    side: Side
    min_conf: float


class AngleTracker:
    """keypoints (pixel space) -> Sample, or None when the frame is gated out."""

    def __init__(self, joints: tuple[str, str, str], mode: Mode, side: Literal["auto", "left", "right"]):
        self.joints, self.mode = joints, mode
        self.sides = SideSelector(side)
        self.ema = Ema()
        self.last_ok_t: Optional[float] = None

    def update(self, t: float, kp: Keypoints) -> Optional[Sample]:
        side = self.sides.observe(kp, self.joints)
        pts = [kp.get(f"{side}_{j}") for j in self.joints]
        if any(p is None for p in pts):
            return None
        min_conf = min(p[2] for p in pts)  # type: ignore[index]
        if min_conf < CONF_MIN:
            return None          # gate: ignore the frame entirely (no EMA update)
        ang = joint_angle(pts[0][:2], pts[1][:2], pts[2][:2])  # type: ignore[index]
        if ang is None:
            return None
        self.last_ok_t = t
        return Sample(t, ang, self.ema.update(mode_value(ang, self.mode)), side, min_conf)
