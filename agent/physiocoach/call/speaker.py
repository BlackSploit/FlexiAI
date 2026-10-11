"""Speaker (§8.10): the only code that calls `agent.say`.

* Phrase-id utterances (counts, cues, prompts, rule notes, countdown) send ONE pc.caption with the
  joined ml/en, then `say()` each catalogue phrase id by id, so every call hits a pre-rendered clip.
  A joined multi-phrase string is never passed to say(): its hash is not in the catalogue.
* Free-text utterances: only the validated, prefetched LLM `ml` note.
* `agent.say` returns once the text is queued, not after playback (Vision Agents 0.6.9), so pacing
  uses clip durations: `busy_until`. A cue older than 1.5 s when its turn comes is dropped (never
  counts, prompts, notes or safety).
* Physio gate (barge-in): while the physio speaks nothing plays; captions still go out at once;
  queued counts collapse to the latest.
* Safety: caption sent immediately (awaited), queue flushed, current audio interrupted; the
  safety.stop audio plays first as soon as the gate is open. Nothing delays the halt itself.
* Live coach hooks (optional, default off): `hold(kind) -> seconds` is checked on the queue head BEFORE
  popleft, so a held prompt never blocks a safety clip or the physio gate (the wait is sliced at 0.2 s
  and wakes on every enqueue); `before_play(kind)` is a synchronous, non-blocking preempt called first
  thing in `_play`. Neither is ever allowed to raise into the playback loop.

Pure asyncio (no vision_agents import): `agent` only needs `say(text)` and `send_custom_event(dict)`.
"""

import asyncio
import json
import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Literal, Optional

from ..core import phrases

log = logging.getLogger(__name__)

Kind = Literal["count", "cue", "note", "prompt", "safety"]
MAX_CUE_AGE_S = 1.5
EST_S_PER_CHAR = 0.08          # runtime TTS duration estimate until measured
CAPTION_MAX_BYTES = 4800       # Stream custom events are max 5 KB


@dataclass
class Utterance:
    kind: Kind
    ids: tuple[str, ...] = ()
    text: Optional[str] = None
    ml: str = ""
    en: str = ""
    caption_id: str = ""
    enqueued_at: float = 0.0
    captioned: bool = False


@dataclass
class SpeakerStats:
    spoken: list[str] = field(default_factory=list)      # what was passed to say(), in order
    said_at: list[tuple[float, str]] = field(default_factory=list)   # (wall time, text) for latency spikes
    dropped_cues: int = 0


