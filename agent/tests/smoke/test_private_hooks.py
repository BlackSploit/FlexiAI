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
