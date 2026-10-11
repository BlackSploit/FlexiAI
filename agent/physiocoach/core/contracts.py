"""Pydantic mirror of src/modules/agent-bridge/schemas.ts (§7.7). The zod file is authoritative.

Change zod, this file and shared/fixtures/** together; both test suites parse every fixture.
"""

from datetime import datetime
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


class _Model(BaseModel):
    # strict: no str->int coercion, matching zod (which never coerces).
    model_config = ConfigDict(strict=True)


EventId = Annotated[str, Field(min_length=8, max_length=64)]
Phase = Literal["greeting", "await_consent", "positioning", "countdown", "set", "summary",
                "await_pain", "rest", "done", "halted"]


class _Envelope(_Model):
    v: Literal[1]
    eventId: EventId
    ts: int


# ---------- client -> agent (Stream custom events, also via the backup tRPC path) ----------

class ConsentEvent(_Envelope):
    type: Literal["pc.consent"]
    agreed: Literal[True]


class StopEvent(_Envelope):
    type: Literal["pc.stop"]
    reason: Literal["button"]


class PainScoreEvent(_Envelope):
    type: Literal["pc.pain_score"]
    score: Annotated[int, Field(ge=0, le=10)]
    setIndex: Annotated[int, Field(ge=1)]


class SymptomEvent(_Envelope):
    type: Literal["pc.symptom"]
    kind: Literal["dizziness", "chest_pain", "sharp_pain"]


ClientToAgentEvent = Annotated[
    Union[ConsentEvent, StopEvent, PainScoreEvent, SymptomEvent], Field(discriminator="type")]
client_event_adapter: TypeAdapter = TypeAdapter(ClientToAgentEvent)


# ---------- agent -> all clients ----------

class ReadyEvent(_Envelope):
    type: Literal["pc.ready"]
    agentVersion: str


class StateEvent(_Envelope):
    type: Literal["pc.state"]
    phase: Phase
    setIndex: Annotated[int, Field(ge=0)]
    setsPlanned: Annotated[int, Field(ge=1)]
    reason: Optional[str] = None


class RepEvent(_Envelope):
    type: Literal["pc.rep"]
    setIndex: int
    n: Annotated[int, Field(ge=1)]
    peak: float
    seconds: float
    tooFast: bool
    target: float
    repsPlanned: int


class CaptionEvent(_Envelope):
    type: Literal["pc.caption"]
    id: str
    ml: Annotated[str, Field(max_length=400)]
    en: Annotated[str, Field(max_length=400)]
    kind: Literal["count", "cue", "note", "prompt", "safety"]


class SetSummaryEvent(_Envelope):
    type: Literal["pc.set_summary"]
    setIndex: int
    repsDone: int
    repsPlanned: int
    avgPeak: float
    bestPeak: float
    target: float
    fastReps: int
    score: Annotated[float, Field(ge=0, le=100)]
    feedbackSource: Literal["rules", "llm"]


class RequestPainEvent(_Envelope):
    type: Literal["pc.request_pain"]
    setIndex: int


class SafetyAlertEvent(_Envelope):
    type: Literal["pc.safety_alert"]
    reason: Literal["pain", "stop", "symptom", "agent_down"]
    score: Optional[int] = None
    symptom: Optional[str] = None
    setIndex: Optional[int] = None


VoiceState = Literal["off", "listening", "thinking", "speaking"]


class TranscriptEvent(_Envelope):
    """Live-coach speech transcript; partials and the final for one utterance share role + turnId."""
    type: Literal["pc.transcript"]
    role: Literal["user", "coach"]
    turnId: Annotated[str, Field(min_length=1, max_length=64)]
    text: Annotated[str, Field(max_length=400)]
    final: bool
    lang: Optional[Literal["ml", "en", "other"]] = None


class VoiceEvent(_Envelope):
    """Live-coach voice state; `live` is whether the realtime coach connection is up."""
    type: Literal["pc.voice"]
    state: VoiceState
    live: bool


