"""shared/fixtures/signing/vectors.json: the same vectors tests/security.test.ts checks against src/lib/signing.ts."""

import json

import pytest

from physiocoach.core import signing
from physiocoach.core.config import shared_dir

VECTORS = json.loads((shared_dir() / "fixtures" / "signing" / "vectors.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("v", VECTORS, ids=lambda v: f"{v['method']} {v['path']}")
def test_vector(v):
    body = v["body"].encode("utf-8")
    assert signing.sign(v["secret"], v["method"], v["path"], body, t=v["t"]) == v["header"]
    assert signing.verify(v["secret"], v["method"], v["path"], body, v["header"], now=v["t"])
