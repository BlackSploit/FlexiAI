"""Build the agent's single TTS from env (§8.10, §13.1)."""

import logging
import os
from pathlib import Path
from typing import Callable, Optional

from vision_agents.core.tts import TTS

from .cached_tts import CachedMalayalamTTS
from .google_tts import build_runtime_tts
from .manifest import Manifest

log = logging.getLogger(__name__)


def build_tts() -> tuple[TTS, Callable[[str], Optional[float]]]:
    """(tts, duration_of). Clips for VOICE_SLUG + runtime TTS for free text (LLM notes).

    Without a rendered voice the agent stays silent (dev only) instead of crashing the call.
    """
    slug = os.getenv("VOICE_SLUG", "")
    try:
        manifest = Manifest.load(slug)
    except (FileNotFoundError, KeyError) as e:
        from ..call.silent_tts import SilentTTS
        log.warning("no rendered voice for VOICE_SLUG=%r (%s): the coach will be SILENT", slug, type(e).__name__)
        return SilentTTS(), lambda text: None
    primary, fallback = build_runtime_tts(os.getenv("TTS_PRIMARY", "sarvam"), os.getenv("SARVAM_SPEAKER", "shubh"),
                                          os.getenv("GOOGLE_TTS_VOICE", "ml-IN-Chirp3-HD-Kore"),
                                          float(os.getenv("TTS_PACE", "0.9")))
    tts = CachedMalayalamTTS(manifest, Path(os.getenv("PC_VOICE_CACHE", "cache/voice")), primary, fallback)
    log.info("voice %s; runtime TTS primary=%s fallback=%s", slug,
             primary.provider_name if primary else None, fallback.provider_name if fallback else None)
    return tts, tts.duration_s
