"""Vision Agents adapter for the Live Coach (WP1a). Imported lazily by agent_main, only in live mode.

Every private Vision Agents surface we touch is here (pinned vision-agents==0.6.9 and
vision-agents-plugins-openai==0.6.9; tests/smoke/test_private_hooks.py guards them):
  openai.Realtime._handle_openai_event / _handle_audio_output / _send_tool_response / rtc (RTCManager:
  _send_event, pc, data_channel, _data_channel_open_event), Agent._needs_video / _audio_output_stream,
  RealtimeInferenceFlow (agent._flow), AudioOutputChunk / AudioOutputFlush.

The pure decisions live in live_coach.py; this file only translates.
"""

import asyncio
import logging
from typing import Any, Optional

import numpy as np
from getstream.video.rtc.track_util import PcmData
from vision_agents.core import Agent
from vision_agents.core.agents.inference import AudioOutputChunk, AudioOutputFlush
from vision_agents.plugins.openai import Realtime
from vision_agents.plugins.openai.rtc_manager import RTCManager

from .live_coach import TOOL_SPECS, LiveCoach, LiveCoachSettings, build_realtime_session, public_result

log = logging.getLogger(__name__)

OUT_RATE = 48000                 # clips and the agent track are 48 kHz mono (B9)
SILENCE_PEAK = 200               # int16 peak below this = silence frame
SEND_TIMEOUT_S = 2.0
WATCHDOG_S = 2.0
DATA_CHANNEL_OPEN_S = 10.0
PATIENT_QUEUE_MAX = 500          # ~10 s of 20 ms frames


def _nonsilent(pcm: PcmData) -> bool:
    try:
        s = np.asarray(pcm.samples)
        if s.size == 0:
            return False
        if s.dtype == np.int16:
            return int(np.max(np.abs(s.astype(np.int32)))) > SILENCE_PEAK
        return float(np.max(np.abs(s))) > SILENCE_PEAK / 32768.0
    except Exception:  # noqa: BLE001
        return True


