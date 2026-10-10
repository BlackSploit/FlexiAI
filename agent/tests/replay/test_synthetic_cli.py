"""Replay harness on synthetic signals at POSE_FPS (§8.17, §12.1).

Video golden tests (tests/replay/golden/knee_test.<backend>.cues.jsonl) are added in Milestone 2
and run in Docker, where the pose backends are installed.
"""

import json

from physiocoach.core.exercises import load_exercises
from physiocoach.replay import cli, synthetic

KNEE = load_exercises()["knee_bend"]


def test_cli_clean_prints_ten_count_cues_and_the_note(capsys):
    assert cli.main(["--synthetic", "clean", "--exercise", "knee_bend", "--target", "60", "--reps", "10"]) == 0
    lines = [json.loads(line) for line in capsys.readouterr().out.strip().splitlines()]
    cues, summary = lines[:-1], lines[-1]
    assert [c["ids"] for c in cues] == [[f"count.{n:02d}"] for n in range(1, 11)]
    assert [c["t"] for c in cues] == sorted(c["t"] for c in cues)
    assert summary["metrics"]["reps_done"] == 10
    assert summary["noteIds"] == ["note.well_done", "note.achieved_bend.65", "note.target_reached.60",
                                  "note.keep_reps.10"]
    assert summary["note"]["en"].startswith("Well done")


def test_demo_rehearsal_movement_gives_the_demo_note():
    """§14: 10 slow reps at a consistent ~48 degrees -> good effort, achieved < 52, target 60, 3 more reps."""
    frames = [(f.t, synthetic.keypoints(f, KNEE.joints, KNEE.mode)) for f in synthetic.demo_shallow()]
    run = cli.run_set(frames, KNEE, 60, 10, 2.0)
    ids = run.note_ids
    assert ids[0] == "note.good_effort" and ids[2:] == ["note.target.60", "note.more_reps.3"]
    achieved = int(ids[1].rsplit(".", 1)[1])
    assert ids[1].startswith("note.achieved_bend.") and achieved < 52
    assert achieved == 48                                   # golden: EMA-smoothed average peak
    assert all(c["ids"] == [f"count.{i + 1:02d}", "cue.bend_more"] for i, c in enumerate(run.cues))


def test_cli_requires_synthetic_until_video_exists(capsys):
    import pytest
    with pytest.raises(SystemExit):
        cli.main(["clip.mp4"])
