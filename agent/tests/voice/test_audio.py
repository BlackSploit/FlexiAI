import numpy as np
import pytest

from physiocoach.voice.audio import (
    duration_ms, loudnorm, read_wav, resample, rms, trim_and_fade, write_wav,
)
from physiocoach.voice.manifest import text_hash

RATE = 24000


def tone(seconds: float, amp: float = 0.3, rate: int = RATE, freq: float = 220.0) -> np.ndarray:
    t = np.arange(int(seconds * rate)) / rate
    return (amp * 32767 * np.sin(2 * np.pi * freq * t)).astype(np.int16)


def test_wav_roundtrip():
    x = tone(0.5)
    y, rate = read_wav(write_wav(x, RATE))
    assert rate == RATE and np.array_equal(x, y)


def test_resample_changes_length_proportionally():
    assert len(resample(tone(1.0), 22050, 24000)) == pytest.approx(int(1.0 * RATE * 24000 / 22050), abs=2)
    x = tone(0.1)
    assert resample(x, RATE, RATE) is not None and len(resample(x, RATE, RATE)) == len(x)


def test_trim_keeps_30ms_and_fades():
    x = np.concatenate([np.zeros(RATE, np.int16), tone(0.5), np.zeros(RATE, np.int16)])
    y = trim_and_fade(x, RATE)
    assert duration_ms(y, RATE) == pytest.approx(560, abs=3)             # 500 ms + 2 x 30 ms
    assert abs(int(y[0])) < 50 and abs(int(y[-1])) < 50                  # faded ends
    assert len(trim_and_fade(np.zeros(1000, np.int16), RATE)) == 0       # pure silence -> empty


def test_loudnorm_brings_quiet_and_loud_clips_together_with_a_peak_ceiling():
    quiet, loud = loudnorm(tone(1.0, 0.02), RATE), loudnorm(tone(1.0, 0.9), RATE)
    assert rms(quiet) == pytest.approx(rms(loud), rel=0.15)
    assert np.max(np.abs(loud)) <= int(32768 * 10 ** (-1 / 20)) + 1
    assert np.array_equal(loudnorm(np.zeros(10, np.int16), RATE), np.zeros(10, np.int16))


def test_text_hash_is_nfc_and_slug_scoped():
    assert text_hash("ഒന്ന്", "v1") == text_hash(" ഒന്ന് ", "v1")
    assert text_hash("ഒന്ന്", "v1") != text_hash("ഒന്ന്", "v2")
    assert len(text_hash("x", "v")) == 16
