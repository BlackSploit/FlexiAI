"""Inbound client events (§8.12, §7.7, §7.8).

Two channels, deduplicated by eventId (whichever copy arrives first wins):
* Primary: Stream custom events. Vision Agents has no public API for receiving them; getstream
  4.3.0's ConnectionManager re-emits coordinator events as `emit("custom", <raw event dict>)` with
  the payload under `ev["custom"]` and the sender under `ev["user"]["id"]`. We reach it through the
  PRIVATE edge attribute after join (pinned vision-agents==0.6.9; tests/smoke guards it).
* Backup: Redis `pc:input:{sessionId}`, published by the worker's /input endpoint from the web's
  authenticated join.sendInput / sessions.sendInput. Message: {"sender": <user id>, "event": {...}}.

Safety triggers (pc.stop, pc.symptom, pc.pain_score >= 7) call flow.halt() synchronously in the
handler, before anything else, so the halt never waits behind a queue or a network call.
"""

import asyncio
import json
import logging
from collections import OrderedDict
from typing import Awaitable, Callable, Optional

from pydantic import ValidationError

from ..core.config import PAIN_ALERT_THRESHOLD
from ..core.contracts import ConsentEvent, PainScoreEvent, StopEvent, SymptomEvent, client_event_adapter

log = logging.getLogger(__name__)

EventHandler = Callable[[Optional[str], dict], Awaitable[None]]
DEDUPE_SIZE = 512


class InputRouter:
    def __init__(self, flow, patient_id: str, physio_id: str, agent_user_id: str):
        self.flow, self.patient_id, self.physio_id, self.agent_user_id = flow, patient_id, physio_id, agent_user_id
        self._seen: OrderedDict[str, None] = OrderedDict()
        self.accepted: list[str] = []                 # event types accepted (diagnostics)

    async def handle(self, sender: Optional[str], data: dict) -> None:
        if sender == self.agent_user_id:
            return                                    # our own events echo back
        try:
            ev = client_event_adapter.validate_python(data)
        except ValidationError:
            if str(data.get("type", "")).startswith("pc."):
                log.info("invalid %s from %s ignored", data.get("type"), sender)
            return
        allowed = {self.patient_id, self.physio_id} if isinstance(ev, StopEvent) else {self.patient_id}
        if sender not in allowed:
            log.warning("%s from %s rejected (sender not allowed)", ev.type, sender)
            return
        if ev.eventId in self._seen:
            return
        self._seen[ev.eventId] = None
        while len(self._seen) > DEDUPE_SIZE:
            self._seen.popitem(last=False)
        self.accepted.append(ev.type)
        self.flow.on_input()

        if isinstance(ev, StopEvent):
            self.flow.halt("stop", ev.eventId)
        elif isinstance(ev, SymptomEvent):
            self.flow.halt("symptom", ev.eventId, symptom=ev.kind)
        elif isinstance(ev, PainScoreEvent):
            if ev.score >= PAIN_ALERT_THRESHOLD:
                self.flow.halt("pain", ev.eventId, score=ev.score)     # first: nothing may delay the halt
            await self.flow.on_pain(ev.score, ev.setIndex, ev.eventId)
        elif isinstance(ev, ConsentEvent):
            self.flow.on_consent()


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


async def redis_inputs(redis, session_id: str, on_event: EventHandler) -> None:
    """Backup channel: SUBSCRIBE pc:input:{sid}. Reconnects on errors until cancelled."""
    channel = f"pc:input:{session_id}"
    while True:
        try:
            pubsub = redis.pubsub()
            await pubsub.subscribe(channel)
            log.info("backup input channel %s subscribed", channel)
            async for msg in pubsub.listen():
                if msg.get("type") != "message":
                    continue
                try:
                    payload = json.loads(msg["data"])
                    await on_event(payload.get("sender"), payload.get("event") or {})
                except (ValueError, TypeError) as e:
                    log.warning("bad backup input message: %s", e)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - keep the backup channel alive
            log.warning("backup input channel error (%s); reconnecting", e)
            await asyncio.sleep(2)
