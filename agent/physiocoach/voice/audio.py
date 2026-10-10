"""Pure audio helpers (numpy only): WAV I/O, resampling, trim/fade, loudness normalisation.

Clip format (§9.3): WAV, 24 kHz, 16-bit signed little-endian, mono; 30 ms silence kept at each end,
10 ms fades, loudness -16 LUFS with a -1 dBFS peak ceiling.
"""

import io
import math
import wave

import numpy as np

CLIP_RATE = 24000


def read_wav(data: bytes) -> tuple[np.ndarray, int]:
    """WAV bytes -> (mono int16 samples, sample rate). Stereo is averaged."""
    with wave.open(io.BytesIO(data), "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError(f"only 16-bit WAV supported, got {8 * w.getsampwidth()}-bit")
        rate, channels = w.getframerate(), w.getnchannels()
        samples = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1).astype(np.int16)
    return samples.copy(), rate


def write_wav(samples: np.ndarray, rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(np.asarray(samples, dtype="<i2").tobytes())
    return buf.getvalue()


def duration_ms(samples: np.ndarray, rate: int) -> int:
    return int(round(len(samples) * 1000 / rate))


def resample(samples: np.ndarray, src: int, dst: int) -> np.ndarray:
    """Linear-interpolation resample (render-time only; the call path uses PcmData.resample)."""
    if src == dst or len(samples) == 0:
        return samples.astype(np.int16)
    n = int(round(len(samples) * dst / src))
    x = np.linspace(0, len(samples) - 1, n)
    return np.interp(x, np.arange(len(samples)), samples.astype(np.float64)).round().astype(np.int16)


def trim_and_fade(samples: np.ndarray, rate: int, keep_ms: int = 30, fade_ms: int = 10,
                  threshold_db: float = -45.0) -> np.ndarray:
    """Trim leading/trailing silence (keeping `keep_ms`), then apply linear fades."""
    x = samples.astype(np.float64) / 32768.0
    if len(x) == 0:
        return samples
    thresh = 10 ** (threshold_db / 20)
    loud = np.flatnonzero(np.abs(x) > thresh)
    if len(loud) == 0:
        return samples[:0]
    keep = int(rate * keep_ms / 1000)
    x = x[max(0, loud[0] - keep): min(len(x), loud[-1] + 1 + keep)]
    f = min(int(rate * fade_ms / 1000), len(x) // 2)
    if f > 0:
        ramp = np.linspace(0.0, 1.0, f)
        x[:f] *= ramp
        x[-f:] *= ramp[::-1]
    return np.clip(np.round(x * 32768.0), -32768, 32767).astype(np.int16)


def loudnorm(samples: np.ndarray, rate: int, target_lufs: float = -16.0, peak_dbfs: float = -1.0) -> np.ndarray:
    """Normalise integrated loudness (pyloudnorm when installed, RMS fallback), with a peak ceiling."""
    x = samples.astype(np.float64) / 32768.0
    if len(x) == 0 or not np.any(x):
        return samples
    try:
        import pyloudnorm  # tools group
        meter = pyloudnorm.Meter(rate, block_size=min(0.4, max(0.1, len(x) / rate / 2)))
        current = meter.integrated_loudness(x)
        gain_db = target_lufs - current if math.isfinite(current) else 0.0
    except ImportError:
        rms_db = 20 * math.log10(max(1e-9, float(np.sqrt(np.mean(x ** 2)))))
        gain_db = (target_lufs + 3.0) - rms_db           # -13 dBFS RMS ~ -16 LUFS for speech
    y = x * 10 ** (gain_db / 20)
    peak = float(np.max(np.abs(y)))
    ceiling = 10 ** (peak_dbfs / 20)
    if peak > ceiling:
        y *= ceiling / peak
    return np.clip(np.round(y * 32768.0), -32768, 32767).astype(np.int16)


def rms(samples: np.ndarray) -> float:
    """RMS as a fraction of full scale (0..1)."""
    if len(samples) == 0:
        return 0.0
    x = samples.astype(np.float64) / 32768.0
    return float(np.sqrt(np.mean(x ** 2)))
