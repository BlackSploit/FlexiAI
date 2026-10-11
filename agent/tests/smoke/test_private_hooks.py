"""Guards the private/unstable Vision Agents and getstream surfaces we rely on (§12.1).

Runs in the Docker test image (vision-agents==0.6.9 installed). Fails loudly after an upgrade.
"""

from types import SimpleNamespace

import pytest

pytest.importorskip("vision_agents")

from getstream.video.rtc import AudioStreamTrack, ConnectionManager  # noqa: E402
from getstream.video.rtc.pc import SubscriberPeerConnection  # noqa: E402
from vision_agents.core.edge import events as edge_events  # noqa: E402
from vision_agents.core.edge.events import TrackAddedEvent  # noqa: E402
from vision_agents.core.edge.types import Participant, TrackType  # noqa: E402
from vision_agents.core.events.manager import EventManager  # noqa: E402

from physiocoach.call.edge import NoChatEdge  # noqa: E402
from physiocoach.call.processor import PoseProcessor  # noqa: E402


@pytest.fixture(autouse=True)
def stream_env(monkeypatch):
    monkeypatch.setenv("STREAM_API_KEY", "test-key")
    monkeypatch.setenv("STREAM_API_SECRET", "test-secret")


def test_edge_exposes_the_private_connection_attributes():
    edge = NoChatEdge()
    assert hasattr(edge, "_real_connection") and edge._real_connection is None
    with pytest.raises(ValueError):
        edge._connection                       # property raises before join
    assert callable(getattr(edge, "add_track_subscriber"))


def test_connection_manager_and_tracks_keep_the_methods_we_call():
    assert callable(getattr(ConnectionManager, "on"))
    assert callable(getattr(AudioStreamTrack, "flush"))
    assert callable(getattr(SubscriberPeerConnection, "add_track_subscriber"))


def test_agent_flow_interrupt_still_clears_tts_and_audio_queues():
    """Barge-in and safety call agent._flow.interrupt() (private): it must keep clearing every stage."""
    import inspect

    from vision_agents.core.agents.agents import Agent
    from vision_agents.core.agents.inference.transcribing_flow import TranscribingInferenceFlow

    assert "self._flow" in inspect.getsource(Agent)
    src = inspect.getsource(TranscribingInferenceFlow.interrupt)
    for needle in ("_tts_input.clear()", "_tts_output.clear()", "_audio_output.flush()"):
        assert needle in src, needle
    say = inspect.getsource(TranscribingInferenceFlow.say)
    assert "await self.interrupt()" in say          # say(..., interrupt=True) for the safety phrase


async def test_lean_vad_session_uses_one_thread():
    import os

    from physiocoach.call.vad import LeanSileroVADSessionPool
    from physiocoach.pose.base import models_dir
    path = models_dir() / "silero_vad.onnx"
    if not path.exists():
        pytest.skip("silero_vad.onnx not baked into this image")
    pool = LeanSileroVADSessionPool(str(path))
    opts = pool._model.get_session_options()
    assert (opts.intra_op_num_threads, opts.inter_op_num_threads) == (1, 1)
    assert 0.0 <= pool.session().predict_speech(_silence()) <= 1.0
    assert os.path.basename(str(path)) == "silero_vad.onnx"


def _silence():
    from getstream.video.rtc.track_util import AudioFormat, PcmData
    return PcmData.from_bytes(b"\x00\x00" * 960, sample_rate=48000, format=AudioFormat.S16, channels=1)


async def test_no_chat_edge_returns_an_in_memory_conversation():
    conv = await NoChatEdge().create_conversation(None, None, "instr")
    assert type(conv).__name__ == "InMemoryConversation"


async def test_pose_processor_track_handler_fires_for_the_patient_only():
    em = EventManager()
    em.register_events_from_module(edge_events)
    subscribed: list[str] = []
    fake_agent = SimpleNamespace(events=em, edge=SimpleNamespace(add_track_subscriber=lambda tid: subscribed.append(tid)))
    pose = PoseProcessor(lambda: None)
    pose.patient_user_id = "patient-1"
    pose.attach_agent(fake_agent)

    def added(user_id: str, track_id: str, kind: TrackType) -> TrackAddedEvent:
        return TrackAddedEvent(plugin_name="test", participant=Participant(original=None, user_id=user_id,
                               id=f"{user_id}__s"), track_id=track_id, track_type=kind)

    em.send(added("physio-1", "t-physio", TrackType.VIDEO))      # physio camera first: ignored
    em.send(added("patient-1", "t-audio", TrackType.AUDIO))       # patient audio: ignored
    em.send(added("patient-1", "t-video", TrackType.VIDEO))       # patient camera: subscribed
    await em.wait()
    assert subscribed == ["t-video"]
    await pose.close()


