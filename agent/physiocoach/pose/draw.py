"""The annotated tile (§8.11): skeleton, angle arc, rep counter, angle gauge with target line.

Pure functions on RGB numpy arrays (cv2 drawing). Text is English and numbers only: OpenCV
Hershey fonts have no Malayalam glyphs (Malayalam lives in the web captions).
"""

import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional

import cv2
import numpy as np

from ..core.angles import CONF_MIN
from .base import JOINTS, SKELETON_EDGES, Keypoints

GREEN = (34, 197, 94)          # RGB; matches the app's primary green
WHITE = (255, 255, 255)
AMBER = (245, 158, 11)
RED = (220, 38, 38)
DARK = (17, 24, 39)
FONT = cv2.FONT_HERSHEY_SIMPLEX


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


def letterbox(rgb: np.ndarray, w: int, h: int) -> tuple[np.ndarray, float, int, int]:
    """Fit the frame into w x h keeping aspect ratio (black bars). Returns (canvas, scale, dx, dy)."""
    ih, iw = rgb.shape[:2]
    scale = min(w / iw, h / ih)
    nw, nh = max(1, round(iw * scale)), max(1, round(ih * scale))
    canvas = np.zeros((h, w, 3), dtype=np.uint8)
    dx, dy = (w - nw) // 2, (h - nh) // 2
    canvas[dy:dy + nh, dx:dx + nw] = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_AREA)
    return canvas, scale, dx, dy


def _text(img, text, org, size=0.8, color=WHITE, thick=2):
    cv2.putText(img, text, org, FONT, size, DARK, thick + 3, cv2.LINE_AA)   # outline for contrast
    cv2.putText(img, text, org, FONT, size, color, thick, cv2.LINE_AA)


def _deg_text(img, value: float, org, size=0.8, color=WHITE, thick=2):
    """`48°` with a drawn degree ring (Hershey fonts have no degree glyph)."""
    text = f"{round(value)}"
    _text(img, text, org, size, color, thick)
    (tw, th), _ = cv2.getTextSize(text, FONT, size, thick)
    r = max(2, int(th * 0.22))
    c = (org[0] + tw + r + 3, org[1] - th + r)
    cv2.circle(img, c, r + 1, DARK, thick + 2, cv2.LINE_AA)
    cv2.circle(img, c, r, color, thick, cv2.LINE_AA)


def _pt(kp: Keypoints, key: str, scale: float, dx: int, dy: int) -> Optional[tuple[int, int]]:
    p = kp.get(key)
    if p is None or p[2] < CONF_MIN:
        return None
    return int(round(p[0] * scale + dx)), int(round(p[1] * scale + dy))


def _draw_skeleton(img, kp: Keypoints, st: OverlayState, scale: float, dx: int, dy: int) -> None:
    for side in ("left", "right"):
        for a, b in SKELETON_EDGES:
            pa, pb = _pt(kp, f"{side}_{a}", scale, dx, dy), _pt(kp, f"{side}_{b}", scale, dx, dy)
            if pa and pb:
                cv2.line(img, pa, pb, WHITE, 2, cv2.LINE_AA)
    for a, b in (("left_shoulder", "right_shoulder"), ("left_hip", "right_hip")):
        pa, pb = _pt(kp, a, scale, dx, dy), _pt(kp, b, scale, dx, dy)
        if pa and pb:
            cv2.line(img, pa, pb, WHITE, 2, cv2.LINE_AA)
    for side in ("left", "right"):
        for j in JOINTS:
            p = _pt(kp, f"{side}_{j}", scale, dx, dy)
            if p:
                cv2.circle(img, p, 4, WHITE, -1, cv2.LINE_AA)
    if not (st.side and st.joints):
        return
    pts = [_pt(kp, f"{st.side}_{j}", scale, dx, dy) for j in st.joints]
    for p, q in ((pts[0], pts[1]), (pts[1], pts[2])):
        if p and q:
            cv2.line(img, p, q, GREEN, 6, cv2.LINE_AA)
    for p in pts:
        if p:
            cv2.circle(img, p, 8, GREEN, -1, cv2.LINE_AA)
    a, b, c = pts
    if a and b and c and st.raw_angle is not None:
        ang_a = math.degrees(math.atan2(a[1] - b[1], a[0] - b[0])) % 360
        ang_c = math.degrees(math.atan2(c[1] - b[1], c[0] - b[0])) % 360
        diff = (ang_c - ang_a) % 360
        start, sweep = (ang_a, diff) if diff <= 180 else (ang_c, 360 - diff)
        cv2.ellipse(img, b, (36, 36), 0, start, start + sweep, AMBER, 3, cv2.LINE_AA)
        _deg_text(img, st.raw_angle, (b[0] + 44, b[1] + 8), 0.7, AMBER)


