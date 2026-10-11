"""Live Coach: the pure logic behind the OpenAI Realtime voice coach (WP1a). No vision_agents/openai imports.

One owner per job (D1): RepEngine + Flow own counts, scores, phases and safety; cached clips own every
scripted cue; the realtime model only holds short conversations, gives one proactive comment at rest
and short replies after tool calls. Everything here is gated locally, reading Flow state directly:

* output gate (`accept_rt_pcm`)  realtime PCM reaches the agent track only while the coach is up, the
  flow is not halted/paused, consent is given, the phase is conversational, the physio is silent, no clip
  is busy and the model is actually speaking (B9, D2). The first drop in a response cancels it (once).
* input gate (`input_open`)      half-duplex patient audio (B6, D3).
* hold / before_clip             clips win: prompts wait (max 5 s) while the coach thinks/speaks or the
  patient is mid-utterance; safety and counts never wait; a playing clip preempts the coach without
  flushing earlier clips (B4, B7).
* on_halt                        called synchronously from Flow.halt (B5): latch, gates closed, cancel.
* ResponseScheduler              at most one response in flight; requests coalesce (B11).

`LiveCoachTools` are the model's tools; `CoachFacade` puts the coach in front of the real agent so every
outgoing client event is observed (before it is sent, B5) and clips bypass the silent `agent.say()`.
"""

import asyncio
import logging
import math
import re
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Mapping, Optional, Protocol

from . import voice_safety

log = logging.getLogger(__name__)

CONVERSATIONAL = frozenset({"positioning", "summary", "await_pain", "rest"})
PROTECTED = frozenset({"countdown", "set", "halted"})
HOLD_MAX_S = 5.0
COACH_TAIL_S = 0.3              # input stays closed this long after the coach's last audio (echo tail)
RECENT_PCM_S = 0.5              # local flush only if realtime PCM was written this recently (B7)
RT_STUCK_S = 6.0                # rt_state auto-reset (H8)
KEEPALIVE_S = 15.0              # pc.voice keepalive while up (H3)
REPLY_WAIT_S = 5.0              # a tool reply waits this long for the Speaker to go idle
PAIN_DEDUPE_S = 10.0
MAX_FAILED_RESPONSES = 3
TRANSCRIPT_MAX = 400
HARMLESS_ERROR_CODES = frozenset({
    "conversation_already_has_active_response", "response_cancel_not_active", "item_not_found",
    "invalid_value_item_not_found", "item_truncate_invalid_item_id",
})
_HARMLESS_FRAGMENTS = ("active_response", "cancel_not_active", "not_found", "no_active_response")

# ------------------------------------------------------------------------------------------ settings

_OFF = {"off", "false", "0", "no", "disabled"}
_ON = {"on", "true", "1", "yes", "enabled"}


@dataclass(frozen=True)
class LiveCoachSettings:
    enabled: bool = False
    reason: str = "disabled"
    warn: bool = False                              # e.g. LIVE_COACH=on without a key
    realtime_model: str = "gpt-realtime-2"          # the plugin default (vision-agents-plugins-openai 0.6.9)
    voice: str = "marin"
    video: bool = False                             # stills are WP1b; send_video stays False regardless
    set_listen: bool = True
    barge_in: bool = False
    partials: bool = False
    connect_timeout_s: float = 6.0
    vad_eagerness: str = "medium"
    speed: float = 0.95
    transcribe_lang: Optional[str] = "patient"      # "patient" = cfg.patient.lang; None = auto-detect
    transcribe_model: str = "gpt-4o-mini-transcribe"
    noise_reduction: Optional[str] = "far_field"
    reasoning_effort: Optional[str] = None          # omitted unless set (reasoning realtime models only)


def _env(env: Mapping[str, str], key: str) -> Optional[str]:
    v = env.get(key)
    if v is None:
        return None
    v = str(v).strip()
    return v or None                                # set-but-empty == unset (compose passes ${VAR:-})


def _flag(env, key: str, default: bool) -> bool:
    v = (_env(env, key) or "").lower()
    if v in _ON:
        return True
    if v in _OFF:
        return False
    return default


def _num(env, key: str, default: float, lo: float, hi: float) -> float:
    v = _env(env, key)
    if v is None:
        return default
    try:
        x = float(v)
    except ValueError:
        return default
    return x if math.isfinite(x) and lo <= x <= hi else default


def _choice(env, key: str, default: Optional[str], allowed: set) -> Optional[str]:
    v = (_env(env, key) or "").lower()
    return v if v in allowed else default