AgentToClientEvent = Annotated[
    Union[ReadyEvent, StateEvent, RepEvent, CaptionEvent, SetSummaryEvent, RequestPainEvent, SafetyAlertEvent,
          TranscriptEvent, VoiceEvent],
    Field(discriminator="type")]
agent_event_adapter: TypeAdapter = TypeAdapter(AgentToClientEvent)


# ---------- worker -> web callbacks (POST /api/agent/events) ----------

class _Callback(_Model):
    eventId: EventId
    sessionId: Annotated[str, Field(min_length=1)]


class PerRep(_Model):
    peak: float
    seconds: float
    tooFast: bool


StopReason = Literal["completed", "idle", "stop_pressed", "pain", "symptom", "disconnected"]


class AgentJoinedCallback(_Callback):
    type: Literal["agent_joined"]
    pid: int
    host: str


class ConsentGivenCallback(_Callback):
    type: Literal["consent_given"]
    at: datetime


class SetResultCallback(_Callback):
    type: Literal["set_result"]
    setIndex: Annotated[int, Field(ge=1)]
    repsDone: Annotated[int, Field(ge=0)]
    repsPlanned: int
    targetAngle: int
    side: Optional[Literal["left", "right"]]          # required key, may be null (zod .nullable())
    avgPeak: float
    bestPeak: float
    lowestPeak: float
    avgRepSeconds: float
    fastReps: int
    score: Annotated[float, Field(ge=0, le=100)]
    perRep: Annotated[list[PerRep], Field(max_length=60)]
    feedbackMl: Annotated[str, Field(max_length=2000)]
    feedbackEn: Annotated[str, Field(max_length=2000)]
    feedbackSource: Literal["rules", "llm"]
    stopReason: StopReason


class PainRecordedCallback(_Callback):
    type: Literal["pain_recorded"]
    setIndex: Annotated[int, Field(ge=1)]
    score: Annotated[int, Field(ge=0, le=10)]
    clientEventId: str                                # the patient's original pc.pain_score eventId


class SafetyAlertCallback(_Callback):
    type: Literal["safety_alert"]
    kind: Literal["stop", "pain", "symptom", "agent_down"]
    symptom: Optional[str] = None
    painScore: Optional[int] = None
    setIndex: Optional[int] = None
    clientEventId: str                                # ALWAYS the triggering client eventId


class AgentExitedCallback(_Callback):
    type: Literal["agent_exited"]
    code: int
    signal: Optional[str]
    setsCompleted: int


class HeartbeatCallback(_Callback):
    type: Literal["heartbeat"]


AgentCallback = Annotated[
    Union[AgentJoinedCallback, ConsentGivenCallback, SetResultCallback, PainRecordedCallback,
          SafetyAlertCallback, AgentExitedCallback, HeartbeatCallback],
    Field(discriminator="type")]
callback_adapter: TypeAdapter = TypeAdapter(AgentCallback)

FailureReason = Literal["cancelled", "agent_start_failed", "agent_join_timeout", "patient_never_joined",
                        "patient_left", "no_consent", "no_sets", "agent_crashed"]


# ---------- web -> worker control payload ----------

class PatientInfo(_Model):
    id: str
    name: str
    lang: Literal["ml", "en"]


class ExerciseInfo(_Model):
    id: str
    joints: tuple[str, str, str]
    mode: Literal["flex", "direct"]
    rest: float
    start: float
    minPeak: float
    cameraView: Literal["side", "front"]


class PrescriptionInfo(_Model):
    side: Literal["auto", "left", "right"]
    targetAngle: int
    reps: int
    sets: int
    minSecondsPerRep: float


class StartAgentRequest(_Model):
    sessionId: str
    callType: str
    callId: str
    agentUserId: str
    patient: PatientInfo
    physioId: str
    exercise: ExerciseInfo
    prescription: PrescriptionInfo
    mode: Literal["live", "replay"]
    clip: Optional[str] = None
    startSetIndex: Annotated[int, Field(ge=1)] = 1
    consentGiven: bool = False                        # true on restartAgent when consentGivenAt is set
