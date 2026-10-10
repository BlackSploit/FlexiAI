/** Everything the call screens need, from sessions.getOne (physio) or join.resolve (patient). */
export type CallInfo = {
  viewer: "physio" | "patient";
  sessionId: string;
  streamCallId: string;
  callType: string;
  patientId: string;
  physioId: string;
  patientLang: "ml" | "en";
  label: string;
  exercise: { nameEn: string; nameMl: string; cameraView?: "side" | "front"; howToEn?: string; howToMl?: string };
  prescription: { targetAngle: number; reps: number; sets: number };
  joinToken?: string;
};

export type CallUser = { id: string; name: string; image: string };
