/**
 * Dev only (Milestone 2): create a guided Stream call with dev users and print the ids, tokens and
 * the PC_SESSION_JSON for the agent. No database needed.
 *
 *   npm run dev:create-call                      # new call id
 *   npm run dev:create-call -- <callId>          # reuse an id
 */
import "dotenv/config";

import { writeFileSync } from "node:fs";
import { nanoid } from "nanoid";

import exercises from "../shared/exercises.json";
import {
  AGENT_USER_ID,
  CALL_TYPE,
  createGuidedCall,
  createPatientCallToken,
  createPhysioUserToken,
} from "../src/lib/stream-video";

async function main() {
  const callId = process.argv[2] ?? `dev_${nanoid(10)}`;
  const physio = { id: "dev-physio", name: "Dev Physio" };
  const patient = { id: "dev-patient", name: "Dev Patient" };
  const knee = exercises.find((e) => e.id === "knee_bend")!;

  const call = await createGuidedCall({
    callId, callSessionId: callId, prescriptionId: "dev-rx", exerciseId: knee.id, physio, patient, mode: "live",
  });

  const session = {
    sessionId: callId, callType: CALL_TYPE, callId, agentUserId: AGENT_USER_ID,
    patient: { id: patient.id, name: patient.name, lang: "ml" }, physioId: physio.id,
    exercise: { id: knee.id, joints: knee.joints, mode: knee.mode, rest: knee.rest, start: knee.start, minPeak: knee.minPeak, cameraView: knee.cameraView },
    prescription: { side: "auto", targetAngle: 60, reps: 10, sets: 1, minSecondsPerRep: 2 },
    mode: "live",
  };
  writeFileSync("dev-session.json", JSON.stringify(session));

  const settings = call.settings;
  console.log(JSON.stringify({
    callType: CALL_TYPE,
    callId,
    physioToken: createPhysioUserToken(physio.id),
    patientToken: createPatientCallToken(patient.id, callId),
    storage: {
      recording: settings.recording.mode,
      transcription: settings.transcription.mode,
      closedCaptions: settings.transcription.closed_caption_mode,
    },
    sessionJsonWrittenTo: "dev-session.json",
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