class LiveCoachRealtime(Realtime):
    """openai.Realtime with a non-blocking connect, local gates and an ordered, gated patient-audio pump."""

    def __init__(self, coach: LiveCoach, settings: LiveCoachSettings, client: Any = None):
        session = build_realtime_session(settings, lang=coach.lang)
        super().__init__(model=settings.realtime_model, voice=settings.voice, realtime_session=session,
                         send_video=False, client=client)
        self.coach, self.settings = coach, settings
        self._up = False
        self._closing = False
        self._connect_task: Optional[asyncio.Task] = None
        self._watchdog_task: Optional[asyncio.Task] = None
        self._pump_task: Optional[asyncio.Task] = None
        self._patient_q: Optional[asyncio.Queue] = None
        self._writing = False                       # realtime PCM is flowing into the output stream
        self.connect_attempts: list[str] = []       # "full" / "minimal" (smoke tests)

    # ------------------------------------------------------------------ RealtimePort
    @property
    def up(self) -> bool:
        return self._up and not self._closing

    async def send_event(self, ev: dict) -> None:
        if not self.up:
            return
        try:
            await asyncio.wait_for(self.rtc._send_event(ev), SEND_TIMEOUT_S)
        except Exception as e:  # noqa: BLE001 - _send_event already swallows; the timeout is ours
            log.debug("realtime send %s: %s", ev.get("type"), type(e).__name__)

    def flush_local(self) -> None:
        """Synchronous twin of RealtimeInferenceFlow.interrupt(): drop queued realtime audio and flush the
        agent track. Synchronous so it can never land AFTER the clip that triggered it (B7)."""
        agent = self.agent
        if agent is None:
            return
        self._epoch += 1
        self._output.clear()
        out = agent._audio_output_stream
        out.clear()
        out.send_nowait(AudioOutputFlush())
        self._writing = False

    async def start_connect(self) -> None:
        if self._connect_task is None and not self._closing:
            self._connect_task = asyncio.create_task(self._connect_with_retry())

    # ------------------------------------------------------------------ connection (B12, D13)
    async def connect(self):
        """Agent.join awaits this before edge.join: return at once; the coach connects at greeting."""
        return None

    async def _connect_once(self, label: str) -> None:
        self.connect_attempts.append(label)
        await asyncio.wait_for(super().connect(), self.settings.connect_timeout_s)

    async def _connect_with_retry(self) -> None:
        minimal = False
        try:
            await self._connect_once("full")
        except Exception as e1:  # noqa: BLE001
            log.warning("realtime connect failed (%s): retrying once with a minimal session", type(e1).__name__)
            await self._close_rtc_quietly()
            if self._closing:
                return
            try:
                instructions = self.realtime_session.get("instructions")
                self.realtime_session = build_realtime_session(self.settings, instructions=instructions,
                                                               minimal=True)      # type: ignore[assignment]
                # An aiortc peer connection cannot be offered twice: always a fresh RTCManager.
                self.rtc = RTCManager(realtime_session=self.realtime_session, client=self.client, send_video=False)
                minimal = True
                await self._connect_once("minimal")
            except Exception as e2:  # noqa: BLE001
                log.warning("realtime minimal connect failed (%s): live coach off for this session",
                            type(e2).__name__)
                await self._close_rtc_quietly()
                self.coach.mark_down(f"connect failed: {type(e2).__name__}")
                return
        if self._closing:
            return
        self._up = True
        self._patient_q = asyncio.Queue(maxsize=PATIENT_QUEUE_MAX)
        self._pump_task = asyncio.create_task(self._pump())
        self._watchdog_task = asyncio.create_task(self._watchdog())
        self.coach.on_connected(minimal=minimal)

    async def _watchdog(self) -> None:
        loop = asyncio.get_running_loop()
        opened_by = loop.time() + DATA_CHANNEL_OPEN_S
        while self._up and not self._closing:
            await asyncio.sleep(WATCHDOG_S)
            try:
                pc_state = getattr(self.rtc.pc, "connectionState", None)
                dc = self.rtc.data_channel
                dc_state = getattr(dc, "readyState", None) if dc is not None else "closed"
                not_open = not self.rtc._data_channel_open_event.is_set() and loop.time() > opened_by
                if pc_state in ("failed", "closed") or dc_state == "closed" or not_open:
                    reason = f"transport {pc_state}/{dc_state}" + (" (data channel never opened)" if not_open else "")
                    self._go_down(reason)
                    return
            except Exception as e:  # noqa: BLE001
                log.debug("watchdog check failed: %s", e)

    def _go_down(self, reason: str) -> None:
        self._up = False
        self._end_output()
        self.coach.mark_down(reason)

    async def _close_rtc_quietly(self) -> None:
        try:
            await self.rtc.close()
        except Exception as e:  # noqa: BLE001
            log.debug("rtc close: %s", e)

    async def close(self):
        self._closing = True
        self._up = False
        for t in (self._connect_task, self._watchdog_task, self._pump_task):
            if t is not None and not t.done():
                t.cancel()
        try:
            await super().close()
        except Exception as e:  # noqa: BLE001 - never let the coach break the agent's shutdown
            log.debug("realtime close: %s", e)

    # ------------------------------------------------------------------ audio in (D3, H9)
    async def process_audio(self, pcm: PcmData, participant) -> None:
        """No-op: the flow would forward everyone after FirstSpeakerWinsFilter. We feed the patient only."""
        return None

    def feed_patient_audio(self, participant, pcm: PcmData) -> None:
        q = self._patient_q
        if q is None or not self.up or pcm is None or participant is None:
            return
        try:
            q.put_nowait((participant, pcm))
        except asyncio.QueueFull:
            pass

    async def _pump(self) -> None:
        q = self._patient_q
        while True:
            participant, pcm = await q.get()
            try:
                if self.up and self.coach.input_open(getattr(participant, "user_id", None)):
                    await self.simple_audio_response(pcm, participant)
            except Exception as e:  # noqa: BLE001
                log.debug("patient audio forward failed: %s", e)

    # ------------------------------------------------------------------ audio out (B9, D2, D14)
    async def _handle_audio_output(self, pcm: PcmData) -> None:
        ok = False
        try:
            ok = self.up and self.coach.accept_rt_pcm(_nonsilent(pcm))
        except Exception:  # noqa: BLE001
            ok = False
        if not ok:
            self._end_output()
            return
        try:
            pcm48 = pcm.resample(OUT_RATE, 1)
        except Exception as e:  # noqa: BLE001
            log.debug("resample failed: %s", e)
            return
        self._writing = True
        await super()._handle_audio_output(pcm48)

    def _end_output(self) -> None:
        """final=True marker at every coach stop / gate edge: no leftover samples cross into a clip (B9)."""
        if self._writing:
            self._writing = False
            try:
                self._emit_audio_output_done_event()
            except Exception:  # noqa: BLE001
                pass

    # ------------------------------------------------------------------ events
    async def _handle_openai_event(self, event: dict) -> None:
        swallow = False
        try:
            swallow = self.coach.on_rt_event(event)            # our bookkeeping first (B11)
        except Exception as e:  # noqa: BLE001
            log.debug("coach bookkeeping failed: %s", e)
        et = event.get("type")
        if et in ("output_audio_buffer.stopped", "output_audio_buffer.cleared", "response.done"):
            if self.coach.rt_state == "idle":
                self._end_output()
        if swallow:
            return                                              # e.g. speech_started while a clip plays (B6)
        try:
            await super()._handle_openai_event(event)
        except Exception as e:  # noqa: BLE001 - super raises on response.done status=failed
            log.debug("realtime event %s: %s", et, e)

    async def _send_tool_response(self, call_id: Optional[str], response_data: dict) -> None:
        """function_call_output only; a reply is requested through the coach's scheduler (D2, B11)."""
        if not call_id:
            return
        public, reply = public_result(response_data)
        self.coach.send_tool_output(call_id, self._sanitize_tool_output(public), reply)

    # ------------------------------------------------------------------ video (D5, M9): mandatory no-ops
    # No continuous video: stills go in as conversation items (LiveCoach.maybe_send_still -> send_event).
    async def watch_video_track(self, track, shared_forwarder=None) -> None:
        return None

    async def stop_watching_video_track(self) -> None:
        return None


