"""Every shared/fixtures/**/valid/*.json parses with the pydantic models; every invalid/*.json fails.

vitest runs the same fixtures against the zod schemas (tests/fixtures.test.ts), so drift fails CI.
"""

import json
from pathlib import Path
from typing import Union

import pytest
from pydantic import TypeAdapter, ValidationError

from physiocoach.core.config import shared_dir
from physiocoach.core.contracts import (
    AgentToClientEvent, ClientToAgentEvent, StartAgentRequest, callback_adapter,
)

ROOT = shared_dir() / "fixtures"
ANY_EVENT = TypeAdapter(Union[ClientToAgentEvent, AgentToClientEvent])
ADAPTERS = {"events": ANY_EVENT, "agent-callbacks": callback_adapter, "control": TypeAdapter(StartAgentRequest)}


def files(kind: str) -> list[tuple[str, Path]]:
    out = [(g, p) for g in ADAPTERS for p in sorted((ROOT / g / kind).glob("*.json"))]
    assert out, f"no {kind} fixtures"
    return out


@pytest.mark.parametrize("group,path", files("valid"), ids=lambda x: getattr(x, "stem", x))
def test_valid_fixture_parses(group, path):
    ADAPTERS[group].validate_json(path.read_bytes())


@pytest.mark.parametrize("group,path", files("invalid"), ids=lambda x: getattr(x, "stem", x))
def test_invalid_fixture_is_rejected(group, path):
    with pytest.raises(ValidationError):
        ADAPTERS[group].validate_json(path.read_bytes())


def _types(group: str, kind: str) -> set[str]:
    return {json.loads(p.read_text(encoding="utf-8")).get("type") for p in (ROOT / group / kind).glob("*.json")}


def test_every_type_has_a_valid_and_an_invalid_example():
    assert len(_types("events", "valid")) == 13            # 4 client -> agent + 9 agent -> client
    assert len(_types("agent-callbacks", "valid")) == 7
    for group in ("events", "agent-callbacks"):
        missing = _types(group, "valid") - _types(group, "invalid")
        assert not missing, f"{group}: no invalid example for {missing}"