def resolve_live_coach_settings(env: Mapping[str, str]) -> LiveCoachSettings:
    """Pure (D10). On only with OPENAI_API_KEY and LIVE_COACH not off/false/0/no. Bad values -> defaults."""
    key = _env(env, "OPENAI_API_KEY")
    flag = (_env(env, "LIVE_COACH") or "").lower()
    if flag in _OFF:
        enabled, reason, warn = False, f"LIVE_COACH={flag}", False
    elif not key:
        enabled, reason, warn = False, "OPENAI_API_KEY not set", flag in _ON
        if warn:
            reason = "LIVE_COACH=on but OPENAI_API_KEY is not set"
    else:
        enabled, reason, warn = True, ("LIVE_COACH=on" if flag in _ON else "OPENAI_API_KEY set"), False
    lang = (_env(env, "LIVE_COACH_TRANSCRIBE_LANG") or "patient").lower()
    if lang == "auto":
        transcribe_lang: Optional[str] = None
    elif lang == "patient" or re.fullmatch(r"[a-z]{2}", lang):
        transcribe_lang = lang
    else:
        transcribe_lang = "patient"
    nr = (_env(env, "LIVE_COACH_NOISE_REDUCTION") or "far_field").lower()
    return LiveCoachSettings(
        enabled=enabled, reason=reason, warn=warn,
        realtime_model=_env(env, "OPENAI_REALTIME_MODEL") or "gpt-realtime-2",
        voice=_env(env, "OPENAI_REALTIME_VOICE") or "marin",
        video=_flag(env, "LIVE_COACH_VIDEO", False),
        set_listen=_flag(env, "LIVE_COACH_SET_LISTEN", True),
        barge_in=_flag(env, "LIVE_COACH_BARGE_IN", False),
        partials=_flag(env, "LIVE_COACH_PARTIALS", False),
        connect_timeout_s=_num(env, "LIVE_COACH_CONNECT_TIMEOUT_S", 6.0, 1.0, 30.0),
        vad_eagerness=_choice(env, "LIVE_COACH_VAD_EAGERNESS", "medium", {"low", "medium", "high", "auto"}),
        speed=_num(env, "LIVE_COACH_SPEED", 0.95, 0.25, 1.5),
        transcribe_lang=transcribe_lang,
        transcribe_model=_env(env, "LIVE_COACH_TRANSCRIBE_MODEL") or "gpt-4o-mini-transcribe",
        noise_reduction=None if nr in _OFF else (nr if nr in ("far_field", "near_field") else "far_field"),
        reasoning_effort=_choice(env, "OPENAI_REALTIME_REASONING_EFFORT", None,
                                 {"minimal", "low", "medium", "high"}),
    )


# ------------------------------------------------------------------------------------------ session dicts

def transcription_language(settings: LiveCoachSettings, patient_lang: Optional[str]) -> Optional[str]:
    if settings.transcribe_lang == "patient":
        return patient_lang or None
    return settings.transcribe_lang


def _audio_input(settings: LiveCoachSettings, *, lang: Optional[str], minimal: bool, in_set: bool) -> dict:
    """The FULL audio.input object (B13): session.update replaces it, so every update carries all of it."""
    if in_set:
        td: dict[str, Any] = {"type": "server_vad", "silence_duration_ms": 450,
                              "create_response": False, "interrupt_response": False}
    elif minimal:
        td = {"type": "semantic_vad"}
    else:
        td = {"type": "semantic_vad", "eagerness": settings.vad_eagerness,
              "create_response": True, "interrupt_response": True}
    transcription: dict[str, Any] = {"model": settings.transcribe_model}
    if not minimal:
        from .coach_prompt import transcription_prompt
        if lang:
            transcription["language"] = lang
        transcription["prompt"] = transcription_prompt(lang)
    out: dict[str, Any] = {"transcription": transcription, "turn_detection": td}
    if not minimal and settings.noise_reduction:
        out["noise_reduction"] = {"type": settings.noise_reduction}
    return out


def build_realtime_session(settings: LiveCoachSettings, *, lang: Optional[str] = None,
                           instructions: Optional[str] = None, minimal: bool = False) -> dict:
    """RealtimeSessionCreateRequestParam as a plain dict (shared with check_realtime, H13)."""
    output: dict[str, Any] = {"voice": settings.voice}
    if not minimal:
        output["speed"] = settings.speed
    session: dict[str, Any] = {
        "type": "realtime",
        "model": settings.realtime_model,
        "output_modalities": ["audio"],
        "audio": {"input": _audio_input(settings, lang=lang, minimal=minimal, in_set=False), "output": output},
    }
    if instructions:
        session["instructions"] = instructions
    if settings.reasoning_effort and not minimal:
        session["reasoning"] = {"effort": settings.reasoning_effort}
    return session


def build_set_update(settings: LiveCoachSettings, *, in_set: bool, lang: Optional[str] = None,
                     minimal: bool = False) -> dict:
    """session.update for countdown/set (server_vad, no auto responses) or back to conversation (D4)."""
    return {"type": "session.update",
            "session": {"type": "realtime",
                        "audio": {"input": _audio_input(settings, lang=lang, minimal=minimal, in_set=in_set)}}}


def system_item(text: str) -> dict:
    return {"type": "conversation.item.create",
            "item": {"type": "message", "role": "system", "content": [{"type": "input_text", "text": text}]}}


def lang_of(text: str) -> Optional[str]:
    letters = [c for c in text if c.isalpha() or 0x0D00 <= ord(c) <= 0x0D7F]
    if not letters:
        return None
    ml = sum(1 for c in letters if 0x0D00 <= ord(c) <= 0x0D7F)
    if ml / len(letters) >= 0.3:
        return "ml"
    latin = sum(1 for c in letters if c.isascii())
    return "en" if latin / len(letters) >= 0.7 else "other"


def envelope(type_: str, **fields) -> dict:
    return {"type": type_, "v": 1, "eventId": uuid.uuid4().hex, "ts": int(time.time() * 1000), **fields}


