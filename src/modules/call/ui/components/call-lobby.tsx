"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeftIcon, CameraOffIcon, LoaderIcon, LogInIcon, MicIcon, MicOffIcon, PersonStandingIcon, RefreshCwIcon,
  ShieldCheckIcon, ShieldAlertIcon, VideoIcon, VideoOffIcon,
} from "lucide-react";
import {
  DefaultVideoPlaceholder,
  StreamVideoParticipant,
  useCallStateHooks,
  useConnectedUser,
  VideoPreview,
} from "@stream-io/video-react-sdk";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { generateAvatarUri } from "@/lib/avatar";

import type { CallInfo } from "../../types";
import { S } from "../../strings";
import { Bi, BrandMark, CallShell } from "./call-brand";

interface Props {
  info: CallInfo;
  onJoin: () => Promise<void>;
};

const DisabledVideoPreview = () => {
  const user = useConnectedUser();
  const name = user?.name ?? "";
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-neutral-900 text-white/70">
      <DefaultVideoPlaceholder
        participant={{ name, image: user?.image ?? generateAvatarUri({ seed: name, variant: "initials" }) } as StreamVideoParticipant}
      />
    </div>
  );
};

const CameraOffPreview = () => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-neutral-900 p-4 text-center text-white/70">
    <CameraOffIcon className="size-8" aria-hidden />
    <span className="text-sm">No camera found</span>
  </div>
);

const PermissionPreview = () => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-neutral-900 p-4 text-center text-white/80">
    <ShieldAlertIcon className="size-8 text-amber-400" aria-hidden />
    <Bi t={S.permTitle} className="items-center gap-1 text-sm" mlClassName="text-base" />
  </div>
);

/** Big, labelled device toggle — clearer than icon-only buttons for older patients. */
const DeviceToggle = ({ on, onClick, pending, iconOn: IconOn, iconOff: IconOff, label, bilingual }: {
  on: boolean; onClick: () => void; pending?: boolean;
  iconOn: typeof MicIcon; iconOff: typeof MicIcon; label: { ml: string; en: string }; bilingual: boolean;
}) => {
  const Icon = on ? IconOn : IconOff;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={on}
      aria-label={`${label.en} ${on ? "on" : "off"}`}
      className={cn(
        "flex min-h-14 flex-1 items-center justify-center gap-3 rounded-xl border px-3 text-left transition-colors",
        "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60",
        on ? "border-border bg-background hover:bg-muted" : "border-rose-500/40 bg-rose-500/10 text-rose-700 hover:bg-rose-500/15 dark:text-rose-300",
      )}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full",
        on ? "bg-primary/10 text-primary" : "bg-rose-500/15")}>
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        {bilingual ? (
          <>
            <span lang="ml" className="font-ml text-sm font-medium">{label.ml} · {on ? S.on.ml : S.off.ml}</span>
            <span className="text-xs text-muted-foreground">{label.en} {on ? "on" : "off"}</span>
          </>
        ) : (
          <>
            <span className="text-sm font-medium">{label.en}</span>
            <span className="text-xs text-muted-foreground">{on ? "On" : "Off"}</span>
          </>
        )}
      </span>
    </button>
  );
};

