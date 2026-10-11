"use client";

import Link from "next/link";
import { PowerIcon, WifiOffIcon } from "lucide-react";
import { DefaultParticipantViewUI, ParticipantView, ParticipantsAudio, useCallStateHooks } from "@stream-io/video-react-sdk";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import type { CallInfo } from "../../types";
import { S } from "../../strings";
import { useAgentEvents } from "../../hooks/use-agent-events";
import { useSendInput } from "../../hooks/use-send-input";
import { useCallPeople } from "../../hooks/use-agent-participant";
import type { AgentFeed } from "../../hooks/use-agent-events";
import { PhysioLivePanel } from "./physio-live-panel";
import { Bi, BrandMark } from "./call-brand";
import {
  AutoplayUnblock, CaptionsPanel, CaptionsSheet, ConsentBanner, MediaControls, PainScale, PhaseIndicator, RepCounter,
  StopButton, SymptomButtons,
} from "./guided-controls";
import {
  ConversationCard, LiveCoachBadge, MicOffHint, TranscriptBubbles, TranscriptPanel, VoiceStatus, isQuietPhase, readLiveCoach,
} from "./live-coach";

interface Props {
  info: CallInfo;
  onLeave: () => void;
  onEndForAll?: () => void;
}

const CoachJoining = () => (
  <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
    <span className="relative flex size-20 items-center justify-center">
      <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
      <span className="absolute inset-2 animate-spin rounded-full border-2 border-white/10 border-t-primary" />
      <span className="size-3 rounded-full bg-primary" />
    </span>
    <Bi t={S.coachJoining} className="items-center gap-1" mlClassName="text-xl text-white" enClassName="text-sm text-white/70 opacity-100" />
    <p className="text-xs text-white/50"><span lang="ml" className="font-ml">{S.waitingCoachHint.ml}</span> · {S.waitingCoachHint.en}</p>
  </div>
);

/** Phases where the realtime coach can talk with the patient (D2 output gate). */
const CONVERSATIONAL = new Set(["positioning", "summary", "await_pain", "rest"]);

/**
 * Patient live-coach dock, pinned to the bottom of the coach video: phone-only chat bubbles (desktop uses the
 * Conversation card), the mic-off hint, the voice orb with its status line, then the captions. In countdown
 * and set the bubbles give way to the "coach is quiet while counting" line.
 */
