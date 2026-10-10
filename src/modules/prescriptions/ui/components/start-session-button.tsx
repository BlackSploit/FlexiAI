"use client";

import { toast } from "sonner";
import { useState } from "react";
import { PlayIcon } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { JoinLinkDialog } from "@/modules/sessions/ui/components/join-link-dialog";

interface Props {
  prescriptionId: string;
  patient: { name: string; phone?: string | null; email?: string | null };
  mode?: "live" | "replay";
  clip?: string;
  size?: "sm" | "default" | "lg";
  label?: string;
}

/** sessions.start -> JoinLinkDialog. Disabled while pending (the mutation is not idempotent per click). */
export const StartSessionButton = ({ prescriptionId, patient, mode = "live", clip, size = "default", label }: Props) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [link, setLink] = useState<{ sessionId: string; joinUrl: string; expiresAt: Date | string | null } | null>(null);

  const start = useMutation(trpc.sessions.start.mutationOptions({
    onSuccess: async (data) => {
      setLink({ sessionId: data.session.id, joinUrl: data.joinUrl, expiresAt: data.session.joinTokenExpiresAt });
      await queryClient.invalidateQueries(trpc.sessions.getMany.queryOptions({}));
    },
    onError: (e) => toast.error(e.message),
  }));

  return (
    <>
      {link && (
        <JoinLinkDialog open={!!link} onOpenChange={(o) => !o && setLink(null)} sessionId={link.sessionId}
          joinUrl={link.joinUrl} expiresAt={link.expiresAt} patient={patient} />
      )}
      <Button size={size} variant={mode === "replay" ? "outline" : "default"} disabled={start.isPending}
        onClick={(e) => {
          e.stopPropagation();
          start.mutate({ prescriptionId, mode, clip });
        }}>
        <PlayIcon />
        {start.isPending ? "Starting coach…" : label ?? (mode === "replay" ? "Start replay (demo)" : "Start guided session")}
      </Button>
    </>
  );
};
