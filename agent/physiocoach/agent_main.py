"""One agent process per call (§8.14):

    python -m physiocoach.agent_main --session-id <sid>        # config in env PC_SESSION_JSON

Joins the existing call, publishes the annotated tile, runs the call-flow state machine (call/flow.py),
speaks Malayalam through the Speaker with physio barge-in, and reports to the web through the outbox.
The process exit code is the flow's (0 normal, 3 patient never joined, 4 patient left, 5 no consent).

Live Coach (WP1a): with OPENAI_API_KEY set and LIVE_COACH not off, the agent runs an OpenAI Realtime voice
coach next to the cached clips (call/live_coach.py, call/live_coach_rt.py). With LIVE_COACH=off, no key, or
ANY error while building live mode, the agent runs exactly today's deterministic path (NoLLM, clips only).
"""

import argparse
import asyncio
import logging
import os
import signal
import socket
from pathlib import Path
from typing import Optional

from vision_agents.core import Agent, User
from vision_agents.core.edge.events import (
    AudioReceivedEvent, CallEndedEvent, ParticipantJoinedEvent, ParticipantLeftEvent, TrackAddedEvent,
)
from vision_agents.core.edge.types import TrackType

from .call.bargein import BargeInDetector, PhysioBargeIn
from .call.edge import NoChatEdge
from .call.flow import Flow, FlowTiming
from .call.heartbeat import heartbeat
from .call.inputs import InputRouter, hook_custom_events, redis_inputs
from .call.live_coach import CoachFacade, LiveCoach, LiveCoachSettings, resolve_live_coach_settings
from .call.no_llm import NoLLM
from .call.outbox import MemoryStore, Outbox, RedisStore
from .call.processor import PoseProcessor
from .call.speaker import Speaker
from .call.vad import LeanSileroVADSessionPool
from .core.config import SessionConfig, load_session_config
from .core.note_llm import post_set_note
from .pose.base import backend_factory_from_env, models_dir
from .voice.build import build_tts

log = logging.getLogger("physiocoach.agent")
AGENT_DIR = Path(__file__).resolve().parents[1]


async def connect_redis():
    url = os.getenv("REDIS_URL")
    if not url:
        return None
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(url)
        await r.ping()
        return r
    except Exception as e:  # noqa: BLE001 - dev without Redis: memory outbox, no backup inbox/heartbeat
        log.warning("Redis unavailable (%s): outbox in memory, no backup input channel", e)
        return None


def resolve_clip(name: Optional[str]) -> Path:
    """Replay clips: a bare file name on the AGENT_REPLAY_CLIPS allow-list, under replay/clips only."""
    allowed = {c.strip() for c in os.getenv("AGENT_REPLAY_CLIPS", "").split(",") if c.strip()}
    if not name or "/" in name or "\\" in name or name not in allowed:
        raise SystemExit(f"replay clip {name!r} is not on the AGENT_REPLAY_CLIPS allow-list")
    path = Path(os.getenv("AGENT_REPLAY_DIR", AGENT_DIR / "replay" / "clips")) / name
    if not path.exists():
        raise SystemExit(f"replay clip {path} does not exist")
    return path


class LiveParts:
    """Everything live mode adds; built in one try block so any failure falls back to today's path."""

    def __init__(self, cfg: SessionConfig, settings: LiveCoachSettings, pose: PoseProcessor, tts):
        from .call.coach_prompt import build_instructions
        from .call.live_coach_rt import CoachAgent, DirectClipPlayer, LiveCoachRealtime, register_tools

        self.settings = settings
        self._agent = None

        async def send_real(payload: dict) -> None:            # the real agent, not the facade (no re-observe)
            await self._agent.send_custom_event(payload)

        self.coach = LiveCoach(cfg, settings, send_real)
        self.llm = LiveCoachRealtime(self.coach, settings)
        self.tools = register_tools(self.llm, self.coach)
        self.agent = CoachAgent(
            edge=NoChatEdge(),
            llm=self.llm,
            agent_user=User(id=cfg.agentUserId, name="PhysioCoach"),
            instructions=build_instructions(cfg),
            tts=tts,                                           # dropped by Agent in realtime mode (B8)
            processors=[pose],
        )
        self._agent = self.agent
        self.facade = CoachFacade(self.agent, DirectClipPlayer(tts, self.agent), self.coach)
        self.coach.attach_port(self.llm)