# ------------------------------------------------------------------------------------------ guardrail

COACH_DENY = re.compile(
    r"\b(tablets?|pills?|capsules?|medicines?|medications?|painkillers?|paracetamol|ibuprofen|diclofenac|"
    r"aspirin|dose|dosage|\d+\s?mg|ointment|injections?|diagnos\w*|fractured?|torn|ligament|arthritis|"
    r"tendonitis|surgery|more sets|extra sets?|skip (the|this|your) (set|exercise)|"
    r"increase (the|your) (target|reps|repetitions|sets)|change (the|your) (prescription|exercise))\b"
    r"|ഗുളിക|മരുന്ന|ഓപ്പറേഷൻ|ശസ്ത്രക്രിയ",
    re.IGNORECASE)
REDIRECT_OK = ("physio", "ഫിസിയോ")
_SENTENCE_END = re.compile(r"[.!?\n।]")


def tripwire_hit(sentence: str) -> bool:
    low = sentence.lower()
    if any(k in low for k in REDIRECT_OK):          # the redirect line to the physiotherapist (H4)
        return False
    return bool(COACH_DENY.search(sentence))


# ------------------------------------------------------------------------------------------ ports

class RealtimePort(Protocol):
    @property
    def up(self) -> bool: ...

    async def send_event(self, ev: dict) -> None: ...

    def flush_local(self) -> None: ...

    async def start_connect(self) -> None: ...


class ResponseScheduler:
    """At most one response in flight; extra requests coalesce into one pending request (B11)."""

    def __init__(self, send: Callable[[dict], None], may_fire: Callable[[], bool],
                 clock: Callable[[], float] = time.monotonic):
        self._send, self._may_fire, self.clock = send, may_fire, clock
        self.in_flight = False
        self.pending = False
        self._since = 0.0
        self.sent = 0

    def request(self) -> bool:
        self._unstick()
        if self.in_flight:
            self.pending = True
            return False
        if not self._may_fire():
            return False
        self.in_flight, self._since = True, self.clock()
        self.sent += 1
        self._send({"type": "response.create"})
        return True

    def on_created(self) -> None:
        self.in_flight, self._since = True, self.clock()

    def on_done(self) -> None:
        self.in_flight = False
        if self.pending:
            self.pending = False
            self.request()

    def on_active_conflict(self) -> None:
        """Our response.create hit an already-active response: retry once that one finishes."""
        self.in_flight, self.pending, self._since = True, True, self.clock()

    def clear(self) -> None:
        self.pending = False

    def _unstick(self) -> None:
        if self.in_flight and self.clock() - self._since > RT_STUCK_S:
            self.in_flight = False


# ------------------------------------------------------------------------------------------ the coach

@dataclass
class CoachStats:
    sent: list[dict] = field(default_factory=list)          # every event handed to the port (tests)
    voice: list[tuple[str, bool]] = field(default_factory=list)
    transcripts: list[dict] = field(default_factory=list)
    local_flushes: int = 0
    trips: int = 0
    spotted: list[str] = field(default_factory=list)


