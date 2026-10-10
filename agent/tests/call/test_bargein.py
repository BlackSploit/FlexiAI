from types import SimpleNamespace

import numpy as np

from physiocoach.call.bargein import BargeInDetector, PhysioBargeIn, pcm_rms


def test_needs_two_consecutive_speech_chunks_to_start():
    d = BargeInDetector()
    assert d.update(0.9, 0.1, 0.00) is None
    assert d.update(0.1, 0.1, 0.03) is None          # streak broken
    assert d.update(0.9, 0.1, 0.06) is None
    assert d.update(0.9, 0.1, 0.09) == "start"
    assert d.speaking


def test_energy_gate_ignores_quiet_echo():
    d = BargeInDetector(min_rms=0.02)
    for i in range(10):
        assert d.update(0.95, 0.005, i * 0.03) is None   # confident VAD but too quiet: speaker echo


def test_releases_after_800ms_of_quiet_and_resets_on_speech():
    d = BargeInDetector()
    d.update(0.9, 0.1, 0.0)
    d.update(0.9, 0.1, 0.03)
    assert d.update(0.1, 0.1, 0.10) is None
    assert d.update(0.9, 0.1, 0.50) is None          # speaking again: the quiet timer resets
    assert d.update(0.1, 0.1, 0.60) is None
    assert d.update(0.1, 0.1, 1.30) is None
    assert d.update(0.1, 0.1, 1.41) == "stop"
    assert not d.speaking


def test_pcm_rms():
    assert pcm_rms(np.zeros(100, np.int16)) == 0.0
    assert abs(pcm_rms(np.full(100, 16384, np.int16)) - 0.5) < 1e-6


async def test_wrapper_only_listens_to_the_physio():
    calls: list[str] = []

    async def start():
        calls.append("start")

    vad = SimpleNamespace(predict_speech=lambda pcm: 0.9)
    loud = SimpleNamespace(samples=np.full(480, 8000, np.int16))
    t = iter(x * 0.03 for x in range(100))
    b = PhysioBargeIn("physio", vad, start, lambda: calls.append("stop"), clock=lambda: next(t))
    for _ in range(3):
        await b.feed("patient", loud)                 # the patient's voice never pauses the coach
    assert calls == []
    await b.feed("physio", loud)
    await b.feed("physio", loud)
    assert calls == ["start"] and b.events[0]["event"] == "physio_started"
