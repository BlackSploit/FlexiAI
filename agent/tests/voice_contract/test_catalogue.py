"""Voice contract (§12.3): every phrase the coach can emit has a clip in the ACTIVE voice.

VOICE_SLUG selects the voice (agent/assets/voice/<slug>/manifest.json). Skipped when no slug is set
or its manifest is missing. DEMO=1 additionally requires review.status == "approved" for every clip.
RUN_TTS_NETWORK=1 enables the opt-in runtime TTS check (3 non-catalogue strings).
"""

import os

import numpy as np
import pytest

from physiocoach.core import phrases
from physiocoach.voice.audio import read_wav, rms
from physiocoach.voice.manifest import Manifest, assets_dir, text_hash

SLUG = os.getenv("VOICE_SLUG", "")
MIN_DURATION_MS = 200
MIN_RMS = 0.005


@pytest.fixture(scope="module")
def manifest() -> Manifest:
    if not SLUG or not (assets_dir() / SLUG / "manifest.json").exists():
        pytest.skip(f"no rendered voice for VOICE_SLUG={SLUG!r}")
    return Manifest.load(SLUG)


def test_every_catalogue_phrase_has_a_valid_clip(manifest):
    missing, bad = [], []
    for p in phrases.expand_all():
        entry = manifest.by_id.get(p.id)
        if entry is None or entry["hash"] != text_hash(p.ml, SLUG):
            missing.append(p.id)
            continue
        path = manifest.path(entry)
        if not path.exists():
            missing.append(p.id)
            continue
        samples, rate = read_wav(path.read_bytes())
        if len(samples) * 1000 / rate <= MIN_DURATION_MS or rms(samples) < MIN_RMS:
            bad.append(p.id)
    assert not missing, f"{len(missing)} phrases without a current clip, e.g. {missing[:10]}"
    assert not bad, f"{len(bad)} clips too short or silent, e.g. {bad[:10]}"


@pytest.mark.skipif(os.getenv("DEMO") != "1", reason="approval only enforced for the demo build (DEMO=1)")
def test_demo_build_requires_native_review_approval(manifest):
    pending = [e["id"] for e in manifest.by_id.values() if e["review"]["status"] != "approved"]
    assert not pending, f"{len(pending)} clips not approved by the native-speaker review, e.g. {pending[:10]}"


@pytest.mark.skipif(os.getenv("RUN_TTS_NETWORK") != "1", reason="opt-in network test")
async def test_runtime_tts_voices_non_catalogue_text():
    pytest.importorskip("vision_agents")
    from physiocoach.voice.google_tts import build_runtime_tts
    primary, _ = build_runtime_tts(os.getenv("TTS_PRIMARY", "sarvam"), os.getenv("SARVAM_SPEAKER", "shubh"),
                                   os.getenv("GOOGLE_TTS_VOICE", "ml-IN-Chirp3-HD-Kore"))
    assert primary is not None, "runtime TTS credentials missing"
    for text in ("നിങ്ങൾ നന്നായി ചെയ്തു.", "ഇന്ന് 12 തവണ പൂർത്തിയാക്കി.", "പതുക്കെ ശ്വസിക്കൂ."):
        stream = await primary.stream_audio(text)
        chunks = [c async for c in stream] if hasattr(stream, "__aiter__") else [stream]
        samples = np.concatenate([np.asarray(c.samples) for c in chunks])
        assert len(samples) / chunks[0].sample_rate > 0.2 and rms(samples.astype(np.int16)) > MIN_RMS
    await primary.close()
