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
