"""Paths and the per-session config handed to each agent process."""

import os
from pathlib import Path

from .contracts import StartAgentRequest

# agent/physiocoach/core/config.py -> repo root is three levels above `core`.
_REPO_ROOT = Path(__file__).resolve().parents[3]

PAIN_ALERT_THRESHOLD = 7

# The session config mirrors the web's StartAgentRequest (§7.7) exactly.
SessionConfig = StartAgentRequest


def shared_dir() -> Path:
    """`PC_SHARED_DIR` (Docker: /app/shared), else `<repo>/shared`."""
    env = os.getenv("PC_SHARED_DIR")
    return Path(env) if env else _REPO_ROOT / "shared"


def load_session_config(raw: str | None = None) -> SessionConfig:
    """Parse the supervisor-provided `PC_SESSION_JSON`."""
    raw = raw if raw is not None else os.environ["PC_SESSION_JSON"]
    return SessionConfig.model_validate_json(raw)
