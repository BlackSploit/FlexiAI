"""Deterministic rep counting on the smoothed mode value (§8.5, ported exactly)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

MIN_REP_SECONDS = 0.6
MAX_GAP_S = 3.0           # implementation choice: a longer dropout while moving discards the rep


@dataclass(frozen=True)
class Rep:
    n: int
    peak: float
    seconds: float
    too_fast: bool


@dataclass(frozen=True)
class RepRejected:
    peak: float
    seconds: float
    reason: Literal["shallow", "too_short"]


class RepEngine:
    def __init__(self, rest: float, start: float, min_peak: float, min_seconds_per_rep: float):
        assert rest < start <= min_peak, "exercise thresholds must satisfy rest < start <= minPeak"
        self.rest, self.start, self.min_peak, self.min_spr = rest, start, min_peak, min_seconds_per_rep
        self.state: Literal["rest", "moving"] = "rest"
        self.armed = False                       # arms on the first sample below `rest`
        self.t0 = 0.0
        self.peak = 0.0
        self.last_t: Optional[float] = None
        self.reps: list[Rep] = []
        self.current_value: Optional[float] = None

    def update(self, t: float, v: float) -> Rep | RepRejected | None:
        gap = None if self.last_t is None else t - self.last_t
        self.last_t, self.current_value = t, v
        if self.state == "moving" and gap is not None and gap > MAX_GAP_S:
            self.abort_in_progress()             # also disarms
        if self.state == "rest":
            if v < self.rest:
                self.armed = True
            elif self.armed and v > self.start:
                self.state, self.t0, self.peak = "moving", t, v
            return None
        self.peak = max(self.peak, v)
        if v < self.rest:
            self.state = "rest"
            dur = t - self.t0
            if self.peak >= self.min_peak and dur > MIN_REP_SECONDS:
                rep = Rep(len(self.reps) + 1, self.peak, dur, dur < self.min_spr)
                self.reps.append(rep)
                return rep
            return RepRejected(self.peak, dur, "shallow" if self.peak < self.min_peak else "too_short")
        return None

    def abort_in_progress(self) -> None:
        """On stop/safety/long dropout: a half-done rep is never counted."""
        self.state, self.armed = "rest", False
