"""One agent process per call (§8.14):

    python -m physiocoach.agent_main --session-id <sid>        # config in env PC_SESSION_JSON

Milestone 2: joins the existing call, publishes the annotated tile and runs the spike flow.
The full call-flow state machine replaces SpikeFlow in Milestone 4.
"""

import argparse
import asyncio
import logging
import os
import signal
from pathlib import Path

from vision_agents.core import Agent, User
from vision_agents.core.edge.events import CallEndedEvent

from .call.edge import NoChatEdge
from .call.inputs import hook_custom_events
from .call.no_llm import NoLLM
from .call.processor import PoseProcessor
from .call.silent_tts import SilentTTS
from .call.spike_flow import SpikeFlow
from .core.config import SessionConfig, load_session_config
from .pose.base import backend_factory_from_env

log = logging.getLogger("physiocoach.agent")


async def amain(cfg: SessionConfig, max_seconds: float | None = None) -> int:
    pose = PoseProcessor(
        backend_factory_from_env(),
        fps=int(os.getenv("POSE_FPS", "12")),
        out_w=int(os.getenv("POSE_OUT_W", "960")),
        out_h=int(os.getenv("POSE_OUT_H", "540")),
    )
    pose.patient_user_id = cfg.patient.id
    agent = Agent(
        edge=NoChatEdge(),
        llm=NoLLM(),                                   # llm= is mandatory; never used for generation
        agent_user=User(id=cfg.agentUserId, name="PhysioCoach"),
        instructions="Deterministic exercise coach. Never used for generation.",
        tts=SilentTTS(),                               # CachedMalayalamTTS in Milestone 3
        processors=[pose],
    )
    await pose.warmup()
    call = await agent.create_call(cfg.callType, cfg.callId)        # get_or_create: an existing call is fine
    flow = SpikeFlow(agent, pose, cfg)

    @agent.events.subscribe
    async def _ended(e: CallEndedEvent):
        log.info("call ended")
        flow.ended.set()

    loop = asyncio.get_running_loop()
    try:
        loop.add_signal_handler(signal.SIGTERM, flow.ended.set)       # POSIX (Docker)
    except NotImplementedError:
        pass

    # participant_wait_timeout=0: enter immediately; the flow owns the patient-join timeout.
    async with agent.join(call, participant_wait_timeout=0):
        log.info("joined %s:%s as %s", cfg.callType, cfg.callId, cfg.agentUserId)
        hook_custom_events(agent, flow.on_event)
        ready = asyncio.create_task(flow.ready_loop())
        try:
            await asyncio.wait_for(flow.ended.wait(), timeout=max_seconds)
        except asyncio.TimeoutError:
            log.info("spike duration reached")
        finally:
            ready.cancel()
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
