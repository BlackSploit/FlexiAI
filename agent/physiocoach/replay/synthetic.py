"""Synthetic angle signals (§8.17) for tests and `replay.cli --synthetic`.

Each generator returns frames of the MODE value (flex: 180 - joint angle) at `fps`. `keypoints()`
turns a frame into pixel keypoints for one side, so synthetic runs go through the real
AngleTracker (EMA, confidence gate, side selection) and RepEngine.

Rep shape: rise 35 % / hold 30 % / fall 35 % of the movement time, with half-cosine ramps. The
movement lasts `rep_s + MOVE_EXTRA_S`, so the duration the engine measures (from crossing
`start` on the way up to dropping below `rest`) is close to `rep_s`.
"""

import math
import random
from dataclasses import dataclass, replace
from typing import Literal

BASE = 5.0            # value at rest (an almost straight limb)
MOVE_EXTRA_S = 0.6    # time spent below the start/rest thresholds inside one movement
CONF_OK, CONF_LOW, CONF_OTHER_SIDE = 0.95, 0.3, 0.2


@dataclass(frozen=True)
class Frame:
    t: float
    value: float          # mode value, degrees
    conf: float = CONF_OK


def _ramp(x: float) -> float:
    return (1 - math.cos(math.pi * max(0.0, min(1.0, x)))) / 2


def _shape(tau: float, move_s: float, peak: float) -> float:
    r = tau / move_s
    if r < 0.35:
        return BASE + (peak - BASE) * _ramp(r / 0.35)
    if r < 0.65:
        return peak
    return BASE + (peak - BASE) * _ramp((1 - r) / 0.35)


def _reps(n: int, peak: float, move_s: float, fps: int, lead: float = 1.0, gap: float = 1.0,
          tail: float = 1.5) -> list[Frame]:
    cycle = move_s + gap
    total = lead + n * move_s + (n - 1) * gap + tail
    frames = []
    for i in range(int(total * fps) + 1):
        t = i / fps
        v = BASE
        if t >= lead:
            k, tau = divmod(t - lead, cycle)
            if k < n and tau < move_s:
                v = _shape(tau, move_s, peak)
        frames.append(Frame(round(t, 4), v))
    return frames


def clean(n: int = 10, peak: float = 65, rep_s: float = 2.5, fps: int = 12) -> list[Frame]:
    return _reps(n, peak, rep_s + MOVE_EXTRA_S, fps)


def fast(n: int = 10, peak: float = 65, rep_s: float = 1.2, fps: int = 12) -> list[Frame]:
    """Valid reps that are too fast for min_seconds = 2."""
    return clean(n, peak, rep_s, fps)


def shallow(n: int = 10, peak: float = 30, rep_s: float = 2.5, fps: int = 12) -> list[Frame]:
    """Above `start` but below knee_bend minPeak (35): every rep is rejected as shallow."""
    return clean(n, peak, rep_s, fps)


def demo_shallow(n: int = 10, peak: float = 48, rep_s: float = 2.5, fps: int = 12) -> list[Frame]:
    """The rehearsal movement (§14): slow, consistent, about 48 degrees."""
    return clean(n, peak, rep_s, fps)


def too_short(n: int = 5, peak: float = 60, move_s: float = 0.5, fps: int = 12) -> list[Frame]:
    """Quick excursions above `start` lasting about 0.5 s: rejected as too_short."""
    return _reps(n, peak, move_s, fps)


def jitter(base: list[Frame], amp: float = 6, seed: int = 42) -> list[Frame]:
    """Uniform noise of +-amp degrees (same on the raw angle as on the mode value)."""
    rng = random.Random(seed)
    return [replace(f, value=min(180.0, max(0.0, f.value + rng.uniform(-amp, amp)))) for f in base]


def dropout(base: list[Frame], gaps: tuple[tuple[float, float], ...] = ((4.0, 0.4), (11.0, 1.5))) -> list[Frame]:
    """Low-confidence frames (gated out by the tracker) inside the given (start, duration) windows."""
    return [replace(f, conf=CONF_LOW) if any(s <= f.t < s + d for s, d in gaps) else f for f in base]


def prebent(fps: int = 12) -> list[Frame]:
    """Starts bent at 50 and only straightens: must count 0 reps (arming rule, §8.5)."""
    frames = []
    for i in range(int(4.0 * fps) + 1):
        t = i / fps
        v = 50.0 if t < 1.0 else 50.0 + (BASE - 50.0) * _ramp(t - 1.0) if t < 2.0 else BASE
        frames.append(Frame(round(t, 4), v))
    return frames


def long_dropout(fps: int = 12, peak: float = 60, gap_s: float = 3.5) -> list[Frame]:
    """A rep held at the top with a `gap_s` dropout inside it (discarded), then one normal rep (counted)."""
    held = _reps(1, peak, 7.0, fps, tail=0.0)                       # rise ~2.4 s, hold ~2.1 s, fall ~2.4 s
    gap_start = 2.5
    held = [replace(f, conf=CONF_LOW) if gap_start <= f.t < gap_start + gap_s else f for f in held]
    offset = held[-1].t + 1 / fps
    normal = [replace(f, t=round(f.t + offset, 4)) for f in clean(1, peak, 2.5, fps)]
    return held + normal


GENERATORS = {
    "clean": clean, "fast": fast, "shallow": shallow, "demo_shallow": demo_shallow, "too_short": too_short,
    "jitter": lambda fps=12: jitter(clean(fps=fps)),
    "dropout": lambda fps=12: dropout(clean(fps=fps)),
    "prebent": prebent, "long_dropout": long_dropout,
}

Side = Literal["left", "right"]


def keypoints(frame: Frame, joints: tuple[str, str, str], mode: str, side: Side = "left",
              length_px: float = 200.0) -> dict[str, tuple[float, float, float]]:
    """Pixel keypoints whose angle at the vertex equals the frame's raw joint angle.

    The other side gets low confidence so auto side selection picks `side`.
    """
    raw = 180.0 - frame.value if mode == "flex" else frame.value
    th = math.radians(raw)
    bx, by = 640.0, 360.0
    a = (bx, by - length_px)                                         # B->A points straight up
    c = (bx + length_px * math.sin(th), by - length_px * math.cos(th))
    other: Side = "right" if side == "left" else "left"
    kp: dict[str, tuple[float, float, float]] = {}
    for name, (x, y) in zip(joints, (a, (bx, by), c)):
        kp[f"{side}_{name}"] = (x, y, frame.conf)
        kp[f"{other}_{name}"] = (x + 40, y, CONF_OTHER_SIDE)
    return kp
