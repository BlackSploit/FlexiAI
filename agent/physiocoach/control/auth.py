"""HMAC auth for the control API (§7.9): x-pc-signature over "<t>.<METHOD>.<pathWithQuery>.<sha256(body)>"."""

import os

from fastapi import HTTPException, Request

from ..core.signing import HEADER, verify


def path_with_query(request: Request) -> str:
    q = request.url.query
    return request.url.path + (f"?{q}" if q else "")


async def require_signature(request: Request) -> bytes:
    """FastAPI dependency: returns the raw body once the signature checks out (401 otherwise)."""
    body = await request.body()
    secret = os.getenv("AGENT_CONTROL_SECRET", "")
    if not verify(secret, request.method, path_with_query(request), body, request.headers.get(HEADER)):
        raise HTTPException(status_code=401, detail="bad signature")
    return body
