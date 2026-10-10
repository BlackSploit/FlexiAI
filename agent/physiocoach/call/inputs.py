"""Inbound client events (§8.12).

Vision Agents has no public API for receiving Stream custom events. getstream 4.3.0's
ConnectionManager re-emits coordinator events as `emit("custom", <raw event dict>)`, with the
payload under `ev["custom"]` and the sender under `ev["user"]["id"]`. We reach it through the
PRIVATE edge attribute after join (pinned vision-agents==0.6.9; tests/smoke guards it).

The coordinator watch starts in a background task after join, so events sent before it is up are
lost: hence the pc.ready handshake and the client re-sending pc.consent until the phase moves.
The Redis inbox (fed by the web's backup tRPC path) is the second channel (Milestone 4/5).
"""

import asyncio
import logging
from typing import Awaitable, Callable

log = logging.getLogger(__name__)

EventHandler = Callable[[str | None, dict], Awaitable[None]]


def hook_custom_events(agent, on_event: EventHandler) -> None:
    edge = agent.edge
    conn = getattr(edge, "_real_connection", None) or edge._connection   # private; pinned vision-agents==0.6.9
    loop = asyncio.get_running_loop()
    tasks: set[asyncio.Task] = set()

    def _on_custom(ev: dict) -> None:
        sender = (ev.get("user") or {}).get("id")
        data = ev.get("custom") or {}
        task = loop.create_task(on_event(sender, data))
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    conn.on("custom", _on_custom)
    log.info("custom-event hook installed on %s", type(conn).__name__)