class LiveCoach:
    def __init__(self, cfg, settings: LiveCoachSettings, send_custom_event: Callable[[dict], Awaitable[None]],
                 clock: Callable[[], float] = time.monotonic):
        self.cfg, self.settings, self.clock = cfg, settings, clock
        self.patient_id = cfg.patient.id
        self.lang = transcription_language(settings, cfg.patient.lang)
        self._send_custom = send_custom_event
        self.flow = self.router = self.speaker = self.pose = None
        self.port: Optional[RealtimePort] = None
        self.down = False
        self.down_reason: Optional[str] = None
        self.minimal = False                         # the minimal-session retry is in use
        self.halted_latch = False
        self.rt_state = "idle"                       # idle | thinking | speaking (model side)
        self._rt_at = -1e9
        self.user_speaking = False
        self._user_at = -1e9
        self.suppress = False                        # the current response may not be heard any more
        self._cancel_sent = False                    # cancel already sent for the current response
        self._played_this_response = False
        self.last_rt_pcm_at = -1e9                   # realtime PCM last written to the agent track
        self._hold_since: Optional[float] = None
        self._failures = 0
        self._connect_requested = False
        self._was_up = False
        self._voice_sent: Optional[tuple[str, bool]] = None
        self._voice_at = -1e9
        self._down_announced = False
        self._rest_cued: set[int] = set()
        self._coach_text: dict[str, str] = {}
        self._coach_checked: dict[str, int] = {}
        self._pain_seen: dict[tuple[int, int], float] = {}
        self._out: deque[dict] = deque()
        self._out_wake: Optional[asyncio.Event] = None
        self._sender: Optional[asyncio.Task] = None
        self._tasks: set[asyncio.Task] = set()
        self.stats = CoachStats()
        self.scheduler = ResponseScheduler(self._enqueue, self._can_speak, clock)
        self.tools = LiveCoachTools(self)

    # -------------------------------------------------------------- wiring
    def bind(self, flow, router, speaker, pose=None) -> None:
        self.flow, self.router, self.speaker, self.pose = flow, router, speaker, pose
        flow.halt_listeners.append(self.on_halt)

    def attach_port(self, port: RealtimePort) -> None:
        self.port = port

    @property
    def bound(self) -> bool:
        return self.flow is not None and self.router is not None and self.speaker is not None

    @property
    def up(self) -> bool:
        try:
            return self.port is not None and bool(self.port.up) and not self.down
        except Exception:  # noqa: BLE001
            return False

    # -------------------------------------------------------------- reads (never raise)
    def _now(self) -> float:
        return self.clock()

    def _physio_speaking(self) -> bool:
        return bool(self.speaker is not None and self.speaker.physio_speaking)

    def _speaker_busy(self) -> bool:
        return bool(self.speaker is not None and self.speaker.busy)

    def _halted(self) -> bool:
        return self.halted_latch or bool(self.flow is not None and self.flow.halted)

    def _conversational(self) -> bool:
        f = self.flow
        return (f is not None and not self._halted() and not f.paused and bool(f.consent_given)
                and f.phase in CONVERSATIONAL)

    def _pcm_recent(self, window: float) -> bool:
        return self._now() - self.last_rt_pcm_at < window

    def _check_stuck(self) -> None:
        now = self._now()
        if self.rt_state != "idle" and now - max(self._rt_at, self.last_rt_pcm_at) > RT_STUCK_S:
            self.rt_state = "idle"                  # H8: a hung response never holds clips forever
        if self.user_speaking and now - self._user_at > 15.0:
            self.user_speaking = False

    def _set_rt(self, state: str) -> None:
        self.rt_state, self._rt_at = state, self._now()

    def _can_speak(self) -> bool:
        return self.up and self._conversational() and not self._physio_speaking()

    def output_open(self) -> bool:
        """Would realtime audio be audible now (D2)? Requires the model to be speaking."""
        self._check_stuck()
        return (self._can_speak() and not self._speaker_busy() and self.rt_state == "speaking"
                and not self.suppress)

    def input_open(self, uid: Optional[str]) -> bool:
        """Forward this participant's audio to OpenAI now (D3, half-duplex by default)?"""
        try:
            f = self.flow
            if (not self.up or uid != self.patient_id or f is None or not f.consent_given or self._halted()
                    or f.paused or f.phase in ("done", "halted", "waiting") or self._physio_speaking()):
                return False
            if f.phase in ("countdown", "set"):
                return self.settings.set_listen
            if f.phase not in CONVERSATIONAL or self._speaker_busy():
                return False
            return self.settings.barge_in or not self._pcm_recent(COACH_TAIL_S)
        except Exception:  # noqa: BLE001
            return False

    # -------------------------------------------------------------- clips (Speaker hooks)
    def hold(self, kind: str) -> float:
        """Seconds the Speaker should wait before playing the queue head (checked before popleft, B4)."""
        try:
            self._check_stuck()
            if kind in ("safety", "count") or not self.up or not self._conversational():
                self._hold_since = None
                return 0.0
            busy = (self.rt_state in ("thinking", "speaking") and not self.suppress) or self.user_speaking
            if not busy:
                self._hold_since = None
                return 0.0
            now = self._now()
            if self._hold_since is None:
                self._hold_since = now
            left = HOLD_MAX_S - (now - self._hold_since)
            if left <= 0:
                self._hold_since = None
                return 0.0
            return left
        except Exception:  # noqa: BLE001
            return 0.0

    def before_clip(self, kind: str) -> None:
        """Non-blocking preempt: a clip is about to play, the coach yields (B7: no flush of earlier clips)."""
        try:
            self._preempt()
        except Exception as e:  # noqa: BLE001
            log.debug("before_clip preempt failed: %s", e)

    def _preempt(self) -> None:
        active = (self.rt_state != "idle" or self._pcm_recent(RECENT_PCM_S) or self.scheduler.in_flight
                  or self.scheduler.pending)
        self.scheduler.clear()
        self._drop_queued_responses()
        if not active:
            return
        self.suppress = True
        self._set_rt("idle")
        self._send_cancel()
        self._maybe_flush_local()

    def _send_cancel(self) -> None:
        if self.up and not self._cancel_sent:
            self._cancel_sent = True
            self._enqueue({"type": "response.cancel"})
            self._enqueue({"type": "output_audio_buffer.clear"})

    def _maybe_flush_local(self) -> None:
        if self.port is not None and self._pcm_recent(RECENT_PCM_S):
            try:
                self.port.flush_local()
                self.stats.local_flushes += 1
            except Exception as e:  # noqa: BLE001
                log.debug("local flush failed: %s", e)
            self.last_rt_pcm_at = -1e9

    # -------------------------------------------------------------- safety / physio
    def on_halt(self, reason: str) -> None:
        """Flow.halt listener: synchronous, same tick, never raises (B5)."""
        try:
            self.halted_latch = True
            self.scheduler.clear()
            self._drop_queued_responses()
            was_active = self.rt_state != "idle" or self._pcm_recent(RECENT_PCM_S) or self.scheduler.in_flight
            self.suppress = True
            self._set_rt("idle")
            if was_active:
                self._cancel_sent = False
                self._send_cancel()
            self._maybe_flush_local()
            self._update_voice()
        except Exception as e:  # noqa: BLE001
            log.warning("coach on_halt failed: %s", e)

    async def on_physio_started(self) -> None:
        try:
            self._preempt()
            self._update_voice()
        except Exception as e:  # noqa: BLE001
            log.debug("coach on_physio_started failed: %s", e)

    def on_physio_stopped(self) -> None:
        try:
            self._update_voice()
        except Exception:  # noqa: BLE001
            pass

    # -------------------------------------------------------------- connection
    def on_connected(self, minimal: bool = False) -> None:
        self.minimal = minimal
        self._was_up = True
        log.info("live coach connected (%s session)", "minimal" if minimal else "full")
        f = self.flow
        if f is not None:
            if f.phase in ("countdown", "set"):
                self._enqueue(build_set_update(self.settings, in_set=True, lang=self.lang, minimal=minimal))
            self._state_item(f"phase={f.phase} set={f.set_index}/{f.rx.sets}")
        self._update_voice(force=True)

    def mark_down(self, reason: str) -> None:
        if self.down:
            return
        self.down, self.down_reason = True, reason
        log.warning("live coach down (%s): clips continue", reason)
        self.suppress = True
        self._set_rt("idle")
        self.scheduler.clear()
        self._out.clear()
        if self._was_up or self._connect_requested:
            self._announce_down()

    def _announce_down(self) -> None:
        if not self._down_announced:
            self._down_announced = True
            self._voice_sent = ("off", False)
            self.stats.voice.append(("off", False))
            self._fire(self._custom(envelope("pc.voice", state="off", live=False)))

    # -------------------------------------------------------------- realtime events (adapter hooks)
    def on_rt_event(self, ev: dict) -> bool:
        """Bookkeeping for one OpenAI event. Returns True when the adapter must NOT call super (swallow)."""
        et = ev.get("type", "")
        try:
            if et == "input_audio_buffer.speech_started":
                return self.on_user_speech_started()
            if et in ("input_audio_buffer.speech_stopped", "input_audio_buffer.committed"):
                self.on_user_committed()
            elif et == "conversation.item.input_audio_transcription.completed":
                self.on_user_transcript(str(ev.get("item_id") or uuid.uuid4().hex), str(ev.get("transcript") or ""))
            elif et == "response.created":
                self.on_response_created()
            elif et in ("response.output_audio_transcript.delta", "response.audio_transcript.delta"):
                self.on_coach_delta(str(ev.get("item_id") or ev.get("response_id") or "r"), str(ev.get("delta") or ""))
            elif et in ("response.output_audio_transcript.done", "response.audio_transcript.done"):
                self.on_coach_done(str(ev.get("item_id") or ev.get("response_id") or "r"),
                                   str(ev.get("transcript") or ""))
            elif et == "output_audio_buffer.started":
                self.on_rt_started()
            elif et in ("output_audio_buffer.stopped", "output_audio_buffer.cleared"):
                self.on_rt_stopped()
            elif et == "response.done":
                resp = ev.get("response") or {}
                self.on_response_done(str(resp.get("status") or "completed"))
            elif et == "error":
                err = ev.get("error") or {}
                self.on_error(str(err.get("code") or err.get("type") or "unknown"), str(err.get("message") or ""))
        except Exception as e:  # noqa: BLE001 - bookkeeping must never break the event pump
            log.warning("coach event %s failed: %s", et, e)
        return False

    def on_user_speech_started(self) -> bool:
        f = self.flow
        swallow = (not self.up or f is None or f.phase in PROTECTED or self._halted() or self._speaker_busy()
                   or self._physio_speaking())
        if not swallow:
            self.user_speaking, self._user_at = True, self._now()
            self._set_rt("idle")                     # the plugin interrupts the coach (barge-in on coach only)
            self._update_voice()
        return swallow

    def on_user_committed(self) -> None:
        self.user_speaking = False
        self._update_voice()

    def on_response_created(self) -> None:
        self.scheduler.on_created()
        self._cancel_sent = False
        self._played_this_response = False
        self._set_rt("thinking")
        # Not audible now: drop its audio silently. Only a halt cancels it outright; otherwise a tool call
        # in this response (e.g. report_symptom during a set, if the set update was ignored) still runs.
        self.suppress = self._halted() or not self._can_speak()
        if self._halted():
            self._send_cancel()
        self._update_voice()

    def on_rt_started(self) -> None:
        if not self.suppress:
            self._set_rt("speaking")
        self._update_voice()

    def on_rt_stopped(self) -> None:
        self._set_rt("idle")
        self._update_voice()

    def on_response_done(self, status: str) -> None:
        self.scheduler.on_done()
        if status == "failed":
            self._failures += 1
            if self._failures >= MAX_FAILED_RESPONSES:
                self.mark_down(f"{self._failures} consecutive failed responses")
        elif status == "completed":
            self._failures = 0
        if self.rt_state == "thinking" or status in ("cancelled", "failed"):
            self._set_rt("idle")
        self._update_voice()

    def on_error(self, code: str, message: str = "") -> None:
        c = code.lower()
        if c in HARMLESS_ERROR_CODES or any(fr in c for fr in _HARMLESS_FRAGMENTS):
            if "active_response" in c:
                self.scheduler.on_active_conflict()
            log.debug("harmless realtime error %s", code)
            return
        log.warning("realtime error %s: %s", code, message[:200])

    def accept_rt_pcm(self, nonsilent: bool) -> bool:
        """Output gate for one realtime PCM frame (B9). True = write it to the agent track."""
        try:
            self._check_stuck()
            if self.rt_state == "thinking" and nonsilent and not self.suppress:
                self._set_rt("speaking")             # audio can beat output_audio_buffer.started
            if self.rt_state != "speaking":
                return False
            if not self.output_open():
                if not self.suppress:
                    self.suppress = True             # first drop in this response: cancel it, once
                    self._send_cancel()
                    self._update_voice()
                return False
            self.last_rt_pcm_at = self._now()
            self._played_this_response = True
            if self._voice_sent is None or self._voice_sent[0] != "speaking":
                self._update_voice()
            return True
        except Exception:  # noqa: BLE001
            return False

    # -------------------------------------------------------------- transcripts, spotter, tripwire
    def on_user_transcript(self, turn_id: str, text: str) -> None:
        text = text.strip()
        if not text:
            return
        kind = voice_safety.match(text)
        if kind is not None:
            self.stats.spotted.append(kind)
            self._fire(self._route_spotted(kind))
        if self.flow is not None and self.flow.consent_given:
            self._transcript("user", turn_id, text)

    async def _route_spotted(self, kind: str) -> None:
        """voice_safety hit on a final user transcript: same path as the buttons (D4)."""
        if not self.bound or self.flow.halted:
            return
        if kind == "stop":
            await self.tools.request_stop()
        else:
            await self.tools.report_symptom(kind)

    def on_coach_delta(self, item_id: str, delta: str) -> None:
        if not delta:
            return
        text = self._coach_text.get(item_id, "") + delta
        self._coach_text[item_id] = text
        checked = self._coach_checked.get(item_id, 0)
        ends = [m.end() for m in _SENTENCE_END.finditer(text, checked)]
        if ends:
            upto = ends[-1]
            if self._check_sentences(text[checked:upto]):
                return
            self._coach_checked[item_id] = upto

    def on_coach_done(self, item_id: str, transcript: str) -> None:
        text = transcript or self._coach_text.get(item_id, "")
        checked = self._coach_checked.pop(item_id, 0)
        self._coach_text.pop(item_id, None)
        tripped = self._check_sentences(text[checked:]) if len(text) > checked else False
        if tripped or self.suppress or not self._conversational() or not text.strip():
            return
        self._transcript("coach", item_id, text.strip())

    def _check_sentences(self, chunk: str) -> bool:
        for sentence in _SENTENCE_END.split(chunk):
            if sentence.strip() and tripwire_hit(sentence):
                self._trip()
                return True
        return False

    def _trip(self) -> None:
        self.stats.trips += 1
        log.warning("coach tripwire: reply cut")
        self.suppress = True
        self._set_rt("idle")
        self._cancel_sent = False
        self._send_cancel()
        self._maybe_flush_local()
        self._state_item("correction: the last reply was cut because it touched medicines, diagnosis or the "
                         "prescription. Do not repeat it. For such questions use the exact redirect line.")

    def _transcript(self, role: str, turn_id: str, text: str) -> None:
        payload = envelope("pc.transcript", role=role, turnId=(turn_id or uuid.uuid4().hex)[:64],
                           text=text[:TRANSCRIPT_MAX], final=True)
        lang = lang_of(text)
        if lang:
            payload["lang"] = lang
        self.stats.transcripts.append(payload)
        self._fire(self._custom(payload))

    # -------------------------------------------------------------- live context (CoachFacade)
    def observe(self, p: dict) -> None:
        """Called synchronously BEFORE every outgoing client event is sent. Never raises."""
        try:
            self._observe(p)
        except Exception as e:  # noqa: BLE001
            log.debug("coach observe failed: %s", e)

    def _observe(self, p: dict) -> None:
        t = p.get("type")
        if t == "pc.state":
            phase, si, sp = p.get("phase"), p.get("setIndex", 0), p.get("setsPlanned", 1)
            if phase != "waiting" and not self._connect_requested and self.port is not None and not self.down:
                self._connect_requested = True
                self._fire(self._start_connect())
            if phase in ("halted", "done"):
                self._preempt()
            self._state_item(f"phase={phase} set={si}/{sp}")
            if phase == "countdown":
                self._enqueue(build_set_update(self.settings, in_set=True, lang=self.lang, minimal=self.minimal))
                self._preempt()
            elif phase == "summary":
                self._enqueue(build_set_update(self.settings, in_set=False, lang=self.lang, minimal=self.minimal))
            elif phase == "rest":
                self._fire(self._rest_cue(int(si or 0)))
            self._update_voice()
        elif t == "pc.rep":
            self._state_item(f"rep {p.get('n')}/{p.get('repsPlanned')} (set {p.get('setIndex')}): peak "
                             f"{p.get('peak')} deg, target {p.get('target')} deg, {p.get('seconds')} s, "
                             f"too fast: {'yes' if p.get('tooFast') else 'no'}")
        elif t == "pc.set_summary":
            self._state_item(f"set {p.get('setIndex')} done: {p.get('repsDone')}/{p.get('repsPlanned')} reps, "
                             f"average peak {p.get('avgPeak')} deg, best {p.get('bestPeak')} deg, target "
                             f"{p.get('target')} deg, fast reps {p.get('fastReps')}, score {p.get('score')}")
        elif t == "pc.request_pain":
            self._state_item(f"system asked for pain 0-10 for set {p.get('setIndex')}")
        elif t == "pc.caption" and p.get("kind") in ("prompt", "note", "safety") and p.get("en"):
            en = str(p.get("en"))[:300].replace('"', "'")
            self._state_item(f'recorded voice said: "{en}"')
        elif t == "pc.safety_alert":
            self._state_item(f"safety stop ({p.get('reason')}): the session is halted; stay silent")

    def _state_item(self, text: str) -> None:
        if self.up:
            self._enqueue(system_item(f"[STATE] {text}"))

    async def _start_connect(self) -> None:
        try:
            await self.port.start_connect()
        except Exception as e:  # noqa: BLE001
            self.mark_down(f"connect failed: {type(e).__name__}")

    async def _rest_cue(self, set_index: int) -> None:
        """H11: the set.rest clip is queued after pc.state rest is sent; wait for it, then one cue."""
        await asyncio.sleep(0.3)
        if self.speaker is not None:
            try:
                await asyncio.wait_for(self.speaker.wait_idle(), 10.0)
            except asyncio.TimeoutError:
                return
        await asyncio.sleep(0.25)
        f = self.flow
        if (f is None or f.phase != "rest" or set_index in self._rest_cued or not self._can_speak()
                or self._speaker_busy()):
            return
        self._rest_cued.add(set_index)
        self._enqueue(system_item(
            "[COACH CUE] The set has ended and the patient is resting. In one or two short sentences, give "
            "warm feedback grounded only in the [STATE] numbers of the last set. Do not count and do not "
            "give medical advice."))
        self.scheduler.request()

    # -------------------------------------------------------------- tool replies
    async def reply_after_tool(self) -> None:
        """Ask for a spoken reply after a tool output, only if it could be heard (D2)."""
        deadline = self._now() + REPLY_WAIT_S
        while self._speaker_busy() and self._now() < deadline:
            await asyncio.sleep(0.1)
        if self._speaker_busy() or not self._can_speak():
            return
        self.scheduler.request()

    def send_tool_output(self, call_id: str, output: str, reply: bool) -> None:
        if not self.up:
            return
        self._enqueue({"type": "conversation.item.create",
                       "item": {"type": "function_call_output", "call_id": call_id, "output": output}})
        if reply:
            self._fire(self.reply_after_tool())

    # -------------------------------------------------------------- voice state
    def voice_state(self) -> str:
        if not self.up or not self._conversational() or self._physio_speaking():
            return "off"
        if self._pcm_recent(COACH_TAIL_S):
            return "speaking"
        if self.rt_state in ("thinking", "speaking") and not self.suppress:
            return "thinking"
        return "listening" if self.input_open(self.patient_id) else "off"

    def _update_voice(self, force: bool = False) -> None:
        if self.down:
            return
        if not self.up:
            return
        cur = (self.voice_state(), True)
        now = self._now()
        if not force and cur == self._voice_sent and now - self._voice_at < KEEPALIVE_S:
            return
        self._voice_sent, self._voice_at = cur, now
        self.stats.voice.append(cur)
        self._fire(self._custom(envelope("pc.voice", state=cur[0], live=True)))

    async def _custom(self, payload: dict) -> None:
        try:
            await self._send_custom(payload)
        except Exception as e:  # noqa: BLE001 - client events are best effort
            log.debug("coach custom event %s failed: %s", payload.get("type"), e)

    # -------------------------------------------------------------- ordered sender
    def _enqueue(self, ev: dict) -> None:
        if not self.up:
            return
        self._out.append(ev)
        self._ensure_sender()

    def _drop_queued_responses(self) -> None:
        if self._out:
            self._out = deque(e for e in self._out if e.get("type") != "response.create")

    def _ensure_sender(self) -> None:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return
        if self._out_wake is None:
            self._out_wake = asyncio.Event()
        self._out_wake.set()
        if self._sender is None or self._sender.done():
            self._sender = asyncio.create_task(self._send_loop())

    async def _send_loop(self) -> None:
        while True:
            while self._out:
                ev = self._out.popleft()
                if not self.up:
                    self._out.clear()
                    break
                self.stats.sent.append(ev)
                try:
                    await self.port.send_event(ev)
                except Exception as e:  # noqa: BLE001
                    log.debug("realtime send %s failed: %s", ev.get("type"), e)
            self._out_wake.clear()
            await self._out_wake.wait()

    async def run(self) -> None:
        """Maintenance: rt_state reset, pc.voice changes and keepalive (H3, H8)."""
        try:
            while True:
                await asyncio.sleep(0.25)
                try:
                    self._check_stuck()
                    if self.up:
                        self._update_voice()
                except Exception as e:  # noqa: BLE001
                    log.debug("coach maintenance failed: %s", e)
        finally:
            if self._sender is not None:
                self._sender.cancel()
            for t in list(self._tasks):
                t.cancel()

    def _fire(self, coro) -> None:
        try:
            task = asyncio.get_running_loop().create_task(coro)
        except RuntimeError:
            coro.close()
            return
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)