def build_live(cfg: SessionConfig, settings: LiveCoachSettings, pose: PoseProcessor, tts) -> Optional[LiveParts]:
    if not settings.enabled:
        (log.warning if settings.warn else log.info)("live coach off: %s", settings.reason)
        return None
    try:
        live = LiveParts(cfg, settings, pose, tts)
    except Exception as e:  # noqa: BLE001 - fallback is sacred: any failure -> today's deterministic path
        log.warning("live coach could not be built (%s: %s): clips only", type(e).__name__, e)
        return None
    # Realtime transcripts would otherwise be logged at INFO (patient speech in logs, H2).
    logging.getLogger("vision_agents.core.agents.inference.realtime_flow").setLevel(logging.WARNING)
    log.info("live coach on (%s): model %s, voice %s, set_listen=%s, barge_in=%s, video=%s (stills: WP1b)",
             settings.reason, settings.realtime_model, settings.voice, settings.set_listen, settings.barge_in,
             settings.video)
    return live


def note_llm_enabled() -> bool:
    """Milestone 6 is done: on unless NOTE_LLM_ENABLED is set to something other than "true" (empty = unset)."""
    return (os.getenv("NOTE_LLM_ENABLED") or "").strip().lower() in ("", "true")


async def amain(cfg: SessionConfig, max_seconds: Optional[float] = None) -> int:
    pose = PoseProcessor(
        backend_factory_from_env(),
        fps=int(os.getenv("POSE_FPS", "12")),
        out_w=int(os.getenv("POSE_OUT_W", "640")),
        out_h=int(os.getenv("POSE_OUT_H", "360")),
    )
    pose.patient_user_id = cfg.patient.id
    clip = resolve_clip(cfg.clip) if cfg.mode == "replay" else None
    tts, duration_of = build_tts()
    live = build_live(cfg, resolve_live_coach_settings(os.environ), pose, tts)
    if live is not None:
        agent = live.agent
    else:
        agent = Agent(
            edge=NoChatEdge(),
            llm=NoLLM(),                                   # llm= is mandatory; never used for generation
            agent_user=User(id=cfg.agentUserId, name="PhysioCoach"),
            instructions="Deterministic exercise coach. Never used for generation.",
            tts=tts,
            processors=[pose],
        )
    log.info("session %s (%s), patient language %s: audio is Malayalam for every patient (DEV-16)",
             cfg.sessionId, cfg.mode, cfg.patient.lang)

    redis = await connect_redis()
    outbox = Outbox(cfg.sessionId, os.getenv("WEB_INTERNAL_URL", "http://localhost:3000"),
                    os.getenv("AGENT_CALLBACK_SECRET", ""),
                    RedisStore(redis, cfg.sessionId) if redis else MemoryStore())

    async def interrupt_audio() -> None:
        # Clears the flow's TTS input/output queues AND flushes the audio track (private, pinned 0.6.9).
        await agent._flow.interrupt()

    if live is not None:
        speaker = Speaker(live.facade, duration_of, interrupt_audio, hold=live.coach.hold,
                          before_play=live.coach.before_clip)
    else:
        speaker = Speaker(agent, duration_of, interrupt_audio)
    flow_agent = live.facade if live is not None else agent
    vad_pool = await LeanSileroVADSessionPool.load(str(models_dir()))
    if live is not None:
        coach = live.coach

        async def physio_started() -> None:
            await speaker.physio_started()
            await coach.on_physio_started()

        def physio_stopped() -> None:                     # synchronous: PhysioBargeIn calls it without await (B3)
            speaker.physio_stopped()
            coach.on_physio_stopped()
        on_start, on_stop = physio_started, physio_stopped
    else:
        on_start, on_stop = speaker.physio_started, speaker.physio_stopped
    barge = PhysioBargeIn(cfg.physioId, vad_pool.session(), on_start, on_stop,
                          BargeInDetector(min_rms=float(os.getenv("BARGEIN_MIN_RMS", "0.02"))))

    async def prefetch(text: str) -> bool:
        """LLM note audio must be fully synthesised (and cached) before we commit to it (§8.9)."""
        try:
            resp = await asyncio.wait_for(tts.stream_audio(text), float(os.getenv("NOTE_TTS_TIMEOUT_S", "3.0")))
            if hasattr(resp, "__aiter__"):
                await asyncio.wait_for(_drain(resp), float(os.getenv("NOTE_TTS_TIMEOUT_S", "3.0")))
            return True
        except Exception as e:  # noqa: BLE001 - any failure -> the rule note (all clips)
            log.info("note TTS prefetch failed (%s): rule note instead", type(e).__name__)
            await tts.stop_audio()
            return False

    async def bye_allowed() -> bool:
        if not redis:
            return True
        reason = await redis.get(f"pc:stop_reason:{cfg.sessionId}")
        return reason not in (b"restart", "restart")

    llm_on = note_llm_enabled()
    flow = Flow(flow_agent, pose, cfg, speaker, outbox, timing=FlowTiming.from_env(),
                note_fn=post_set_note if llm_on else None, prefetch=prefetch,
                host=os.getenv("WORKER_HOST", socket.gethostname()), pid=os.getpid(),
                attach_replay=(lambda: pose.attach_file(str(clip))) if clip else None, bye_allowed=bye_allowed)
    router = InputRouter(flow, cfg.patient.id, cfg.physioId, cfg.agentUserId)
    if live is not None:
        live.coach.bind(flow, router, speaker, pose)

    @agent.events.subscribe
    async def _ended(e: CallEndedEvent):
        log.info("call ended")
        flow.cancel("call_ended")

    @agent.events.subscribe
    async def _audio(e: AudioReceivedEvent):
        uid = e.participant.user_id if e.participant else None
        await barge.feed(uid, e.pcm_data)
        if live is not None and uid == cfg.patient.id:
            live.llm.feed_patient_audio(e.participant, e.pcm_data)      # non-blocking, ordered, gated

    @agent.events.subscribe
    async def _people(e: ParticipantJoinedEvent | ParticipantLeftEvent):
        uid = e.participant.user_id if e.participant else None
        joined = isinstance(e, ParticipantJoinedEvent)
        if uid == cfg.patient.id:
            flow.on_patient_joined() if joined else flow.on_patient_left()
        elif uid == cfg.physioId and joined:
            flow.on_physio_joined()

    @agent.events.subscribe
    async def _patient_track(e: TrackAddedEvent):
        # Covers a patient already in the call when the agent (re)joins: tracks are republished.
        if e.participant and e.participant.user_id == cfg.patient.id and e.track_type == TrackType.VIDEO:
            flow.on_patient_joined()

    loop = asyncio.get_running_loop()
    try:
        loop.add_signal_handler(signal.SIGTERM, lambda: flow.cancel("sigterm"))   # POSIX (Docker)
    except NotImplementedError:
        pass

    await pose.warmup()
    call = await agent.create_call(cfg.callType, cfg.callId)        # get_or_create: an existing call is fine
    tasks = [asyncio.create_task(outbox.run()), asyncio.create_task(speaker.run())]
    if live is not None:
        tasks.append(asyncio.create_task(live.coach.run()))
        try:
            await tts.start()                                   # Agent never starts the TTS in realtime mode (B8)
        except Exception as e:  # noqa: BLE001 - clips still work without the runtime TTS
            log.warning("TTS start failed: %s", e)
    if redis:
        tasks += [asyncio.create_task(heartbeat(redis, cfg.sessionId, lambda: len(flow.completed_sets))),
                  asyncio.create_task(redis_inputs(redis, cfg.sessionId, router.handle))]
    code = 1
    try:
        # participant_wait_timeout=0: enter immediately; the flow owns the patient-join timeout.
        async with agent.join(call, participant_wait_timeout=0):
            log.info("joined %s:%s as %s", cfg.callType, cfg.callId, cfg.agentUserId)
            hook_custom_events(agent, router.handle)
            if max_seconds:
                loop.call_later(max_seconds, lambda: flow.cancel("max_seconds"))
            code = await flow.run()
    finally:
        for t in tasks:
            t.cancel()
        if live is not None:
            try:
                await tts.close()                               # and never closes it either (B8)
            except Exception as e:  # noqa: BLE001
                log.debug("TTS close failed: %s", e)
        await outbox.aclose()
        if redis:
            await redis.aclose()
    return code


async def _drain(stream) -> None:
    async for _ in stream:
        pass


def main() -> int:
    p = argparse.ArgumentParser(prog="physiocoach.agent_main")
    p.add_argument("--session-id", required=True)
    p.add_argument("--session-file", help="dev: read the config from this file instead of PC_SESSION_JSON")
    p.add_argument("--max-seconds", type=float, help="dev: leave after this long")
    args = p.parse_args()
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    raw = Path(args.session_file).read_text(encoding="utf-8") if args.session_file else None
    cfg = load_session_config(raw)
    if cfg.sessionId != args.session_id:
        raise SystemExit(f"--session-id {args.session_id} does not match the config ({cfg.sessionId})")
    return asyncio.run(amain(cfg, args.max_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
