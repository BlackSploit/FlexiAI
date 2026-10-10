from pathlib import Path

from physiocoach.core.config import load_session_config, shared_dir
from physiocoach.core.exercises import load_exercises


def test_exercise_library_matches_spec_thresholds():
    ex = load_exercises()
    assert set(ex) == {"knee_bend", "elbow_bend", "shoulder_raise"}
    k = ex["knee_bend"]
    assert (k.joints, k.mode, k.rest, k.start, k.min_peak, k.default_target, k.camera_view) == (
        ("hip", "knee", "ankle"), "flex", 15, 25, 35, 60, "side")
    assert ex["shoulder_raise"].mode == "direct" and ex["shoulder_raise"].camera_view == "front"
    for e in ex.values():
        assert e.rest < e.start <= e.min_peak <= e.default_target


def test_shared_dir_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("PC_SHARED_DIR", str(tmp_path))
    assert shared_dir() == Path(tmp_path)


def test_session_config_from_env(monkeypatch):
    raw = (shared_dir() / "fixtures" / "control" / "valid" / "start-replay-restart.json").read_text(encoding="utf-8")
    monkeypatch.setenv("PC_SESSION_JSON", raw)
    cfg = load_session_config()
    assert cfg.mode == "replay" and cfg.startSetIndex == 2 and cfg.consentGiven
    assert cfg.exercise.joints == ("hip", "knee", "ankle")