# ------------------------------------------------------------------------------------------ tools

class LiveCoachTools:
    """The realtime model's tools (D6). Results are dicts; keys starting with "_" never leave the process
    ("_no_reply": the scheduler is not asked for a spoken reply)."""

    SYMPTOMS = ("dizziness", "chest_pain", "sharp_pain")

    def __init__(self, coach: LiveCoach):
        self.coach = coach

    def _ready(self) -> bool:
        return self.coach.bound

    @staticmethod
    def _envelope(type_: str, **fields) -> dict:
        return envelope(type_, **fields)

    async def get_progress(self, **_: Any) -> dict:
        if not self._ready():
            return {"error": "not_ready"}
        out = self.coach.flow.progress()
        out["rule"] = "only quote these numbers"
        return out

    async def report_pain(self, score: Any = None, **_: Any) -> dict:
        if not self._ready():
            return {"error": "not_ready"}
        try:
            if isinstance(score, bool):
                raise ValueError
            value = float(str(score).strip())
            if not value.is_integer():
                raise ValueError
            n = int(value)
        except (TypeError, ValueError):
            return {"error": "score must be a whole number from 0 to 10"}
        if not 0 <= n <= 10:
            return {"error": "score must be a whole number from 0 to 10"}
        c, f = self.coach, self.coach.flow
        if n < 7 and f.phase != "await_pain":                # B10: never pre-empt the real pain question
            return {"accepted": False, "reason": "not asked"}
        set_index = f.set_index or 1
        now = c.clock()
        key = (n, set_index)
        if now - c._pain_seen.get(key, -1e9) < PAIN_DEDUPE_S:
            return {"recorded": True, "halted": f.halted, "duplicate": True, "_no_reply": True}
        c._pain_seen[key] = now
        await c.router.handle(c.patient_id, self._envelope("pc.pain_score", score=n, setIndex=set_index))
        return {"recorded": True, "halted": f.halted, "_no_reply": True}

    async def report_symptom(self, kind: Any = None, **_: Any) -> dict:
        if not self._ready():
            return {"error": "not_ready"}
        k = str(kind or "").strip().lower()
        if k not in self.SYMPTOMS:
            return {"error": f"kind must be one of {', '.join(self.SYMPTOMS)}"}
        c = self.coach
        await c.router.handle(c.patient_id, self._envelope("pc.symptom", kind=k))
        return {"halted": c.flow.halted, "_no_reply": True}

    async def request_stop(self, **_: Any) -> dict:
        if not self._ready():
            return {"error": "not_ready"}
        f = self.coach.flow
        f.on_input()
        f.halt("stop", uuid.uuid4().hex)                     # recorded as stop / stop_pressed (M5)
        return {"halted": f.halted, "_no_reply": True}

    async def ready_to_continue(self, **_: Any) -> dict:
        if not self._ready():
            return {"error": "not_ready"}
        f = self.coach.flow
        if f.phase == "rest" and f.ready_to_continue():
            return {"accepted": True, "_no_reply": True}
        return {"accepted": False, "reason": f.phase}


