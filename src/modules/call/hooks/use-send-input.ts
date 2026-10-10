"use client";

import { nanoid } from "nanoid";
import { useCallback } from "react";
import { useCall } from "@stream-io/video-react-sdk";
import { useMutation } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";

import type { ClientToAgentEvent } from "../contracts";

type Opts = { viewer: "patient"; joinToken: string } | { viewer: "physio"; sessionId: string };
type Input = ClientToAgentEvent extends infer E ? E extends ClientToAgentEvent ? Omit<E, "v" | "eventId" | "ts"> : never : never;

/**
 * Every input goes out twice (§7.8): a Stream custom event (primary, low latency) and the backup tRPC path,
 * which also writes the safety row at once so the physio is alerted even if the agent is down.
 */
export function useSendInput(opts: Opts) {
  const call = useCall();
  const trpc = useTRPC();
  const { mutateAsync: patientBackup } = useMutation(trpc.join.sendInput.mutationOptions());
  const { mutateAsync: physioBackup } = useMutation(trpc.sessions.sendInput.mutationOptions());
  const viewer = opts.viewer;
  const key = opts.viewer === "patient" ? opts.joinToken : opts.sessionId;

  return useCallback(async (input: Input) => {
    const full = { ...input, v: 1, eventId: nanoid(), ts: Date.now() } as ClientToAgentEvent;
    await Promise.allSettled([
      call?.sendCustomEvent(full),
      viewer === "patient"
        ? patientBackup({ token: key, event: full })
        : physioBackup({ id: key, event: full }),
    ]);
    return full.eventId;
  }, [call, viewer, key, patientBackup, physioBackup]);
}
