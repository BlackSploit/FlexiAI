"""One agent process per call (§8.14):

    python -m physiocoach.agent_main --session-id <sid>        # config in env PC_SESSION_JSON

Joins the existing call, publishes the annotated tile, runs the call-flow state machine (call/flow.py),
speaks Malayalam through the Speaker with physio barge-in, and reports to the web through the outbox.
The process exit code is the flow's (0 normal, 3 patient never joined, 4 patient left, 5 no consent).
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

    speaker = Speaker(agent, duration_of, interrupt_audio)
    vad_pool = await LeanSileroVADSessionPool.load(str(models_dir()))
    barge = PhysioBargeIn(cfg.physioId, vad_pool.session(), speaker.physio_started, speaker.physio_stopped,
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

    llm_on = os.getenv("NOTE_LLM_ENABLED", "false") == "true"        # off until Milestone 6
    flow = Flow(agent, pose, cfg, speaker, outbox, timing=FlowTiming.from_env(),
                note_fn=post_set_note if llm_on else None, prefetch=prefetch,
                host=os.getenv("WORKER_HOST", socket.gethostname()), pid=os.getpid(),
                attach_replay=(lambda: pose.attach_file(str(clip))) if clip else None, bye_allowed=bye_allowed)
    router = InputRouter(flow, cfg.patient.id, cfg.physioId, cfg.agentUserId)

    @agent.events.subscribe
    async def _ended(e: CallEndedEvent):
        log.info("call ended")
        flow.cancel("call_ended")

    @agent.events.subscribe
    async def _audio(e: AudioReceivedEvent):
        await barge.feed(e.participant.user_id if e.participant else None, e.pcm_data)

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
    if redis:
        tasks += [asyncio.create_task(heartbeat(redis, cfg.sessionId)),
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
