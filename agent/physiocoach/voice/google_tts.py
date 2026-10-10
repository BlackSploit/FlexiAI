"""Google Cloud TTS (Chirp 3 HD, ml-IN) as a Vision Agents TTS: the runtime fallback (§8.10)."""

from typing import Optional

from getstream.video.rtc.track_util import AudioFormat, PcmData
from vision_agents.core.tts import TTS

from .audio import read_wav


class GoogleTTS(TTS):
    streaming = False

    def __init__(self, voice: str = "ml-IN-Chirp3-HD-Kore", sample_rate: int = 24000, speaking_rate: float = 0.9):
        super().__init__(provider_name="google-tts")
        self.voice, self.sample_rate, self.speaking_rate = voice, sample_rate, speaking_rate
        self._client = None
        self._tts = None

    async def start(self) -> None:
        if self._client is None:
            from google.cloud import texttospeech       # reads GOOGLE_APPLICATION_CREDENTIALS
            self._tts = texttospeech
            self._client = texttospeech.TextToSpeechAsyncClient()

    async def stream_audio(self, text: str, *_, **__) -> PcmData:
        await self.start()
        t = self._tts
        resp = await self._client.synthesize_speech(
            input=t.SynthesisInput(text=text),
            voice=t.VoiceSelectionParams(language_code="ml-IN", name=self.voice),
            audio_config=t.AudioConfig(audio_encoding=t.AudioEncoding.LINEAR16, sample_rate_hertz=self.sample_rate,
                                       speaking_rate=self.speaking_rate))
        samples, rate = read_wav(resp.audio_content)     # LINEAR16 responses carry a WAV header
        return PcmData.from_bytes(samples.tobytes(), sample_rate=rate, format=AudioFormat.S16, channels=1)

    async def stop_audio(self) -> None:
        return None

    async def close(self) -> None:
        self._client = None
        await super().close()


def build_runtime_tts(primary: Optional[str], sarvam_speaker: str, google_voice: str, pace: float = 0.9):
    """(primary, fallback) runtime TTS from env-style names: "sarvam" | "google" | "none".

    A provider whose credentials are missing is left out (None), so clips-only operation is the floor.
    """
    import os

    def make(kind: Optional[str]):
        if kind == "sarvam" and os.getenv("SARVAM_API_KEY"):
            from vision_agents.plugins import sarvam
            return sarvam.TTS(model="bulbul:v3", language="ml-IN", speaker=sarvam_speaker, sample_rate=24000, pace=pace)
        if kind == "google" and os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
            return GoogleTTS(voice=google_voice, speaking_rate=pace)
        return None
    kinds = {"sarvam": ("sarvam", "google"), "google": ("google", "sarvam")}.get(primary or "none", (None, None))
    return make(kinds[0]), make(kinds[1])
