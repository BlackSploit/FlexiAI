"""Milestone 2 stand-in for CachedMalayalamTTS (Milestone 3).

Agent requires an audio or video *processing* capability; PoseProcessor is a publisher only
(DEV-13), so the production setup relies on the TTS. This stub keeps the M2 spike identical to
production in shape while producing only silence.
"""

from getstream.video.rtc.track_util import AudioFormat, PcmData
from vision_agents.core.tts import TTS

_SILENCE_10MS = b"\x00\x00" * 480   # 48 kHz mono s16


class SilentTTS(TTS):
    streaming = False

    def __init__(self) -> None:
        super().__init__(provider_name="physiocoach-silent")

    async def stream_audio(self, text: str, *args, **kwargs) -> PcmData:
        return PcmData.from_bytes(_SILENCE_10MS, sample_rate=48000, format=AudioFormat.S16, channels=1)

    async def stop_audio(self) -> None:
        return None
