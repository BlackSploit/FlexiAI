"""Offline replay (§8.17): run a signal through tracker -> rep engine -> coach rules and print the cues.

    uv run python -m physiocoach.replay.cli --synthetic clean --exercise knee_bend --target 60 --reps 10

Prints one JSON line per counted rep (`{"t": 12.4, "ids": ["count.03", "cue.bend_more"]}`), then a
final line with the set metrics, the rule-note ids and the rendered note. Video input (a clip path)
needs the pose backends and is added in Milestone 2.
"""

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass, field
from typing import Callable, Iterable

from ..core.angles import AngleTracker, Keypoints, Sample
from ..core.coach_rules import live_cue_ids, render_note, rule_note_ids
from ..core.exercises import Exercise, load_exercises
from ..core.rep_engine import Rep, RepEngine, RepRejected
from ..core.scoring import SetMetrics, set_metrics
from . import synthetic


@dataclass
class SetRun:
    cues: list[dict] = field(default_factory=list)       # [{"t", "ids"}] per counted rep
    rejected: list[dict] = field(default_factory=list)   # [{"t", "reason", "peak", "seconds"}]
    metrics: SetMetrics | None = None
    note_ids: list[str] = field(default_factory=list)
    note: dict[str, str] = field(default_factory=dict)


Observer = Callable[[float, Keypoints | None, Sample | None, RepEngine], None]


def run_set(frames: Iterable[tuple[float, Keypoints | None]], exercise: Exercise, target: float, reps: int,
            min_seconds: float, side: str = "auto", observer: Observer | None = None) -> SetRun:
    """The same core path a live set takes; stops once `reps` reps are counted.

    `observer(t, kp, sample, engine)` sees every frame (the video path draws the annotated output with it).
    """
    tracker = AngleTracker(exercise.joints, exercise.mode, side)  # type: ignore[arg-type]
    engine = RepEngine(exercise.rest, exercise.start, exercise.min_peak, min_seconds)
    run = SetRun()
    for t, kp in frames:
        sample = tracker.update(t, kp) if kp else None
        if observer:
            observer(t, kp, sample, engine)
        if sample is None:
            continue
        ev = engine.update(sample.t, sample.value)
        if isinstance(ev, Rep):
            run.cues.append({"t": round(t, 2), "ids": live_cue_ids(ev, target, exercise.mode)})
            if len(engine.reps) >= reps:
                break
        elif isinstance(ev, RepRejected):
            run.rejected.append({"t": round(t, 2), "reason": ev.reason, "peak": round(ev.peak, 1),
                                 "seconds": round(ev.seconds, 2)})
    run.metrics = set_metrics(engine.reps, reps, target)
    run.note_ids = rule_note_ids(run.metrics, exercise.mode)
    run.note = render_note(run.note_ids)
    return run


def write_golden(run: SetRun, path: str) -> None:
    """Cue sequence as JSON lines, then the final note ids (tests/replay/test_golden.py compares these)."""
    lines = [json.dumps({"t": c["t"], "ids": c["ids"]}) for c in run.cues]
    lines.append(json.dumps({"reps": run.metrics.reps_done, "noteIds": run.note_ids}))
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def synthetic_frames(kind: str, exercise: Exercise, fps: int) -> list[tuple[float, Keypoints]]:
    frames = synthetic.GENERATORS[kind](fps=fps)
    return [(f.t, synthetic.keypoints(f, exercise.joints, exercise.mode)) for f in frames]


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="physiocoach.replay.cli", description=__doc__.splitlines()[0])
    p.add_argument("clip", nargs="?", help="video clip (Milestone 2: needs the pose backends)")
    p.add_argument("--synthetic", choices=sorted(synthetic.GENERATORS), help="feed a synthetic signal instead of video")
    p.add_argument("--exercise", default="knee_bend")
    p.add_argument("--target", type=int, help="target angle (default: the exercise's default target)")
    p.add_argument("--reps", type=int, default=10)
    p.add_argument("--min-seconds", type=float, default=2.0)
    p.add_argument("--side", choices=["auto", "left", "right"], default="auto")
    p.add_argument("--fps", type=int, default=int(os.getenv("POSE_FPS", "12")),
                   help="video is downsampled by timestamp to this rate, like the live pipeline")
    p.add_argument("--backend", choices=["mediapipe", "yolo"], default=os.getenv("POSE_BACKEND", "mediapipe"))
    p.add_argument("--out", help="video: write the annotated tile to this .mp4")
    p.add_argument("--golden-out", help="write the cue sequence as JSON lines (golden file)")
    p.add_argument("--play-audio", action="store_true", help="play the Malayalam clips locally (Milestone 3)")
    args = p.parse_args(argv)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")       # Malayalam on a Windows console
    if bool(args.synthetic) == bool(args.clip):
        p.error("give a video clip or --synthetic, not both")
    if args.play_audio:
        p.error("--play-audio arrives with the pre-rendered voice clips (Milestone 3)")

    exercise = load_exercises()[args.exercise]
    target = args.target or exercise.default_target
    if args.synthetic:
        run = run_set(synthetic_frames(args.synthetic, exercise, args.fps), exercise, target, args.reps,
                      args.min_seconds, args.side)
    else:
        from .video import run_video                    # needs cv2 + a pose backend (Docker image)
        run = run_video(args.clip, exercise, target, args.reps, args.min_seconds, args.side, args.fps,
                        args.backend, args.out)
    for cue in run.cues:
        print(json.dumps(cue, ensure_ascii=False))
    if args.golden_out:
        write_golden(run, args.golden_out)
    print(json.dumps({"metrics": asdict(run.metrics), "rejected": len(run.rejected), "noteIds": run.note_ids,
                      "note": run.note}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
