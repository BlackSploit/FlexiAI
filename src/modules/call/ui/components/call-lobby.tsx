"use client";

import Link from "next/link";
import { useState } from "react";
import { LoaderIcon, LogInIcon } from "lucide-react";
import {
  DefaultVideoPlaceholder,
  StreamVideoParticipant,
  ToggleAudioPreviewButton,
  ToggleVideoPreviewButton,
  useCallStateHooks,
  useConnectedUser,
  VideoPreview,
} from "@stream-io/video-react-sdk";

import { Button } from "@/components/ui/button";
import { generateAvatarUri } from "@/lib/avatar";

import type { CallInfo } from "../../types";
import { S } from "../../strings";

interface Props {
  info: CallInfo;
  onJoin: () => Promise<void>;
};

const DisabledVideoPreview = () => {
  const user = useConnectedUser();
  const name = user?.name ?? "";
  return (
    <DefaultVideoPlaceholder
      participant={{ name, image: user?.image ?? generateAvatarUri({ seed: name, variant: "initials" }) } as StreamVideoParticipant}
    />
  );
};

const AllowBrowserPermissions = () => (
  <p className="text-sm text-center px-4">
    <span lang="ml" className="font-ml block">ക്യാമറയും മൈക്കും ഉപയോഗിക്കാൻ ബ്രൗസറിന് അനുമതി നൽകുക.</span>
    Please allow camera and microphone access in your browser.
  </p>
);

export const CallLobby = ({ info, onJoin }: Props) => {
  const { useCameraState, useMicrophoneState } = useCallStateHooks();
  const { hasBrowserPermission: hasMicPermission } = useMicrophoneState();
  const { hasBrowserPermission: hasCameraPermission } = useCameraState();
  const [joining, setJoining] = useState(false);
  const isPatient = info.viewer === "patient";
  const tip = info.exercise.cameraView === "front" ? S.placementFront : S.placementSide;

  return (
    <div className="flex flex-col items-center justify-center h-full bg-radial from-sidebar-accent to-sidebar overflow-y-auto">
      <div className="py-4 px-4 md:px-8 flex flex-1 items-center justify-center w-full">
        <div className="flex flex-col items-center justify-center gap-y-5 bg-background rounded-lg p-6 md:p-10 shadow-sm w-full max-w-lg">
          <div className="flex flex-col gap-y-1 text-center">
            <h6 className="text-lg font-medium">
              {isPatient ? <><span lang="ml" className="font-ml block">{S.readyToJoin.ml}</span>{S.readyToJoin.en}</> : "Ready to join?"}
            </h6>
            <p className="text-sm text-muted-foreground">
              {isPatient ? <span lang="ml" className="font-ml">{info.exercise.nameMl}</span> : info.label}
              {" · "}{info.exercise.nameEn}
            </p>
          </div>
          <VideoPreview DisabledVideoPreview={hasCameraPermission && hasMicPermission ? DisabledVideoPreview : AllowBrowserPermissions} />
          <div className="flex gap-x-2">
            <ToggleAudioPreviewButton />
            <ToggleVideoPreviewButton />
          </div>
          {isPatient && (
            <div className="rounded-md bg-muted p-3 text-sm w-full">
              <p lang="ml" className="font-ml">{tip.ml}</p>
              <p className="text-muted-foreground">{tip.en}</p>
              {info.exercise.howToMl && <p lang="ml" className="font-ml mt-2">{info.exercise.howToMl}</p>}
            </div>
          )}
          <div className="flex gap-x-2 justify-between w-full">
            {!isPatient ? (
              <Button asChild variant="ghost"><Link href={`/sessions/${info.sessionId}`}>Cancel</Link></Button>
            ) : <span />}
            <Button size={isPatient ? "lg" : "default"} disabled={joining}
              onClick={async () => {
                setJoining(true);
                try { await onJoin(); } finally { setJoining(false); }
              }}>
              {joining ? <LoaderIcon className="animate-spin" /> : <LogInIcon />}
              {isPatient ? <><span lang="ml" className="font-ml">{S.join.ml}</span> · {S.join.en}</> : "Join call"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
