"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { ErrorState } from "@/components/error-state";

import type { CallInfo } from "../../types";
import { S } from "../../strings";
import { PatientCallProvider, PhysioCallProvider } from "../components/call-provider";

const Centered = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-full items-center justify-center bg-radial from-sidebar-accent to-sidebar">{children}</div>
);

export const PhysioCallView = ({ sessionId }: { sessionId: string }) => {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.sessions.getOne.queryOptions({ id: sessionId }));

  if (data.status !== "scheduled" && data.status !== "live") {
    return <Centered><ErrorState title="This session is not active" description="Start a new session from the prescription." /></Centered>;
  }

  const info: CallInfo = {
    viewer: "physio",
    sessionId: data.id,
    streamCallId: data.streamCallId,
    callType: data.streamCallType,
    patientId: data.patientId,
    physioId: data.physioId,
    patientLang: "ml",
    label: `${data.patient.name} · ${data.exercise.nameEn}`,
    exercise: { nameEn: data.exercise.nameEn, nameMl: data.exercise.nameMl },
    prescription: { targetAngle: data.prescription.targetAngle, reps: data.prescription.reps, sets: data.prescription.sets },
  };
  return <PhysioCallProvider info={info} />;
};

export const PatientCallView = ({ token }: { token: string }) => {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.join.resolve.queryOptions({ token }));

  const info: CallInfo = {
    viewer: "patient",
    sessionId: data.sessionId,
    streamCallId: data.streamCallId,
    callType: data.callType,
    patientId: data.patient.id,
    physioId: data.physioId,
    patientLang: data.patient.preferredLanguage === "en" ? "en" : "ml",
    label: data.exercise.nameEn,
    exercise: {
      nameEn: data.exercise.nameEn, nameMl: data.exercise.nameMl, cameraView: data.exercise.cameraView,
      howToEn: data.exercise.howToEn ?? undefined, howToMl: data.exercise.howToMl ?? undefined,
    },
    prescription: { targetAngle: data.prescription.targetAngle, reps: data.prescription.reps, sets: data.prescription.sets },
    joinToken: token,
  };
  return <PatientCallProvider info={info} user={data.patient} />;
};

export const JoinErrorState = () => (
  <Centered>
    <ErrorState title={`${S.linkInvalid.ml}`} description={S.linkInvalid.en} />
  </Centered>
);
