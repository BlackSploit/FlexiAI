"""One agent process per call (§8.14):

    python -m physiocoach.agent_main --session-id <sid>        # config in env PC_SESSION_JSON

Milestones 2-3: joins the existing call, publishes the annotated tile, speaks Malayalam through the
Speaker (CachedMalayalamTTS) with physio barge-in, and runs the spike flow. The full call-flow
state machine replaces SpikeFlow in Milestone 4.
"""

import argparse
import asyncio
import logging
import os
import signal
from pathlib import Path

from vision_agents.core import Agent, User
from vision_agents.core.edge.events import AudioReceivedEvent, CallEndedEvent
from vision_agents.core.vad.silero import SileroVADSessionPool

from .call.bargein import BargeInDetector, PhysioBargeIn
from .call.edge import NoChatEdge
from .call.inputs import hook_custom_events
from .call.no_llm import NoLLM
from .call.processor import PoseProcessor
from .call.speaker import Speaker
from .call.spike_flow import SpikeFlow
from .core.config import SessionConfig, load_session_config
from .pose.base import backend_factory_from_env, models_dir
from .voice.build import build_tts

log = logging.getLogger("physiocoach.agent")


async def amain(cfg: SessionConfig, max_seconds: float | None = None) -> int:
    pose = PoseProcessor(
        backend_factory_from_env(),
        fps=int(os.getenv("POSE_FPS", "12")),
        out_w=int(os.getenv("POSE_OUT_W", "640")),
        out_h=int(os.getenv("POSE_OUT_H", "360")),
    )
    pose.patient_user_id = cfg.patient.id
    tts, duration_of = build_tts()
    agent = Agent(
        edge=NoChatEdge(),
        llm=NoLLM(),                                   # llm= is mandatory; never used for generation
        agent_user=User(id=cfg.agentUserId, name="PhysioCoach"),
        instructions="Deterministic exercise coach. Never used for generation.",
        tts=tts,
        processors=[pose],
    )
    log.info("patient language %s; audio is Malayalam for every patient (DEV-16)", cfg.patient.lang)

    async def interrupt_audio() -> None:
        # Clears the flow's TTS input/output queues AND flushes the audio track (private, pinned 0.6.9;
        # tts.interrupt() + audio_track.flush() alone would leave queued speech to play).
        await agent._flow.interrupt()

    speaker = Speaker(agent, duration_of, interrupt_audio)
    vad_pool = await SileroVADSessionPool.load(str(models_dir()))
    barge = PhysioBargeIn(cfg.physioId, vad_pool.session(), speaker.physio_started, speaker.physio_stopped,
                          BargeInDetector(min_rms=float(os.getenv("BARGEIN_MIN_RMS", "0.02"))))

    await pose.warmup()
    call = await agent.create_call(cfg.callType, cfg.callId)        # get_or_create: an existing call is fine
    flow = SpikeFlow(agent, pose, cfg, speaker)
    flow.bargein = barge

    @agent.events.subscribe
    async def _ended(e: CallEndedEvent):
        log.info("call ended")
        flow.ended.set()

    @agent.events.subscribe
    async def _audio(e: AudioReceivedEvent):
        await barge.feed(e.participant.user_id if e.participant else None, e.pcm_data)

    loop = asyncio.get_running_loop()
    try:
        loop.add_signal_handler(signal.SIGTERM, flow.ended.set)       # POSIX (Docker)
    except NotImplementedError:
        pass

    # participant_wait_timeout=0: enter immediately; the flow owns the patient-join timeout.
    async with agent.join(call, participant_wait_timeout=0):
        log.info("joined %s:%s as %s", cfg.callType, cfg.callId, cfg.agentUserId)
        hook_custom_events(agent, flow.on_event)
        tasks = [asyncio.create_task(flow.ready_loop()), asyncio.create_task(speaker.run()),
                 asyncio.create_task(flow.voice_script())]
        try:
            await asyncio.wait_for(flow.ended.wait(), timeout=max_seconds)
        except asyncio.TimeoutError:
            log.info("spike duration reached")
        finally:
            for t in tasks:
                t.cancel()
            flow.write_report(Path(os.getenv("PC_REPORT_DIR", "cache")) / f"spike-{cfg.sessionId}.json")
    return 0


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
