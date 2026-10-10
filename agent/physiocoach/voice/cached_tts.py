"""One TTS slot for all speech (§8.10): Agent(tts=CachedMalayalamTTS(...)).

stream_audio(text) resolution order:
  1. in-memory clip (hot categories preloaded at start, others loaded on first use, LRU-bounded)
  2. pre-rendered manifest clip on disk
  3. runtime disk cache  <cache_dir>/<voice_slug>/<hash>.wav
  4. primary runtime TTS (Sarvam bulbul:v3, same voice as the clips), first chunk within 1.5 s; tee to cache
  5. fallback runtime TTS (Google Chirp 3 HD), same rule
  6. raise: the coach plays the rule clips instead
All audio leaves as 48 kHz mono PcmData. Key = sha256(f"{voice_slug}|{nfc(text)}")[:16].
"""

import asyncio
import logging
from collections import OrderedDict
from pathlib import Path
from typing import AsyncIterator, Optional

from getstream.video.rtc.track_util import AudioFormat, PcmData
from vision_agents.core.tts import TTS

from .audio import read_wav, write_wav
from .manifest import Manifest, text_hash

log = logging.getLogger(__name__)

OUT_RATE = 48000
HOT_CATEGORIES = {"count", "cue", "cd", "pos", "intro", "consent", "pain", "safety", "misc"}


class NoVoiceAvailable(RuntimeError):
    """Neither a clip nor a runtime TTS could voice the text."""


def wav_to_pcm(data: bytes) -> PcmData:
    samples, rate = read_wav(data)
    return PcmData.from_bytes(samples.tobytes(), sample_rate=rate, format=AudioFormat.S16, channels=1) \
        .resample(OUT_RATE, 1)


class CachedMalayalamTTS(TTS):
    streaming = False

    def __init__(self, manifest: Manifest, cache_dir: Path, primary: Optional[TTS] = None,
                 fallback: Optional[TTS] = None, first_chunk_timeout: float = 1.5, max_cached: int = 400):
        super().__init__(provider_name="physiocoach-ml")
        self.manifest, self.voice_slug = manifest, manifest.voice_slug
        self.cache_dir = cache_dir / manifest.voice_slug
        self.primary, self.fallback = primary, fallback
        self.first_chunk_timeout = first_chunk_timeout
        self.max_cached = max_cached
        self._mem: OrderedDict[str, PcmData] = OrderedDict()
        self._pinned: set[str] = set()
        self.runtime_calls = 0                       # tests: rule speech must never reach runtime TTS
        for entry in manifest.by_hash.values():
            if entry["category"] in HOT_CATEGORIES:
                self._mem[entry["hash"]] = wav_to_pcm(manifest.path(entry).read_bytes())
                self._pinned.add(entry["hash"])
        log.info("voice %s: %d clips indexed, %d preloaded", self.voice_slug, len(manifest.by_hash), len(self._pinned))

    # ------------------------------------------------------------ lookup
    def _remember(self, key: str, pcm: PcmData) -> PcmData:
        self._mem[key] = pcm
        self._mem.move_to_end(key)
        while len(self._mem) > self.max_cached + len(self._pinned):
            for k in self._mem:                       # evict the oldest unpinned entry
                if k not in self._pinned:
                    del self._mem[k]
                    break
        return pcm

    def lookup(self, text: str) -> Optional[PcmData]:
        """Clip or cached audio for `text`, without any network call."""
        key = text_hash(text, self.voice_slug)
        if key in self._mem:
            self._mem.move_to_end(key)
            return self._mem[key]
        entry = self.manifest.by_hash.get(key)
        if entry:
            return self._remember(key, wav_to_pcm(self.manifest.path(entry).read_bytes()))
        f = self.cache_dir / f"{key}.wav"
        if f.exists():
            return self._remember(key, wav_to_pcm(f.read_bytes()))
        return None

    def duration_s(self, text: str) -> Optional[float]:
        d = self.manifest.duration_s(text)
        if d is not None:
            return d
        pcm = self._mem.get(text_hash(text, self.voice_slug))
        return pcm.duration_ms / 1000 if pcm is not None else None

    # ------------------------------------------------------------ TTS contract
    async def stream_audio(self, text: str, *_, **__):
        cached = self.lookup(text)
        if cached is not None:
            return cached
        return self._synth_and_tee(text, text_hash(text, self.voice_slug))

    async def _synth_and_tee(self, text: str, key: str) -> AsyncIterator[PcmData]:
        self.runtime_calls += 1
        for tts in (t for t in (self.primary, self.fallback) if t is not None):
            try:
                stream = await tts.stream_audio(text)
                it = stream.__aiter__() if hasattr(stream, "__aiter__") else _single(stream)
                first = await asyncio.wait_for(it.__anext__(), self.first_chunk_timeout)
            except (asyncio.TimeoutError, StopAsyncIteration, Exception) as e:  # noqa: BLE001
                log.warning("runtime TTS %s failed before first chunk: %s", tts.provider_name, type(e).__name__)
                await _quiet_stop(tts)
                continue
            chunks = [first.resample(OUT_RATE, 1)]
            yield chunks[0]
            async for chunk in it:
                chunks.append(chunk.resample(OUT_RATE, 1))
                yield chunks[-1]
            self._tee(key, chunks)
            return
        raise NoVoiceAvailable(text)

    def _tee(self, key: str, chunks: list[PcmData]) -> None:
        pcm = chunks[0]
        for c in chunks[1:]:
            pcm = pcm.append(c)
        self._remember(key, pcm)
        try:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            samples = pcm.resample(24000, 1).samples
            (self.cache_dir / f"{key}.wav").write_bytes(write_wav(samples, 24000))
        except OSError as e:
            log.warning("could not write voice cache: %s", e)

    async def start(self) -> None:
        """Warm the runtime TTS (Sarvam opens its WebSocket) before the greeting."""
        for tts in (self.primary, self.fallback):
            if tts is not None:
                try:
                    await tts.start()
                except Exception as e:  # noqa: BLE001 - clips still work without runtime TTS
                    log.warning("runtime TTS %s did not start: %s", tts.provider_name, e)

    async def stop_audio(self) -> None:
        for tts in (self.primary, self.fallback):
            if tts is not None:
                await _quiet_stop(tts)

    async def close(self) -> None:
        for tts in (self.primary, self.fallback):
            if tts is not None:
                await tts.close()
        await super().close()


async def _single(pcm: PcmData) -> AsyncIterator[PcmData]:
    yield pcm


async def _quiet_stop(tts: TTS) -> None:
    try:
        await tts.stop_audio()
    except Exception:  # noqa: BLE001
        pass
