"""HMAC request signing shared by web <-> worker (§4.3 lib/signing.ts, §7.6, §7.9).

Header:  x-pc-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<METHOD>.<pathWithQuery>.<sha256hex(body)>")>

Binding the method and path stops a captured signed `GET /sessions/A` being replayed as
`DELETE /sessions/B` (empty bodies hash identically). Mirrors src/lib/signing.ts exactly.
"""

import hashlib
import hmac
import time
from typing import Optional

HEADER = "x-pc-signature"


def canonical(t: int, method: str, path_with_query: str, body: bytes) -> bytes:
    return f"{t}.{method.upper()}.{path_with_query}.{hashlib.sha256(body).hexdigest()}".encode()


def sign(secret: str, method: str, path_with_query: str, body: bytes, t: Optional[int] = None) -> str:
    t = int(time.time()) if t is None else t
    mac = hmac.new(secret.encode(), canonical(t, method, path_with_query, body), hashlib.sha256).hexdigest()
    return f"t={t},v1={mac}"


def verify(secret: str, method: str, path_with_query: str, body: bytes, header: Optional[str],
           max_age_s: int = 300, now: Optional[int] = None) -> bool:
    if not secret or not header:
        return False
    try:
        parts = dict(p.split("=", 1) for p in header.split(","))
        t, given = int(parts["t"]), parts["v1"]
    except (ValueError, KeyError):
        return False
    now = int(time.time()) if now is None else now
    if abs(now - t) > max_age_s:
        return False
    expected = hmac.new(secret.encode(), canonical(t, method, path_with_query, body), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, given)