def register_tools(llm: Realtime, coach: LiveCoach) -> list[str]:
    """Seven explicit-schema async tools (D6); register(...) returns a decorator that must be applied (H10)."""
    names = []
    for name, description, schema in TOOL_SPECS:
        method = getattr(coach.tools, name)

        async def _tool(_method=method, **kwargs):
            return await _method(**kwargs)

        _tool.__name__ = name
        llm.function_registry.register(name=name, description=description, parameters_schema=schema)(_tool)
        names.append(name)
    return names


class CoachAgent(Agent):
    """Agent with video subscription disabled: an OmniLLM would otherwise make _needs_video() True, and
    watch_video_track would add a track + renegotiate, losing the OpenAI session (M9)."""

    def _needs_video(self) -> bool:
        return False


class DirectClipPlayer:
    """Plays one cached clip straight into the agent's audio output (Agent.say is silent in realtime mode)."""

    def __init__(self, tts, agent: Agent):
        self.tts, self.agent = tts, agent

    async def __call__(self, text: str) -> None:
        try:
            out = self.agent._audio_output_stream
            res = await self.tts.stream_audio(text)
            if isinstance(res, PcmData):
                await out.send(AudioOutputChunk(data=res.resample(OUT_RATE, 1)))
            elif hasattr(res, "__aiter__"):
                async for chunk in res:
                    await out.send(AudioOutputChunk(data=chunk.resample(OUT_RATE, 1)))
            elif res is not None:
                for chunk in res:
                    await out.send(AudioOutputChunk(data=chunk.resample(OUT_RATE, 1)))
            await out.send(AudioOutputChunk(final=True))
        except Exception as e:  # noqa: BLE001 - a missing clip must never break the flow
            log.warning("clip playback failed (%s)", type(e).__name__)
