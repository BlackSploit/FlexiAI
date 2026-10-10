import "server-only";

import { StreamClient } from "@stream-io/node-sdk";

import { lazy } from "@/lib/lazy";

export const streamVideo = lazy(() => new StreamClient(
  process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY!,
  process.env.STREAM_VIDEO_SECRET_KEY!,
  { timeout: 10_000 },
));

export const CALL_TYPE = process.env.STREAM_CALL_TYPE ?? "default"; // "physio_session" once verified
export const AGENT_USER_ID = process.env.NEXT_PUBLIC_STREAM_AGENT_USER_ID ?? "physiocoach-agent";
export const callCid = (callId: string, type = CALL_TYPE) => `${type}:${callId}`;

/** Spec: store no media. Applied per call AND on the call type. */
const NO_MEDIA_STORAGE = {
  recording: { mode: "disabled" as const },
  transcription: { mode: "disabled" as const, closed_caption_mode: "disabled" as const },
  individual_recording: { mode: "disabled" as const },
  raw_recording: { mode: "disabled" as const },
  // frame_recording requires capture_interval_in_seconds even when disabled; it is disabled on the call type.
};

type Person = { id: string; name: string; image?: string | null };

export async function upsertStreamUsers(people: (Person & { appRole: "physio" | "patient" | "agent" })[]) {
  await streamVideo.upsertUsers(people.map((p) => ({
    id: p.id,
    name: p.name,
    image: p.image ?? undefined,
    role: "user", // NEVER "admin"
    custom: { app_role: p.appRole },
  })));
}

export async function createGuidedCall(o: {
  callId: string;
  callSessionId: string;
  prescriptionId: string;
  exerciseId: string;
  physio: Person;
  patient: Person;
  mode: "live" | "replay";
}) {
  await upsertStreamUsers([
    { ...o.physio, appRole: "physio" },
    { ...o.patient, appRole: "patient" },
    { id: AGENT_USER_ID, name: "PhysioCoach", appRole: "agent" },
  ]);
  const call = streamVideo.video.call(CALL_TYPE, o.callId);
  const res = await call.getOrCreate({
    data: {
      created_by_id: o.physio.id,
      members: [
        { user_id: o.physio.id, role: "admin", custom: { app_role: "physio" } }, // call-level admin: can end the call
        { user_id: o.patient.id, role: "call_member", custom: { app_role: "patient" } },
        { user_id: AGENT_USER_ID, role: "call_member", custom: { app_role: "agent" } },
      ],
      custom: {
        app: "physiocoach",
        callSessionId: o.callSessionId,
        prescriptionId: o.prescriptionId,
        exerciseId: o.exerciseId,
        patientId: o.patient.id,
        physioId: o.physio.id,
        mode: o.mode,
      },
      settings_override: {
        ...NO_MEDIA_STORAGE,
        limits: { max_duration_seconds: 60 * 60, max_participants: 4 },
      },
    },
  });
  return res.call;
}

export const createPhysioUserToken = (userId: string) =>
  streamVideo.generateUserToken({ user_id: userId, validity_in_seconds: 60 * 60 });

export const createPatientCallToken = (patientId: string, callId: string, type = CALL_TYPE) =>
  streamVideo.generateCallToken({
    user_id: patientId,
    call_cids: [callCid(callId, type)],
    role: "call_member",
    validity_in_seconds: 2 * 60 * 60,
  });

export const endGuidedCall = (callId: string, type = CALL_TYPE) => streamVideo.video.call(type, callId).end();