TOOL_SPECS: tuple[tuple[str, str, dict], ...] = (
    ("get_progress", "Live exercise progress from the counting system. The only source of numbers you may quote.",
     {"type": "object", "properties": {}, "required": [], "additionalProperties": False}),
    ("report_pain", "Record the patient's pain score (0-10). Use only when the system asked for pain, or the "
     "patient clearly states a pain number. Never guess.",
     {"type": "object", "properties": {"score": {"type": "integer", "minimum": 0, "maximum": 10,
                                                 "description": "The number the patient said, 0 to 10."}},
      "required": ["score"], "additionalProperties": False}),
    ("report_symptom", "The patient reports dizziness, chest pain or a sudden sharp pain. Stops the session.",
     {"type": "object", "properties": {"kind": {"type": "string", "enum": list(LiveCoachTools.SYMPTOMS)}},
      "required": ["kind"], "additionalProperties": False}),
    ("request_stop", "The patient asks to stop the exercise. Stops the session and alerts the physiotherapist.",
     {"type": "object", "properties": {}, "required": [], "additionalProperties": False}),
    ("ready_to_continue", "During rest, the patient says they are ready: end the rest early.",
     {"type": "object", "properties": {}, "required": [], "additionalProperties": False}),
)


def public_result(result: Any) -> tuple[dict, bool]:
    """(result without private "_" keys, whether a spoken reply may be requested)."""
    if not isinstance(result, dict):
        return {"result": result}, True
    reply = not result.get("_no_reply", False) and result.get("error") != "not_ready"
    return {k: v for k, v in result.items() if not str(k).startswith("_")}, reply


# ------------------------------------------------------------------------------------------ facade

class CoachFacade:
    """What Flow and Speaker see as `agent` in live mode.

    * `say(text)` plays the cached clip directly (Agent.say is silent with a realtime LLM).
    * `send_custom_event(p)` lets the coach observe `p` BEFORE it is sent, even if the send then fails.
    * everything else is delegated to the real agent.
    """

    def __init__(self, agent, play: Callable[[str], Awaitable[None]], coach: LiveCoach):
        self._agent, self._play, self._coach = agent, play, coach

    async def say(self, text: str, interrupt: bool = False) -> None:
        await self._play(text)

    async def send_custom_event(self, payload: dict) -> None:
        try:
            self._coach.observe(payload)
        finally:
            await self._agent.send_custom_event(payload)

    def __getattr__(self, name: str):
        return getattr(self._agent, name)