def _gauge_point(cx: int, cy: int, r: float, v: float) -> tuple[int, int]:
    th = math.pi * (1 - max(0.0, min(180.0, v)) / 180.0)      # value 0 at the left, 180 at the right
    return int(round(cx + r * math.cos(th))), int(round(cy - r * math.sin(th)))


def _draw_gauge(img, st: OverlayState, w: int, h: int) -> None:
    r = max(40, min(w, h) // 6)
    cx, cy = w - r - 24, h - 28
    cv2.ellipse(img, (cx, cy), (r, r), 0, 180, 360, DARK, 10, cv2.LINE_AA)
    cv2.ellipse(img, (cx, cy), (r, r), 0, 180, 360, WHITE, 2, cv2.LINE_AA)
    if st.target is not None:
        if st.target - 8 > 0:                                      # "close enough" tick, amber, dashed look
            p1, p2 = _gauge_point(cx, cy, r - 12, st.target - 8), _gauge_point(cx, cy, r + 6, st.target - 8)
            cv2.line(img, p1, p2, AMBER, 2, cv2.LINE_4)
        p1, p2 = _gauge_point(cx, cy, r - 16, st.target), _gauge_point(cx, cy, r + 10, st.target)
        cv2.line(img, p1, p2, GREEN, 4, cv2.LINE_AA)
    if st.rep_peak is not None:
        cv2.circle(img, _gauge_point(cx, cy, r, st.rep_peak), 6, AMBER, -1, cv2.LINE_AA)
    if st.value is not None:
        cv2.line(img, (cx, cy), _gauge_point(cx, cy, r - 8, st.value), WHITE, 3, cv2.LINE_AA)
        _deg_text(img, st.value, (cx - 24, cy - r // 3), 0.9)
    cv2.circle(img, (cx, cy), 5, WHITE, -1, cv2.LINE_AA)


def _draw_hud(img, st: OverlayState, w: int, h: int) -> None:
    if st.reps_planned:
        _text(img, f"{st.reps} / {st.reps_planned}", (20, 60), 1.8, WHITE, 4)
        _text(img, f"Set {st.set_index}/{st.sets_planned}", (22, 96), 0.8)
    if st.banner:
        (tw, _), _ = cv2.getTextSize(st.banner, FONT, 0.8, 2)
        _text(img, st.banner, ((w - tw) // 2, 36), 0.8)
    if st.halted:
        cv2.rectangle(img, (0, h // 2 - 34), (w, h // 2 + 34), RED, -1)
        msg = "STOPPED - physio alerted"
        (tw, _), _ = cv2.getTextSize(msg, FONT, 1.1, 3)
        cv2.putText(img, msg, ((w - tw) // 2, h // 2 + 12), FONT, 1.1, WHITE, 3, cv2.LINE_AA)


def draw_overlay(rgb: np.ndarray, kp: Optional[Keypoints], st: OverlayState, w: int, h: int) -> np.ndarray:
    """Annotated W x H RGB frame. `kp` is in the input frame's pixel coordinates (mapped by the letterbox)."""
    img, scale, dx, dy = letterbox(rgb, w, h)
    if kp:
        _draw_skeleton(img, kp, st, scale, dx, dy)
    _draw_gauge(img, st, w, h)
    _draw_hud(img, st, w, h)
    return img


@lru_cache(maxsize=8)
def _placeholder(w: int, h: int, banner: str) -> np.ndarray:
    img = np.full((h, w, 3), DARK, dtype=np.uint8)
    cx, cy = w // 2, h // 2 - 30
    cv2.circle(img, (cx, cy), 46, GREEN, -1, cv2.LINE_AA)                 # simple PhysioCoach mark
    cv2.line(img, (cx - 22, cy + 4), (cx - 4, cy + 20), WHITE, 7, cv2.LINE_AA)
    cv2.line(img, (cx - 4, cy + 20), (cx + 26, cy - 18), WHITE, 7, cv2.LINE_AA)
    for text, size, y in (("PhysioCoach", 1.2, cy + 96), (banner, 0.8, cy + 136)):
        (tw, _), _ = cv2.getTextSize(text, FONT, size, 2)
        cv2.putText(img, text, ((w - tw) // 2, y), FONT, size, WHITE, 2, cv2.LINE_AA)
    img.setflags(write=False)
    return img


def placeholder_frame(w: int, h: int, st: Optional[OverlayState] = None) -> np.ndarray:
    """Static tile shown before consent: no inference runs and no raw patient video is republished."""
    return _placeholder(w, h, (st.banner if st and st.banner else "Waiting for consent"))
