"use client";

import Link from "next/link";
import Image from "next/image";
import { CallControls, ParticipantView, ParticipantsAudio } from "@stream-io/video-react-sdk";

import { Button } from "@/components/ui/button";

import type { CallInfo } from "../../types";
import { S } from "../../strings";
import { useAgentEvents } from "../../hooks/use-agent-events";
import { useSendInput } from "../../hooks/use-send-input";
import { useCallPeople } from "../../hooks/use-agent-participant";
import { PhysioLivePanel } from "./physio-live-panel";
import {
  AutoplayUnblock, CaptionsPanel, ConsentBanner, PainScale, PhaseIndicator, RepCounter, StopButton, SymptomButtons,
} from "./guided-controls";

interface Props {
  info: CallInfo;
  onLeave: () => void;
  onEndForAll?: () => void;
}

/** §10.3: the agent's annotated tile is the main view for both; the physio also sees the raw patient tile. */
export const GuidedCallLayout = ({ info, onLeave, onEndForAll }: Props) => {
  const { feed, dismissAlert } = useAgentEvents();
  const send = useSendInput(info.viewer === "patient"
    ? { viewer: "patient", joinToken: info.joinToken! }
    : { viewer: "physio", sessionId: info.sessionId });
  const { agent, patient, others } = useCallPeople(info.patientId);
  const isPatient = info.viewer === "patient";
  const me = isPatient ? patient : others.find((p) => p.isLocalParticipant);
  // Participants not rendered with a ParticipantView still need their audio.
  const unrendered = [...others, ...(patient ? [patient] : [])]
    .filter((p) => !p.isLocalParticipant && (isPatient || p.userId !== info.patientId));

  return (
    <div className="h-dvh flex flex-col md:grid md:grid-cols-[1fr_360px] gap-3 p-3 text-white">
      <div className="flex flex-col gap-3 min-h-0">
        <div className="bg-[#101213] rounded-full px-4 py-2 flex items-center gap-3">
          {isPatient ? (
            <span className="flex items-center justify-center p-1 bg-white/10 rounded-full"><Image src="/logo.svg" width={22} height={22} alt="PhysioCoach" /></span>
          ) : (
            <Link href={`/sessions/${info.sessionId}`} className="flex items-center justify-center p-1 bg-white/10 rounded-full">
              <Image src="/logo.svg" width={22} height={22} alt="PhysioCoach" />
            </Link>
          )}
          <h4 className="text-base truncate">
            {info.label}{isPatient && <span lang="ml" className="font-ml opacity-80"> · {info.exercise.nameMl}</span>}
          </h4>
          <span className="ml-auto"><AutoplayUnblock /></span>
        </div>

        <div className="relative flex-1 min-h-[40dvh] rounded-xl overflow-hidden bg-black">
          {agent ? (
            <ParticipantView participant={agent} className="h-full [&_video]:object-contain" />
          ) : (
            <div className="h-full flex items-center justify-center text-lg">
              <span lang="ml" className="font-ml">{S.coachJoining.ml}</span>&nbsp;· {S.coachJoining.en}
            </div>
          )}
          <div className="absolute top-3 left-3 flex flex-col items-start gap-2">
            <PhaseIndicator feed={feed} />
            <RepCounter feed={feed} repsPlanned={info.prescription.reps} />
          </div>
          {feed.alert?.reason === "agent_down" && (
            <div className="absolute inset-x-0 bottom-0 bg-rose-600 text-center py-2">
              <span lang="ml" className="font-ml">{S.coachDown.ml}</span> · {S.coachDown.en}
            </div>
          )}
          {isPatient && me && (
            <div className="absolute bottom-3 right-3 w-28 md:w-44 aspect-video rounded-lg overflow-hidden border border-white/30">
              <ParticipantView participant={me} mirror muteAudio className="h-full" />
            </div>
          )}
        </div>

        {!isPatient && patient && (
          <div className="h-40 md:h-52 rounded-xl overflow-hidden bg-black">
            <ParticipantView participant={patient} className="h-full" />
          </div>
        )}
        <ParticipantsAudio participants={unrendered} />
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto max-h-[45dvh] md:max-h-none">
        <CaptionsPanel feed={feed} showEnglish={!isPatient || info.patientLang === "en"} />
        {isPatient ? (
          <>
            <ConsentBanner feed={feed} send={send} />
            <StopButton send={send} />
            <PainScale feed={feed} send={send} />
            <SymptomButtons send={send} />
          </>
        ) : (
          <>
            <PhysioLivePanel feed={feed} sessionId={info.sessionId} targetAngle={info.prescription.targetAngle} onDismiss={dismissAlert} />
            <StopButton send={send} label={{ ml: "സെറ്റ് നിർത്തുക", en: "Stop the set" }} />
            {onEndForAll && <Button variant="secondary" onClick={onEndForAll}>End session for all</Button>}
          </>
        )}
        <div className="bg-[#101213] rounded-full px-4">
          <CallControls onLeave={onLeave} />
        </div>
      </div>
    </div>
  );
};
