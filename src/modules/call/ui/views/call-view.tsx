"use client";

import Link from "next/link";
import { useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { CalendarX2Icon, Link2OffIcon } from "lucide-react";

import type { CallInfo } from "../../types";
import { S } from "../../strings";
import { PatientCallProvider, PhysioCallProvider } from "../components/call-provider";
import { StatusCard } from "../components/call-brand";

export const PhysioCallErrorState = ({ title, description }: { title: string; description: string }) => (
  <StatusCard icon={CalendarX2Icon} tone="danger" title={title} description={description} />
);

export const PhysioCallView = ({ sessionId }: { sessionId: string }) => {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.sessions.getOne.queryOptions({ id: sessionId }));

  if (data.status !== "scheduled" && data.status !== "live") {
    return (
      <StatusCard icon={CalendarX2Icon} title="This session is not active" description="It has already finished or was cancelled. Start a new session from the prescription.">
        <Button asChild><Link href={`/sessions/${data.id}`}>View session</Link></Button>
      </StatusCard>
    );
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
  <StatusCard
    icon={Link2OffIcon}
    tone="danger"
    title={<span lang="ml" className="font-ml text-lg leading-relaxed">{S.linkInvalid.ml}</span>}
    description={S.linkInvalid.en}
  />
);
