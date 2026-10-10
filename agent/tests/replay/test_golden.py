"""Video golden tests (§12.1): the recorded clip through backend -> tracker -> engine -> coach, per backend.

Mandatory in the Docker test run once replay/clips/knee_test.mp4 is committed (Milestone 2 task 8).
Until the clip exists the test skips with that reason; a clip without its golden file FAILS.

Record or refresh a golden file (inside the image):
    python -m physiocoach.replay.cli replay/clips/knee_test.mp4 --exercise knee_bend --target 60 \
        --backend mediapipe --golden-out tests/replay/golden/knee_test.mediapipe.cues.jsonl
"""

import json
import os
from pathlib import Path

import pytest

AGENT = Path(__file__).resolve().parents[2]
CLIPS = AGENT / "replay" / "clips"
GOLDEN = Path(__file__).parent / "golden"
CASES = [("knee_test", "knee_bend", 60)]


@pytest.mark.parametrize("backend", ["mediapipe", "yolo"])
@pytest.mark.parametrize("clip,exercise_id,target", CASES)
def test_clip_matches_golden_cues(clip, exercise_id, target, backend, tmp_path):
    pytest.importorskip("cv2")
    pytest.importorskip("mediapipe" if backend == "mediapipe" else "ultralytics")
    video = CLIPS / f"{clip}.mp4"
    if not video.exists():
        pytest.skip(f"{video.name} not provided yet (Milestone 2 task 8)")
    golden = GOLDEN / f"{clip}.{backend}.cues.jsonl"
    assert golden.exists(), f"record {golden.name} (see module docstring)"

    from physiocoach.core.exercises import load_exercises
    from physiocoach.replay.cli import write_golden
    from physiocoach.replay.video import run_video

    run = run_video(str(video), load_exercises()[exercise_id], target, 10, 2.0, "auto",
                    int(os.getenv("POSE_FPS", "12")), backend)
    out = tmp_path / "cues.jsonl"
    write_golden(run, str(out))
    got = [json.loads(line) for line in out.read_text().splitlines()]
    want = [json.loads(line) for line in golden.read_text().splitlines()]
    assert [g.get("ids") for g in got] == [w.get("ids") for w in want]          # exact cue-id sequence
    assert got[-1] == want[-1]                                                   # rep count + note ids
