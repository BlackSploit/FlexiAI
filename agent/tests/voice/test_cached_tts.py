"""CachedMalayalamTTS resolution order, tee, fallback, and the 'rule speech never hits runtime TTS' rule.

Needs vision_agents/getstream (Docker test image).
"""

import asyncio
import json
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("vision_agents")

from getstream.video.rtc.track_util import AudioFormat, PcmData  # noqa: E402
from vision_agents.core.tts import TTS  # noqa: E402

from physiocoach.call.speaker import Speaker  # noqa: E402
from physiocoach.core import phrases  # noqa: E402
from physiocoach.core.coach_rules import live_cue_ids, rule_note_ids  # noqa: E402
from physiocoach.core.rep_engine import Rep  # noqa: E402
from physiocoach.core.scoring import SetMetrics  # noqa: E402
from physiocoach.voice.audio import write_wav  # noqa: E402
from physiocoach.voice.cached_tts import CachedMalayalamTTS, NoVoiceAvailable  # noqa: E402
from physiocoach.voice.manifest import Manifest, text_hash  # noqa: E402

SLUG = "test-voice"
DEMO_NOTE = rule_note_ids(SetMetrics(10, 10, 60, 48.0, 48.0, 48.0, 2.5, 0, 88.0, []), "flex")
CUE_IDS = live_cue_ids(Rep(3, 40, 2.5, False), 60, "flex") + ["cue.slow", "safety.stop"]


def make_manifest(base: Path, ids: list[str]) -> Manifest:
    root = base / SLUG
    entries = []
    for i in ids:
        p = phrases.get(i)
        samples = (0.2 * 32767 * np.sin(np.linspace(0, 400, 7200))).astype(np.int16)    # 0.3 s at 24 kHz
        rel = f"{p.category}/{p.id}.wav"
        (root / p.category).mkdir(parents=True, exist_ok=True)
        (root / rel).write_bytes(write_wav(samples, 24000))
        entries.append({"id": p.id, "category": p.category, "text_ml": p.ml, "gloss_en": p.en,
                        "hash": text_hash(p.ml, SLUG), "file": rel, "duration_ms": 300,
                        "review": {"status": "pending"}})
    (root / "manifest.json").write_text(json.dumps({"voice": {}, "phrases": entries}, ensure_ascii=False))
    return Manifest.load(SLUG, base)


class FakeRuntime(TTS):
    def __init__(self, name: str, delay: float = 0.0, fail: bool = False):
        super().__init__(provider_name=name)
        self.delay, self.fail, self.calls = delay, fail, 0

    async def stream_audio(self, text, *a, **k):
        self.calls += 1

        async def gen():
            await asyncio.sleep(self.delay)
            if self.fail:
                raise RuntimeError("boom")
            for _ in range(2):
                yield PcmData.from_bytes(b"\x10\x00" * 2400, sample_rate=24000, format=AudioFormat.S16, channels=1)
        return gen()

    async def stop_audio(self):
        pass


async def collect(resp) -> list[PcmData]:
    if isinstance(resp, PcmData):
        return [resp]
    return [c async for c in resp]


@pytest.fixture
def ids():
    return sorted(set(DEMO_NOTE + CUE_IDS + ["count.01", "intro.greet"]))


async def test_clip_hit_is_48k_and_never_calls_runtime(tmp_path, ids):
    primary = FakeRuntime("primary")
    tts = CachedMalayalamTTS(make_manifest(tmp_path, ids), tmp_path / "cache", primary)
    out = await collect(await tts.stream_audio(phrases.get("count.01").ml))
    assert out[0].sample_rate == 48000 and primary.calls == 0 and tts.runtime_calls == 0
    assert tts.duration_s(phrases.get("note.target.60").ml) == pytest.approx(0.3)


async def test_cold_clip_loads_lazily(tmp_path, ids):
    tts = CachedMalayalamTTS(make_manifest(tmp_path, ids), tmp_path / "cache")
    key = text_hash(phrases.get("note.target.60").ml, SLUG)
    assert key not in tts._mem                                      # notes are not preloaded
    assert tts.lookup(phrases.get("note.target.60").ml) is not None and key in tts._mem


async def test_runtime_tts_is_teed_to_disk_and_memory(tmp_path, ids):
    primary = FakeRuntime("primary")
    tts = CachedMalayalamTTS(make_manifest(tmp_path, ids), tmp_path / "cache", primary)
    text = "ഇത് ഒരു പുതിയ വാക്യമാണ്."
    chunks = await collect(await tts.stream_audio(text))
    assert len(chunks) == 2 and primary.calls == 1
    assert (tmp_path / "cache" / SLUG / f"{text_hash(text, SLUG)}.wav").exists()
    await collect(await tts.stream_audio(text))                       # second time: cached
    assert primary.calls == 1


async def test_slow_primary_falls_back(tmp_path, ids):
    primary, fallback = FakeRuntime("primary", delay=1.0), FakeRuntime("fallback")
    tts = CachedMalayalamTTS(make_manifest(tmp_path, ids), tmp_path / "cache", primary, fallback,
                             first_chunk_timeout=0.05)
    assert len(await collect(await tts.stream_audio("പുതിയ വാക്യം"))) == 2
    assert fallback.calls == 1


async def test_no_voice_raises(tmp_path, ids):
    tts = CachedMalayalamTTS(make_manifest(tmp_path, ids), tmp_path / "cache", FakeRuntime("p", fail=True))
    with pytest.raises(NoVoiceAvailable):
        await collect(await tts.stream_audio("അറിയാത്ത വാക്യം"))


async def test_rule_note_and_live_cues_through_the_speaker_make_zero_runtime_calls(tmp_path, ids):
    primary, fallback = FakeRuntime("primary"), FakeRuntime("fallback")
    tts = CachedMalayalamTTS(make_manifest(tmp_path, ids), tmp_path / "cache", primary, fallback)

    class Agent:
        async def say(self, text, interrupt=False):
            await collect(await tts.stream_audio(text))            # what the agent's TTS pipeline does

        async def send_custom_event(self, payload):
            pass

    sp = Speaker(Agent(), lambda t: 0.0)
    task = asyncio.create_task(sp.run())
    sp.say_ids(DEMO_NOTE, "note")
    sp.say_ids(live_cue_ids(Rep(3, 40, 2.5, False), 60, "flex"), "count")
    await sp.safety()
    await asyncio.sleep(0)
    await sp.wait_idle()
    task.cancel()
    assert primary.calls == fallback.calls == tts.runtime_calls == 0
    assert sp.stats.spoken[-1] == phrases.get("safety.stop").ml