const PatientCoachDock = ({ feed, showEnglish }: { feed: AgentFeed; showEnglish: boolean }) => {
  const { useMicrophoneState } = useCallStateHooks();
  const mic = useMicrophoneState();
  const { transcript, voice } = readLiveCoach(feed);
  const quiet = isQuietPhase(feed.phase);
  const micHint = mic.optimisticIsMute && CONVERSATIONAL.has(feed.phase);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2.5 bg-gradient-to-t from-neutral-950 via-neutral-950/85 to-transparent px-3 pb-3 pt-8 sm:px-5 sm:pb-5 md:pt-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2.5">
        {!quiet && <TranscriptBubbles items={transcript} voice={voice} limit={6} className="max-h-[16dvh] md:hidden" />}
        {micHint && <MicOffHint onEnable={() => void mic.microphone.enable()} />}
        <VoiceStatus voice={voice} quiet={quiet} />
        <CaptionsSheet feed={feed} showEnglish={showEnglish} embedded limit={1} />
      </div>
    </div>
  );
};

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
  const agentDown = feed.alert?.reason === "agent_down";
  const coach = readLiveCoach(feed);

  const stage = (
    <div className={cn(
      "relative min-h-0 flex-1 overflow-hidden bg-black md:rounded-2xl md:ring-1 md:ring-white/10",
      isPatient ? "min-h-[36dvh]" : "min-h-[40dvh] rounded-2xl ring-1 ring-white/10",
    )}>
      {agent ? (
        <ParticipantView participant={agent} ParticipantViewUI={null}
          className="!aspect-auto h-full !w-full !max-w-none !rounded-none !bg-black [&_video]:!object-contain" />
      ) : (
        <CoachJoining />
      )}

      {/* Overlay chips */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-8rem)] flex-col items-start gap-2 sm:max-w-[60%]">
        <PhaseIndicator feed={feed} />
        <RepCounter feed={feed} repsPlanned={info.prescription.reps} />
      </div>

      {isPatient && me && (
        <div className="absolute right-3 top-3 z-10 aspect-[3/4] w-24 overflow-hidden rounded-xl shadow-xl ring-2 ring-white/30 sm:w-32 md:aspect-video md:w-44">
          <ParticipantView participant={me} mirror muteAudio ParticipantViewUI={null} className="!aspect-auto h-full !w-full !max-w-none !rounded-none [&_video]:!object-cover" />
        </div>
      )}

      {agentDown && (
        <div role="alert" className="absolute inset-x-3 top-1/2 z-10 mx-auto flex max-w-sm -translate-y-1/2 items-center gap-3 rounded-xl bg-rose-600/95 px-4 py-3 text-white shadow-xl">
          <WifiOffIcon className="size-5 shrink-0" aria-hidden />
          <Bi t={S.coachDown} mlClassName="text-base" />
        </div>
      )}

      {isPatient && (coach.liveCoach
        ? <PatientCoachDock feed={feed} showEnglish={info.patientLang === "en"} />
        : <CaptionsSheet feed={feed} showEnglish={info.patientLang === "en"} />)}
    </div>
  );

  if (isPatient) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-neutral-950 text-white">
        <header className="flex shrink-0 items-center gap-3 px-3 py-2 md:px-4 md:py-3">
          <BrandMark compact />
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium md:text-base">
            <span lang="ml" className="font-ml">{info.exercise.nameMl}</span>
            <span className="hidden text-white/60 sm:inline"> · {info.exercise.nameEn}</span>
          </h1>
          {coach.liveCoach && <LiveCoachBadge compact voice={coach.voice} />}
          <AutoplayUnblock />
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:gap-4 md:px-4">
          {stage}
          <aside className={cn(
            "flex shrink-0 flex-col gap-3 overflow-y-auto overscroll-contain px-3 transition-[max-height] duration-300 md:max-h-none md:w-[380px] md:px-0 md:pb-2",
            feed.awaitingPain ? "max-h-[58dvh]" : "max-h-[30dvh]",
          )}>
            <PainScale feed={feed} send={send} />
            <SymptomButtons send={send} />
            {coach.liveCoach && (
              <ConversationCard items={coach.transcript} voice={coach.voice} quiet={isQuietPhase(feed.phase)} className="hidden md:flex" />
            )}
          </aside>
          <ConsentBanner feed={feed} send={send} />
        </div>

        {/* Always visible: Stop + device controls */}
        <footer className="z-30 flex shrink-0 items-center gap-3 border-t border-white/10 bg-neutral-950/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:px-4">
          <StopButton send={send} className="min-w-0 flex-1" />
          <MediaControls onLeave={onLeave} />
        </footer>
        <ParticipantsAudio participants={unrendered} />
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-neutral-950 text-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-3 py-2 md:px-4">
        <Link href={`/sessions/${info.sessionId}`} className="rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60" aria-label="Back to session">
          <BrandMark compact />
        </Link>
        <span className="hidden h-5 w-px bg-white/15 sm:block" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium md:text-base">{info.label}</h1>
        <span className="hidden items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300 sm:inline-flex">
          <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex size-2 rounded-full bg-emerald-400" /></span>
          Live
        </span>
        {coach.liveCoach && <LiveCoachBadge compact voice={coach.voice} />}
        <AutoplayUnblock />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 md:grid md:grid-cols-[minmax(0,1fr)_400px] md:gap-4 md:overflow-hidden md:p-4">
        <div className="flex min-h-0 flex-col gap-3">
          {stage}
          {patient && (
            <div className="relative h-40 shrink-0 overflow-hidden rounded-2xl bg-black ring-1 ring-white/10 md:h-52">
              <ParticipantView participant={patient} ParticipantViewUI={DefaultParticipantViewUI} className="!aspect-auto h-full !w-full !max-w-none !rounded-none [&_video]:!object-contain" />
              <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-neutral-900/70 px-2.5 py-1 text-xs font-medium backdrop-blur">Patient camera (raw)</span>
            </div>
          )}
        </div>

        <aside className="flex min-h-0 flex-col gap-3 md:overflow-y-auto md:pr-1">
          <PhysioLivePanel feed={feed} sessionId={info.sessionId} targetAngle={info.prescription.targetAngle}
            repsPlanned={info.prescription.reps} agentPresent={!!agent} onDismiss={dismissAlert} />
          <CaptionsPanel feed={feed} showEnglish />
          {(coach.liveCoach || coach.transcript.length > 0) && (
            <TranscriptPanel items={coach.transcript} voice={coach.voice} live={coach.liveCoach} className="shrink-0" />
          )}
          {/* Sticky so the taller aside can never scroll Stop out of view; the button itself is unchanged. */}
          <div className="sticky bottom-0 z-10 -mx-1 bg-neutral-950/95 px-1 pt-1 backdrop-blur">
            <StopButton send={send} label={{ ml: "സെറ്റ് നിർത്തുക", en: "Stop the set" }} />
          </div>
        </aside>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:px-4">
        <MediaControls onLeave={onLeave} />
        {onEndForAll && (
          <Button variant="outline" onClick={onEndForAll}
            className="min-h-11 border-rose-500/40 bg-transparent text-rose-300 hover:bg-rose-600 hover:text-white">
            <PowerIcon /> End session for all
          </Button>
        )}
      </footer>
      <ParticipantsAudio participants={unrendered} />
    </div>
  );
};
