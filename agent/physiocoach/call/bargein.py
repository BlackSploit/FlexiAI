"""Barge-in (§8.13): when the physio speaks, the agent goes quiet at once and stays quiet until they finish.

Vision Agents' own barge-in needs STT/turn detection, and its FirstSpeakerWinsFilter drops audio from
everyone but the first speaker before AudioProcessors see it. So we read AudioReceivedEvent (raw,
per participant, before filtering), keep only the physio's PCM and run Silero VAD on it.

`BargeInDetector` is the pure decision logic (tested natively); `PhysioBargeIn` wires it to the agent.
"""

import logging
import time
from dataclasses import dataclass
from typing import Awaitable, Callable, Literal, Optional

import numpy as np

log = logging.getLogger(__name__)

START_PROB, STOP_PROB = 0.5, 0.3
START_CHUNKS = 2               # consecutive speech chunks before the gate closes
RELEASE_S = 0.8                # quiet time before the gate re-opens
DEFAULT_MIN_RMS = 0.02         # energy gate: the agent's own voice echoing from the physio's speakers is quiet


@dataclass
class BargeInDetector:
    min_rms: float = DEFAULT_MIN_RMS
    start_prob: float = START_PROB
    stop_prob: float = STOP_PROB
    start_chunks: int = START_CHUNKS
    release_s: float = RELEASE_S
    speaking: bool = False
    _streak: int = 0
    _quiet_since: Optional[float] = None

    def update(self, prob: float, rms: float, now: float) -> Optional[Literal["start", "stop"]]:
        is_speech = prob > self.start_prob and rms >= self.min_rms
        if not self.speaking:
            self._streak = self._streak + 1 if is_speech else 0
            if self._streak >= self.start_chunks:
                self.speaking, self._streak, self._quiet_since = True, 0, None
                return "start"
            return None
        if prob < self.stop_prob or rms < self.min_rms:
            if self._quiet_since is None:
                self._quiet_since = now
            elif now - self._quiet_since >= self.release_s:
                self.speaking, self._quiet_since = False, None
                return "stop"
        else:
            self._quiet_since = None
        return None


def pcm_rms(samples: np.ndarray) -> float:
    if samples.size == 0:
        return 0.0
    x = samples.astype(np.float64)
    if samples.dtype == np.int16:
        x /= 32768.0
    return float(np.sqrt(np.mean(x ** 2)))


class PhysioBargeIn:
    """Feeds the physio's audio to Silero and drives the Speaker's gate."""

    def __init__(self, physio_user_id: str, vad_session, on_start: Callable[[], Awaitable[None]],
                 on_stop: Callable[[], None], detector: Optional[BargeInDetector] = None,
                 clock: Callable[[], float] = time.monotonic):
        self.physio_user_id, self.vad = physio_user_id, vad_session
        self.on_start, self.on_stop = on_start, on_stop
        self.detector = detector or BargeInDetector()
        self.clock = clock
        self.started_at: Optional[float] = None
        self.events: list[dict] = []                     # spike measurements

    async def feed(self, user_id: Optional[str], pcm) -> None:
        if user_id != self.physio_user_id or pcm is None:
            return
        prob = float(self.vad.predict_speech(pcm))
        level = pcm_rms(np.asarray(pcm.samples))
        change = self.detector.update(prob, level, self.clock())
        if change == "start":
            self.started_at = self.clock()
            self.events.append({"event": "physio_started", "t": time.time()})
            log.info("barge-in: physio speaking (prob %.2f, rms %.3f), agent paused", prob, level)
            await self.on_start()
        elif change == "stop":
            self.events.append({"event": "physio_stopped", "t": time.time()})
            log.info("barge-in: physio finished, agent may resume")
            self.on_stop()