class Speaker:
    def __init__(self, agent, duration_of: Callable[[str], Optional[float]],
                 interrupt_audio: Optional[Callable[[], Awaitable[None]]] = None,
                 clock: Callable[[], float] = time.monotonic, max_cue_age: float = MAX_CUE_AGE_S,
                 hold: Optional[Callable[[Kind], float]] = None,
                 before_play: Optional[Callable[[Kind], None]] = None):
        self.agent, self.duration_of = agent, duration_of
        self.hold, self.before_play = hold, before_play
        self._in_play = False
        self._last_kind: Optional[Kind] = None
        self.interrupt_audio = interrupt_audio
        self.clock, self.max_cue_age = clock, max_cue_age
        self.busy_until = 0.0
        self.stats = SpeakerStats()
        self._queue: deque[Utterance] = deque()
        self._wake = asyncio.Event()
        self._gate_open = asyncio.Event()
        self._gate_open.set()
        self._idle = asyncio.Event()
        self._idle.set()
        self._tasks: set[asyncio.Task] = set()

    # ------------------------------------------------------------ enqueue
    def say_ids(self, ids: list[str] | tuple[str, ...], kind: Kind, caption_id: Optional[str] = None) -> None:
        ps = [phrases.get(i) for i in ids]                       # KeyError on unknown ids: a bug, fail loudly
        self._enqueue(Utterance(kind, tuple(ids), None, " ".join(p.ml for p in ps), " ".join(p.en for p in ps),
                                caption_id or ids[0]))

    def say_text(self, ml: str, en: str, kind: Kind = "note", caption_id: str = "note.llm") -> None:
        self._enqueue(Utterance(kind, (), ml, ml, en, caption_id))

    def _enqueue(self, u: Utterance) -> None:
        u.enqueued_at = self.clock()
        if not self._gate_open.is_set():
            if u.kind == "count":                               # gated: counts collapse to the latest
                self._queue = deque(x for x in self._queue if x.kind != "count")
            self._fire(self._caption(u))                        # captions still go out while gated
            u.captioned = True
        self._queue.append(u)
        self._idle.clear()
        self._wake.set()

    async def safety(self, ids: tuple[str, ...] = ("safety.stop",)) -> None:
        """Priority path: caption now, flush everything, interrupt audio; play first when the gate is open."""
        ps = [phrases.get(i) for i in ids]
        u = Utterance("safety", tuple(ids), None, " ".join(p.ml for p in ps), " ".join(p.en for p in ps), ids[0],
                      self.clock(), captioned=True)
        await self._caption(u)
        self._queue.clear()
        self._queue.append(u)
        self._idle.clear()
        if self._gate_open.is_set():
            await self._stop_current_audio()
        self._wake.set()

    # ------------------------------------------------------------ physio gate (barge-in)
    async def physio_started(self) -> None:
        self._gate_open.clear()
        await self._stop_current_audio()

    def physio_stopped(self) -> None:
        self._gate_open.set()
        self._wake.set()

    @property
    def physio_speaking(self) -> bool:
        return not self._gate_open.is_set()

    @property
    def busy(self) -> bool:
        """Something is queued, being handed to the audio path, or (by duration) still audible."""
        return bool(self._queue) or self._in_play or self.clock() < self.busy_until

    @property
    def playing_kind(self) -> Optional[Kind]:
        return self._last_kind if (self._in_play or self.clock() < self.busy_until) else None

    def _hold_for(self, kind: Kind) -> float:
        if self.hold is None or kind in ("safety", "count"):
            return 0.0
        try:
            return max(0.0, float(self.hold(kind) or 0.0))
        except Exception as e:  # noqa: BLE001 - a broken hook must never stall the clips
            log.warning("speaker hold hook failed: %s", e)
            return 0.0

    async def _stop_current_audio(self) -> None:
        self.busy_until = self.clock()
        if self.interrupt_audio:
            await self.interrupt_audio()

    # ------------------------------------------------------------ playback loop
    async def run(self) -> None:
        while True:
            if not self._queue:
                self._idle.set()
                self._wake.clear()
                await self._wake.wait()
                continue
            await self._gate_open.wait()
            wait = self.busy_until - self.clock()
            if wait > 0:                                        # let the current audio finish
                self._wake.clear()
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=wait)
                except asyncio.TimeoutError:
                    pass
                continue                                        # re-check gate, queue and priorities
            held = self._hold_for(self._queue[0].kind)         # BEFORE popleft: safety() can still clear it
            if held > 0:
                self._wake.clear()
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=min(held, 0.2))
                except asyncio.TimeoutError:
                    pass
                continue
            u = self._queue.popleft()
            if u.kind == "cue" and self.clock() - u.enqueued_at > self.max_cue_age:
                self.stats.dropped_cues += 1
                continue
            await self._play(u)

    async def wait_idle(self) -> None:
        """Until the queue is empty and the last audio has (by duration) finished."""
        await self._idle.wait()
        rest = self.busy_until - self.clock()
        if rest > 0:
            await asyncio.sleep(rest)

    async def _play(self, u: Utterance) -> None:
        if self.before_play is not None:
            try:
                self.before_play(u.kind)
            except Exception as e:  # noqa: BLE001 - the preempt is best effort; the clip always plays
                log.warning("speaker before_play hook failed: %s", e)
        self._in_play, self._last_kind = True, u.kind
        try:
            if not u.captioned:
                self._fire(self._caption(u))                    # fire-and-forget, say() right away
            texts = [phrases.get(i).ml for i in u.ids] if u.ids else [u.text or ""]
            start = max(self.busy_until, self.clock())
            total = 0.0
            for text in texts:
                self.stats.said_at.append((time.time(), text))
                await self.agent.say(text)
                self.stats.spoken.append(text)
                d = self.duration_of(text)
                total += d if d is not None else EST_S_PER_CHAR * len(text)
            self.busy_until = start + total
        finally:
            self._in_play = False

    # ------------------------------------------------------------ events
    async def _caption(self, u: Utterance) -> None:
        base = {"type": "pc.caption", "v": 1, "ts": int(time.time() * 1000), "id": u.caption_id, "kind": u.kind}
        payload = {**base, "eventId": uuid.uuid4().hex, "ml": u.ml, "en": u.en}
        if len(json.dumps(payload, ensure_ascii=False).encode()) <= CAPTION_MAX_BYTES:
            await self._send(payload)
        else:                                                   # Malayalam is 3 bytes/char: split ml and en
            await self._send({**base, "eventId": uuid.uuid4().hex, "ml": u.ml, "en": ""})
            await self._send({**base, "eventId": uuid.uuid4().hex, "ml": "", "en": u.en})

    async def _send(self, payload: dict) -> None:
        try:
            await self.agent.send_custom_event(payload)
        except Exception as e:  # noqa: BLE001 - captions are best effort
            log.warning("caption send failed: %s", e)

    def _fire(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
