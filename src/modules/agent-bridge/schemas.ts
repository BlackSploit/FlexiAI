/**
 * Contracts between the web app, the browser call UI and the Python agent worker (§7.7).
 *
 * AUTHORITATIVE for TypeScript. `agent/physiocoach/core/contracts.py` mirrors it and
 * `shared/fixtures/**` holds valid and invalid examples parsed by both vitest and pytest.
 * Change all three together.
 */
import { z } from "zod";

const env = { v: z.literal(1), eventId: z.string().min(8).max(64), ts: z.number().int() };
export const Phase = z.enum(["greeting", "await_consent", "positioning", "countdown", "set", "summary", "await_pain", "rest", "done", "halted"]);

/* ---------- client -> agent (Stream custom events + backup tRPC path) ---------- */
export const ClientToAgentEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pc.consent"), ...env, agreed: z.literal(true) }),
  z.object({ type: z.literal("pc.stop"), ...env, reason: z.literal("button") }),
  z.object({ type: z.literal("pc.pain_score"), ...env, score: z.number().int().min(0).max(10), setIndex: z.number().int().min(1) }),
  z.object({ type: z.literal("pc.symptom"), ...env, kind: z.enum(["dizziness", "chest_pain", "sharp_pain"]) }),
]);

/* ---------- agent -> all clients ---------- */
export const AgentToClientEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pc.ready"), ...env, agentVersion: z.string() }),
  z.object({ type: z.literal("pc.state"), ...env, phase: Phase, setIndex: z.number().int().min(0), setsPlanned: z.number().int().min(1), reason: z.string().optional() }),
  z.object({ type: z.literal("pc.rep"), ...env, setIndex: z.number().int(), n: z.number().int().min(1), peak: z.number(), seconds: z.number(), tooFast: z.boolean(), target: z.number(), repsPlanned: z.number().int() }),
  z.object({ type: z.literal("pc.caption"), ...env, id: z.string(), ml: z.string().max(400), en: z.string().max(400), kind: z.enum(["count", "cue", "note", "prompt", "safety"]) }),
  z.object({ type: z.literal("pc.set_summary"), ...env, setIndex: z.number().int(), repsDone: z.number().int(), repsPlanned: z.number().int(), avgPeak: z.number(), bestPeak: z.number(), target: z.number(), fastReps: z.number().int(), score: z.number().min(0).max(100), feedbackSource: z.enum(["rules", "llm"]) }),
  z.object({ type: z.literal("pc.request_pain"), ...env, setIndex: z.number().int() }),
  z.object({ type: z.literal("pc.safety_alert"), ...env, reason: z.enum(["pain", "stop", "symptom", "agent_down"]), score: z.number().int().optional(), symptom: z.string().optional(), setIndex: z.number().int().optional() }),
]);
export type ClientToAgentEvent = z.infer<typeof ClientToAgentEvent>;
export type AgentToClientEvent = z.infer<typeof AgentToClientEvent>;

/* ---------- worker -> web callbacks (POST /api/agent/events) ---------- */
const cb = { eventId: z.string().min(8).max(64), sessionId: z.string().min(1) };
export const PerRepSchema = z.object({ peak: z.number(), seconds: z.number(), tooFast: z.boolean() });
export const SetStopReason = z.enum(["completed", "idle", "stop_pressed", "pain", "symptom", "disconnected"]);
export const AgentCallback = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent_joined"), ...cb, pid: z.number().int(), host: z.string() }),
  z.object({ type: z.literal("consent_given"), ...cb, at: z.string().datetime() }),
  z.object({
    type: z.literal("set_result"), ...cb, setIndex: z.number().int().min(1), repsDone: z.number().int().min(0), repsPlanned: z.number().int(),
    targetAngle: z.number().int(), side: z.enum(["left", "right"]).nullable(), avgPeak: z.number(), bestPeak: z.number(), lowestPeak: z.number(),
    avgRepSeconds: z.number(), fastReps: z.number().int(), score: z.number().min(0).max(100), perRep: z.array(PerRepSchema).max(60),
    feedbackMl: z.string().max(2000), feedbackEn: z.string().max(2000), feedbackSource: z.enum(["rules", "llm"]),
    stopReason: SetStopReason,
  }),
  z.object({
    type: z.literal("pain_recorded"), ...cb, setIndex: z.number().int().min(1), score: z.number().int().min(0).max(10),
    clientEventId: z.string(), // the patient's original pc.pain_score eventId
  }),
  z.object({
    type: z.literal("safety_alert"), ...cb, kind: z.enum(["stop", "pain", "symptom", "agent_down"]), symptom: z.string().optional(),
    painScore: z.number().int().optional(), setIndex: z.number().int().optional(),
    clientEventId: z.string(), // ALWAYS the triggering client eventId, never a new id
  }),
  z.object({ type: z.literal("agent_exited"), ...cb, code: z.number().int(), signal: z.string().nullable(), setsCompleted: z.number().int() }),
  z.object({ type: z.literal("heartbeat"), ...cb }),
]);
export type AgentCallback = z.infer<typeof AgentCallback>;

/** The ONLY values ever written to call_sessions.failure_reason. */
export const FailureReason = z.enum(["cancelled", "agent_start_failed", "agent_join_timeout", "patient_never_joined",
  "patient_left", "no_consent", "no_sets", "agent_crashed"]);
export type FailureReason = z.infer<typeof FailureReason>;

/* ---------- web -> worker control payload ---------- */
export const StartAgentRequest = z.object({
  sessionId: z.string(), callType: z.string(), callId: z.string(), agentUserId: z.string(),
  patient: z.object({ id: z.string(), name: z.string(), lang: z.enum(["ml", "en"]) }),
  physioId: z.string(),
  exercise: z.object({
    id: z.string(), joints: z.tuple([z.string(), z.string(), z.string()]), mode: z.enum(["flex", "direct"]),
    rest: z.number(), start: z.number(), minPeak: z.number(), cameraView: z.enum(["side", "front"]),
  }),
  prescription: z.object({ side: z.enum(["auto", "left", "right"]), targetAngle: z.number().int(), reps: z.number().int(), sets: z.number().int(), minSecondsPerRep: z.number() }),
  mode: z.enum(["live", "replay"]), clip: z.string().optional(), startSetIndex: z.number().int().min(1).default(1),
  consentGiven: z.boolean().default(false), // true on restartAgent when consentGivenAt is set
});
export type StartAgentRequest = z.input<typeof StartAgentRequest>;
