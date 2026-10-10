"""Set metrics and score (§8.6, ported exactly).

Score = 100 x (0.6 x min(1, avgPeak/target) + 0.25 x (1 - fast/reps) + 0.15 x min(1, reps/planned))
"""

from dataclasses import dataclass
from statistics import fmean


@dataclass(frozen=True)
class SetMetrics:
    reps_done: int
    reps_planned: int
    target: float
    avg_peak: float
    best_peak: float
    lowest_peak: float
    avg_rep_seconds: float
    fast_reps: int
    score: float
    per_rep: list[dict]          # [{"peak": float, "seconds": float, "tooFast": bool}]


def compute_score(avg_peak: float, target: float, fast: int, reps: int, planned: int) -> float:
    if reps <= 0 or target <= 0 or planned <= 0:
        return 0.0                                   # defined: no reps -> score 0 (spec formula divides by reps)
    s = 100 * (0.6 * min(1.0, avg_peak / target) + 0.25 * (1 - fast / reps) + 0.15 * min(1.0, reps / planned))
    return round(max(0.0, min(100.0, s)), 1)


def set_metrics(reps: list, planned: int, target: float) -> SetMetrics:
    if not reps:
        return SetMetrics(0, planned, target, 0.0, 0.0, 0.0, 0.0, 0, 0.0, [])
    peaks = [r.peak for r in reps]
    secs = [r.seconds for r in reps]
    fast = sum(1 for r in reps if r.too_fast)
    avg = fmean(peaks)
    return SetMetrics(len(reps), planned, target, round(avg, 1), round(max(peaks), 1), round(min(peaks), 1),
                      round(fmean(secs), 2), fast, compute_score(avg, target, fast, len(reps), planned),
                      [{"peak": round(r.peak, 1), "seconds": round(r.seconds, 2), "tooFast": r.too_fast} for r in reps])
