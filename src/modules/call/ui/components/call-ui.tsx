"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";
import { StreamTheme, useCall } from "@stream-io/video-react-sdk";

import { useTRPC } from "@/trpc/client";
import { useConfirm } from "@/hooks/use-confirm";

import type { CallInfo } from "../../types";
import { CallLobby } from "./call-lobby";
import { CallActive } from "./call-active";
import { CallEnded } from "./call-ended";

export const CallUI = ({ info }: { info: CallInfo }) => {
  const call = useCall();
  const trpc = useTRPC();
  const [show, setShow] = useState<"lobby" | "call" | "ended">("lobby");
  const end = useMutation(trpc.sessions.end.mutationOptions({ onError: (e) => toast.error(e.message) }));
  const [ConfirmEnd, confirmEnd] = useConfirm(
    "End the session for everyone?",
    "The patient and the coach leave the call. Results recorded so far are kept.",
  );

  const handleJoin = async () => {
    if (!call) return;
    try {
      await call.join();
      setShow("call");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not join the call");
    }
  };

  const handleLeave = () => {
    void call?.leave().catch(() => undefined);
    setShow("ended");
  };

  const handleEndForAll = async () => {
    if (!(await confirmEnd())) return;
    await end.mutateAsync({ id: info.sessionId });
    handleLeave();
  };

  return (
    <StreamTheme className="h-full">
      {info.viewer === "physio" && <ConfirmEnd />}
      {show === "lobby" && <CallLobby info={info} onJoin={handleJoin} />}
      {show === "call" && (
        <CallActive info={info} onLeave={handleLeave} onEndForAll={info.viewer === "physio" ? handleEndForAll : undefined} />
      )}
      {show === "ended" && <CallEnded info={info} />}
    </StreamTheme>
  );
};