# ------------------------------------------------------------------ Live Coach (WP1a): private surfaces we override

def _live_settings(**over):
    from physiocoach.call.live_coach import LiveCoachSettings
    return LiveCoachSettings(**{"enabled": True, "reason": "test", "connect_timeout_s": 3.0, **over})


def _live_cfg():
    from physiocoach.core.contracts import StartAgentRequest
    return StartAgentRequest.model_validate(dict(
        sessionId="s1", callType="default", callId="s1", agentUserId="agent",
        patient={"id": "pat", "name": "P", "lang": "ml"}, physioId="phy",
        exercise={"id": "knee_bend", "joints": ("hip", "knee", "ankle"), "mode": "flex", "rest": 15,
                  "start": 25, "minPeak": 35, "cameraView": "side"},
        prescription={"side": "auto", "targetAngle": 60, "reps": 10, "sets": 2, "minSecondsPerRep": 2},
        mode="live"))


def _clip_pcm(frames: int = 3):
    import numpy as np
    from getstream.video.rtc.track_util import AudioFormat, PcmData
    samples = np.ones(960 * frames, dtype=np.int16)
    return PcmData.from_bytes(samples.tobytes(), sample_rate=48000, format=AudioFormat.S16, channels=1)


@pytest.fixture
def openai_env(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test")          # Realtime.__init__ builds AsyncOpenAI; no network


def test_vision_agents_internals_the_live_coach_relies_on():
    import inspect

    from vision_agents.core.agents.agents import Agent
    from vision_agents.core.agents.inference import AudioOutputChunk, AudioOutputFlush, RealtimeInferenceFlow
    from vision_agents.core.utils.audio_forwarder import AudioForwarder

    assert "not supported" in inspect.getsource(RealtimeInferenceFlow.say)        # agent.say is silent (clips bypass)
    interrupt = inspect.getsource(RealtimeInferenceFlow.interrupt)
    assert "flush" in interrupt and "_audio_output.clear()" in interrupt
    assert "await self.llm.connect()" in inspect.getsource(Agent.join)             # why connect() must not block
    assert callable(Agent._needs_video)
    assert "self._audio_output_stream = AudioOutputStream()" in inspect.getsource(Agent.__init__)
    assert "self.tts = None" in inspect.getsource(Agent._validate_configuration)  # why agent_main starts the TTS
    assert AudioOutputChunk(final=True).data is None and AudioOutputFlush() is not None
    assert "16000" in inspect.getsource(AudioForwarder._reader)                    # why we resample to 48 kHz


def test_openai_realtime_internals_we_override():
    import inspect

    from vision_agents.plugins.openai import Realtime
    from vision_agents.plugins.openai.rtc_manager import RTCManager

    src = inspect.getsource(Realtime._handle_openai_event)
    for needle in ("input_audio_buffer.speech_started", "await self.interrupt()", "response.done", "raise err",
                   "output_audio_buffer.started"):
        assert needle in src, needle
    assert "_emit_audio_output_event" in inspect.getsource(Realtime._handle_audio_output)
    tool = inspect.getsource(Realtime._send_tool_response)
    assert "function_call_output" in tool and "response.create" in tool             # why we override it
    assert "self.rtc.set_audio_callback(self._handle_audio_output)" in inspect.getsource(Realtime.connect)
    for name in ("_send_event", "connect", "close"):
        assert callable(getattr(RTCManager, name)), name
    assert "_data_channel_open_event" in inspect.getsource(RTCManager.__init__)
    assert "self.client.realtime.calls.create" in inspect.getsource(RTCManager._exchange_sdp)


async def test_live_coach_realtime_constructs_and_registers_five_tools(openai_env):
    from vision_agents.plugins.openai.tool_utils import convert_tools_to_openai_format

    from physiocoach.call.live_coach import LiveCoach
    from physiocoach.call.live_coach_rt import LiveCoachRealtime, register_tools

    coach = LiveCoach(_live_cfg(), _live_settings(), None)
    llm = LiveCoachRealtime(coach, _live_settings())
    assert llm.realtime_session["type"] == "realtime" and llm.realtime_session["audio"]["output"]["voice"] == "marin"
    assert llm.rtc.send_video is False and llm.rtc.pc is not None and llm.rtc.data_channel is None
    names = register_tools(llm, coach)
    assert len(names) == 5 and sorted(llm.function_registry.list_functions()) == sorted(names)
    tools = convert_tools_to_openai_format(llm.get_available_functions(), for_realtime=True)
    assert {t["name"] for t in tools} == set(names) and all("strict" not in t for t in tools)
    out = await llm.call_function("report_pain", {"score": 3})
    assert out == {"error": "not_ready"}                                           # before bind
    await llm.close()


async def test_coach_agent_uses_the_realtime_flow_without_video_or_tts(openai_env):
    from vision_agents.core import User

    from physiocoach.call.live_coach import LiveCoach
    from physiocoach.call.live_coach_rt import CoachAgent, LiveCoachRealtime
    from physiocoach.call.silent_tts import SilentTTS

    coach = LiveCoach(_live_cfg(), _live_settings(), None)
    llm = LiveCoachRealtime(coach, _live_settings())
    pose = PoseProcessor(lambda: None)
    agent = CoachAgent(edge=NoChatEdge(), llm=llm, agent_user=User(id="agent", name="PhysioCoach"),
                       instructions="Live coach test.", tts=SilentTTS(), processors=[pose])
    assert type(agent._flow).__name__ == "RealtimeInferenceFlow"
    assert agent._needs_video() is False and agent.tts is None and agent.publish_audio
    assert llm.realtime_session["instructions"] == "Live coach test."
    await llm.close()
    await pose.close()


async def test_start_connect_failure_retries_once_minimal_then_marks_down(openai_env):
    import asyncio

    from physiocoach.call.live_coach import LiveCoach
    from physiocoach.call.live_coach_rt import LiveCoachRealtime

    coach = LiveCoach(_live_cfg(), _live_settings(), None)
    llm = LiveCoachRealtime(coach, _live_settings())
    first_rtc = llm.rtc
    seen: list[dict] = []

    async def boom(*, session, sdp, **kw):
        seen.append(session)
        raise RuntimeError("no network in tests")

    llm.client.realtime.calls.create = boom
    await llm.connect()                                          # returns at once (B12)
    assert not llm.up and llm._connect_task is None
    await llm.start_connect()
    await asyncio.wait_for(llm._connect_task, 30)
    assert llm.connect_attempts == ["full", "minimal"]
    assert llm.rtc is not first_rtc                              # a fresh RTCManager for the retry
    assert coach.down and not coach.up and not llm.up
    assert len(seen) == 2                                        # both attempts reached the SDP exchange
    assert "noise_reduction" in seen[0]["audio"]["input"] and "noise_reduction" not in seen[1]["audio"]["input"]
    await llm.close()


async def test_audio_output_gate_resamples_to_48k_and_marks_edges(openai_env):
    import numpy as np
    from getstream.video.rtc.track_util import AudioFormat, PcmData
    from vision_agents.core.llm.realtime import RealtimeAudioOutput, RealtimeAudioOutputDone

    from physiocoach.call.live_coach import LiveCoach
    from physiocoach.call.live_coach_rt import LiveCoachRealtime

    class Gate:
        ok = True
        rt_state = "speaking"

        def accept_rt_pcm(self, nonsilent):
            return self.ok

    llm = LiveCoachRealtime(LiveCoach(_live_cfg(), _live_settings(), None), _live_settings())
    llm.coach = Gate()
    llm._up = True
    tone = (np.sin(np.arange(320) / 3) * 8000).astype(np.int16)
    pcm16 = PcmData.from_bytes(tone.tobytes(), sample_rate=16000, format=AudioFormat.S16, channels=1)
    await llm._handle_audio_output(pcm16)
    items = llm._output.peek()
    assert isinstance(items[-1], RealtimeAudioOutput) and items[-1].data.sample_rate == 48000
    llm.coach.ok = False
    await llm._handle_audio_output(pcm16)
    items = llm._output.peek()
    assert isinstance(items[-1], RealtimeAudioOutputDone) and not items[-1].interrupted   # final=True marker
    n = len(items)
    await llm._handle_audio_output(pcm16)
    assert len(llm._output.peek()) == n                          # dropped, and only one edge marker
    llm._up = False
    await llm.close()


async def test_tool_response_sends_output_without_response_create(openai_env):
    import asyncio

    from physiocoach.call.live_coach import LiveCoach
    from physiocoach.call.live_coach_rt import LiveCoachRealtime

    coach = LiveCoach(_live_cfg(), _live_settings(), None)
    llm = LiveCoachRealtime(coach, _live_settings())
    sent: list[dict] = []

    async def capture(ev):
        sent.append(ev)

    llm.rtc._send_event = capture
    llm._up = True
    coach.attach_port(llm)
    await llm._send_tool_response("call_1", {"recorded": True, "halted": False, "_no_reply": True})
    await asyncio.sleep(0.05)
    assert [e["type"] for e in sent] == ["conversation.item.create"]
    assert sent[0]["item"]["type"] == "function_call_output" and "_no_reply" not in sent[0]["item"]["output"]
    llm._up = False
    await llm.close()


async def test_direct_clip_player_and_flush_local_use_the_shared_output_stream(openai_env):
    from vision_agents.core import User
    from vision_agents.core.agents.inference import AudioOutputChunk, AudioOutputFlush

    from physiocoach.call.live_coach import LiveCoach
    from physiocoach.call.live_coach_rt import CoachAgent, DirectClipPlayer, LiveCoachRealtime

    class ClipTTS:
        async def stream_audio(self, text):
            return _clip_pcm(3)

    llm = LiveCoachRealtime(LiveCoach(_live_cfg(), _live_settings(), None), _live_settings())
    pose = PoseProcessor(lambda: None)
    agent = CoachAgent(edge=NoChatEdge(), llm=llm, agent_user=User(id="agent", name="PhysioCoach"),
                       instructions="x", processors=[pose])
    await DirectClipPlayer(ClipTTS(), agent)("clip")
    items = agent._audio_output_stream.peek()
    assert len([i for i in items if isinstance(i, AudioOutputChunk) and i.data is not None and not i.final]) == 3
    assert items[-1].final
    llm.flush_local()                                            # synchronous (B7)
    assert [type(i) for i in agent._audio_output_stream.peek()] == [AudioOutputFlush]
    await llm.close()
    await pose.close()


async def test_agent_main_builds_live_mode_and_falls_back_on_any_error(openai_env, monkeypatch):
    from physiocoach import agent_main
    from physiocoach.call import live_coach_rt
    from physiocoach.call.live_coach import resolve_live_coach_settings
    from physiocoach.call.silent_tts import SilentTTS

    cfg = _live_cfg()
    pose = PoseProcessor(lambda: None)
    assert agent_main.build_live(cfg, resolve_live_coach_settings({"OPENAI_API_KEY": "k", "LIVE_COACH": "off"}),
                                 pose, SilentTTS()) is None
    assert agent_main.build_live(cfg, resolve_live_coach_settings({}), pose, SilentTTS()) is None
    live = agent_main.build_live(cfg, resolve_live_coach_settings({"OPENAI_API_KEY": "k"}), pose, SilentTTS())
    assert live is not None and type(live.agent).__name__ == "CoachAgent" and live.coach.port is live.llm
    assert len(live.tools) == 5 and live.facade.edge is live.agent.edge          # facade delegates
    await live.llm.close()

    def broken(*a, **kw):
        raise RuntimeError("plugin changed")

    monkeypatch.setattr(live_coach_rt, "LiveCoachRealtime", broken)
    assert agent_main.build_live(cfg, resolve_live_coach_settings({"OPENAI_API_KEY": "k"}), pose, SilentTTS()) is None
    await pose.close()


def test_note_llm_is_on_by_default(monkeypatch):
    from physiocoach import agent_main
    for value, expected in ((None, True), ("", True), ("true", True), ("TRUE", True), ("false", False), ("0", False)):
        if value is None:
            monkeypatch.delenv("NOTE_LLM_ENABLED", raising=False)
        else:
            monkeypatch.setenv("NOTE_LLM_ENABLED", value)
        assert agent_main.note_llm_enabled() is expected, value
