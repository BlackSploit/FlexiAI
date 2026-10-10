"""Voice manifest (§9.3) and the clip/cache key shared by the renderer and the runtime TTS.

agent/assets/voice/<voice_slug>/manifest.json:
  {"voice": {...}, "generated_at": ..., "phrases": [{"id", "category", "text_ml", "gloss_en", "hash",
   "file", "duration_ms", "review": {"status", "reviewer", "notes"}}]}
"""

import hashlib
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from ..core.phrases import nfc


def text_hash(text: str, voice_slug: str) -> str:
    """Identical for pre-rendered clips and the runtime disk cache."""
    return hashlib.sha256(f"{voice_slug}|{nfc(text)}".encode("utf-8")).hexdigest()[:16]


def assets_dir() -> Path:
    """`PC_VOICE_ASSETS` (Docker: /opt/voice) or agent/assets/voice."""
    env = os.getenv("PC_VOICE_ASSETS")
    return Path(env) if env else Path(__file__).resolve().parents[2] / "assets" / "voice"


@dataclass
class Manifest:
    voice_slug: str
    root: Path                               # .../assets/voice/<slug>
    voice: dict = field(default_factory=dict)
    by_id: dict[str, dict] = field(default_factory=dict)
    by_hash: dict[str, dict] = field(default_factory=dict)

    @classmethod
    def load(cls, voice_slug: str, base: Path | None = None) -> "Manifest":
        root = (base or assets_dir()) / voice_slug
        data = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        m = cls(voice_slug, root, data.get("voice", {}))
        for p in data["phrases"]:
            m.by_id[p["id"]] = p
            m.by_hash[p["hash"]] = p
        return m

    def path(self, entry: dict) -> Path:
        return self.root / entry["file"]

    def duration_s(self, text: str) -> float | None:
        e = self.by_hash.get(text_hash(text, self.voice_slug))
        return e["duration_ms"] / 1000 if e else None
