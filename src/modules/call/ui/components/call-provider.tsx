"use client";

import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { authClient } from "@/lib/auth-client";
import { generateAvatarUri } from "@/lib/avatar";

import type { CallInfo } from "../../types";
import { CallConnect, Loading } from "./call-connect";

/** Physio: the Better Auth session identifies the user; the token is a short-lived user token. */
export const PhysioCallProvider = ({ info }: { info: CallInfo }) => {
  const trpc = useTRPC();
  const { data, isPending } = authClient.useSession();
  const { mutateAsync } = useMutation(trpc.sessions.physioToken.mutationOptions());
  const tokenProvider = useCallback(() => mutateAsync(), [mutateAsync]);
  if (!data || isPending) return <Loading />;
  const user = {
    id: data.user.id,
    name: data.user.name,
    image: data.user.image ?? generateAvatarUri({ seed: data.user.name, variant: "initials" }),
  };
  return <CallConnect info={info} user={user} tokenProvider={tokenProvider} />;
};

/** Patient: no account; the signed link mints a token scoped to this one call. */
export const PatientCallProvider = ({ info, user }: { info: CallInfo; user: { id: string; name: string; image: string | null } }) => {
  const trpc = useTRPC();
  const { mutateAsync } = useMutation(trpc.join.streamToken.mutationOptions());
  const token = info.joinToken!;
  const tokenProvider = useCallback(() => mutateAsync({ token }), [mutateAsync, token]);
  return (
    <CallConnect
      info={info}
      user={{ id: user.id, name: user.name, image: user.image ?? generateAvatarUri({ seed: user.name, variant: "initials" }) }}
      tokenProvider={tokenProvider}
    />
  );
};