export const CallLobby = ({ info, onJoin }: Props) => {
  const { useCameraState, useMicrophoneState } = useCallStateHooks();
  const mic = useMicrophoneState();
  const cam = useCameraState();
  const [joining, setJoining] = useState(false);
  const isPatient = info.viewer === "patient";
  const tip = info.exercise.cameraView === "front" ? S.placementFront : S.placementSide;
  const permissionDenied = (!cam.hasBrowserPermission || !mic.hasBrowserPermission)
    && !cam.isPromptingPermission && !mic.isPromptingPermission;

  const join = async () => {
    setJoining(true);
    try { await onJoin(); } finally { setJoining(false); }
  };

  return (
    <CallShell className="h-full overflow-y-auto">
      <header className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-6">
        <BrandMark />
        {!isPatient && (
          <Button asChild variant="ghost" size="sm" className="text-white/80 hover:bg-white/10 hover:text-white">
            <Link href={`/sessions/${info.sessionId}`}><ArrowLeftIcon /> Back to session</Link>
          </Button>
        )}
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-5 sm:items-center sm:px-6">
        <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xl">
          {/* Title */}
          <div className="flex flex-col gap-1 border-b px-5 py-4 sm:px-6">
            <p className="text-xs font-medium uppercase tracking-wider text-primary">
              {isPatient ? <><span lang="ml" className="font-ml normal-case tracking-normal">{S.todaysExercise.ml}</span> · {S.todaysExercise.en}</> : "Guided session"}
            </p>
            {isPatient ? (
              <h1 className="flex flex-col gap-0.5">
                <span lang="ml" className="font-ml text-2xl font-semibold leading-snug">{info.exercise.nameMl}</span>
                <span className="text-base text-muted-foreground">{info.exercise.nameEn}</span>
              </h1>
            ) : (
              <h1 className="text-2xl font-semibold tracking-tight">{info.label}</h1>
            )}
            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
                {info.prescription.sets} × {info.prescription.reps} {isPatient ? <span lang="ml" className="font-ml">{S.reps.ml}</span> : "reps"}
              </span>
              <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">Target {info.prescription.targetAngle}°</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-700 dark:text-emerald-300">
                <ShieldCheckIcon className="size-3.5" aria-hidden />
                {isPatient ? <span lang="ml" className="font-ml">{S.noVideoStored.ml}</span> : "No recording"}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-4 p-5 sm:p-6">
            {/* Preview */}
            <div className={cn(
              "relative w-full overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-black/5",
              isPatient ? "aspect-[4/3] sm:aspect-video" : "aspect-video",
              "[&_.str-video__video-preview-container]:!h-full [&_.str-video__video-preview-container]:!w-full [&_.str-video__video-preview-container]:!max-w-none [&_.str-video__video-preview-container]:!rounded-none",
              "[&_video]:!h-full [&_video]:!w-full [&_video]:!object-cover [&_.str-video__video-placeholder]:!aspect-auto",
            )}>
              <VideoPreview
                DisabledVideoPreview={permissionDenied ? PermissionPreview : DisabledVideoPreview}
                NoCameraPreview={CameraOffPreview}
              />
            </div>

            {/* Device toggles */}
            <div className="flex flex-col gap-2 min-[400px]:flex-row">
              <DeviceToggle
                on={!mic.optimisticIsMute} pending={mic.isTogglePending} onClick={() => void mic.microphone.toggle()}
                iconOn={MicIcon} iconOff={MicOffIcon} label={S.mic} bilingual={isPatient}
              />
              <DeviceToggle
                on={!cam.optimisticIsMute} pending={cam.isTogglePending} onClick={() => void cam.camera.toggle()}
                iconOn={VideoIcon} iconOff={VideoOffIcon} label={S.camera} bilingual={isPatient}
              />
            </div>

            {/* Permission guidance */}
            {permissionDenied && (
              <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                <div className="flex gap-3">
                  <ShieldAlertIcon className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
                  <div className="flex flex-col gap-1">
                    <p className="font-semibold"><Bi t={S.permTitle} mlClassName="text-base" /></p>
                    <p lang="ml" className="font-ml">{S.permBody.ml}</p>
                    <p className="text-muted-foreground">{S.permBody.en}</p>
                  </div>
                </div>
                <Button variant="outline" className="min-h-11 self-start" onClick={() => window.location.reload()}>
                  <RefreshCwIcon /> <span lang="ml" className="font-ml">{S.tryAgain.ml}</span> · {S.tryAgain.en}
                </Button>
              </div>
            )}

            {/* Placement tip */}
            {isPatient && (
              <div className="flex gap-4 rounded-xl bg-muted/60 p-4">
                <span className="relative flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <PersonStandingIcon className={cn("size-8", info.exercise.cameraView !== "front" && "-scale-x-100")} aria-hidden />
                  <span className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-card text-primary shadow-sm ring-1 ring-border">
                    <VideoIcon className="size-3.5" aria-hidden />
                  </span>
                </span>
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <p className="font-semibold"><span lang="ml" className="font-ml">{S.placementTitle.ml}</span> <span className="font-normal text-muted-foreground">· {S.placementTitle.en}</span></p>
                  <p lang="ml" className="font-ml text-base leading-relaxed">{tip.ml}</p>
                  <p className="text-muted-foreground">{tip.en}</p>
                  {(info.exercise.howToMl || info.exercise.howToEn) && (
                    <div className="mt-2 border-t pt-2">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        <span lang="ml" className="font-ml normal-case tracking-normal">{S.howTo.ml}</span> · {S.howTo.en}
                      </p>
                      {info.exercise.howToMl && <p lang="ml" className="font-ml mt-1 leading-relaxed">{info.exercise.howToMl}</p>}
                      {info.exercise.howToEn && info.patientLang === "en" && <p className="mt-1 text-muted-foreground">{info.exercise.howToEn}</p>}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Join */}
            {isPatient ? (
              <Button size="lg" className="min-h-16 w-full rounded-xl text-lg font-semibold shadow-md" disabled={joining} onClick={join}>
                {joining ? <LoaderIcon className="size-6 animate-spin" /> : <LogInIcon className="size-6" />}
                <span lang="ml" className="font-ml">{S.join.ml}</span>
                <span className="font-normal opacity-80">· {S.join.en}</span>
              </Button>
            ) : (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button asChild variant="ghost"><Link href={`/sessions/${info.sessionId}`}>Cancel</Link></Button>
                <Button size="lg" disabled={joining} onClick={join}>
                  {joining ? <LoaderIcon className="animate-spin" /> : <LogInIcon />}
                  Join call
                </Button>
              </div>
            )}
          </div>
        </div>
      </main>
    </CallShell>
  );
};
