"use client";

import { toast } from "sonner";
import { useState } from "react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { LIVE_REFETCH_MS } from "@/constants";
import { useConfirm } from "@/hooks/use-confirm";
import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";

import { DoneState } from "../components/done-state";
import { LiveState } from "../components/live-state";
import { FailedState } from "../components/failed-state";
import { JoinLinkDialog } from "../components/join-link-dialog";
import { ScheduledState } from "../components/scheduled-state";
import { SessionIdViewHeader } from "../components/session-id-view-header";

const isOpen = (status?: string) => status === "scheduled" || status === "live";

export const SessionIdView = ({ sessionId }: { sessionId: string }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [link, setLink] = useState<{ joinUrl: string; expiresAt: Date | string } | null>(null);

  const { data } = useSuspenseQuery(trpc.sessions.getOne.queryOptions({ id: sessionId }, {
    refetchInterval: (q) => (isOpen(q.state.data?.status) ? LIVE_REFETCH_MS : false),
  }));
  const { data: results } = useSuspenseQuery(trpc.sessions.getResults.queryOptions({ id: sessionId }, {
    refetchInterval: () => (isOpen(data.status) ? LIVE_REFETCH_MS : false),
  }));

  const refresh = async () => {
    await queryClient.invalidateQueries(trpc.sessions.getOne.queryOptions({ id: sessionId }));
    await queryClient.invalidateQueries(trpc.sessions.getMany.queryOptions({}));
  };
  const onError = (e: { message: string }) => toast.error(e.message);

  const newLink = useMutation(trpc.sessions.regenerateJoinLink.mutationOptions({
    onSuccess: async (res) => {
      setLink(res);
      await refresh();
    },
    onError,
  }));
  const cancel = useMutation(trpc.sessions.cancel.mutationOptions({ onSuccess: refresh, onError }));
  const end = useMutation(trpc.sessions.end.mutationOptions({ onSuccess: refresh, onError }));
  const restart = useMutation(trpc.sessions.restartAgent.mutationOptions({
    onSuccess: async () => {
      toast.success("The coach is restarting and will resume the session");
      await refresh();
    },
    onError,
  }));
  const ack = useMutation(trpc.sessions.acknowledgeSafety.mutationOptions({ onSuccess: refresh, onError }));

  const [CancelConfirm, confirmCancel] = useConfirm("Cancel this session?", "The coach leaves and the patient link stops working.");
  const [EndConfirm, confirmEnd] = useConfirm("End the session for everyone?", "The call ends for the patient and the coach.");
  const [LinkConfirm, confirmLink] = useConfirm("Create a new patient link?", "The previous link stops working immediately.");

  return (
    <>
      <CancelConfirm />
      <EndConfirm />
      <LinkConfirm />
      {link && (
        <JoinLinkDialog open onOpenChange={(o) => !o && setLink(null)} sessionId={sessionId} joinUrl={link.joinUrl}
          expiresAt={link.expiresAt} patient={data.patient} />
      )}
      <div className="flex-1 py-4 px-4 md:px-8 flex flex-col gap-y-4">
        <SessionIdViewHeader
          sessionId={sessionId}
          title={`${data.exercise.nameEn} · ${data.patient.name}`}
          status={data.status}
          onNewLink={async () => (await confirmLink()) && newLink.mutate({ id: sessionId })}
          onRestart={() => restart.mutate({ id: sessionId })}
          onEnd={async () => (await confirmEnd()) && end.mutate({ id: sessionId })}
          onCancel={async () => (await confirmCancel()) && cancel.mutate({ id: sessionId })}
        />
        {data.status === "scheduled" && (
          <ScheduledState
            sessionId={sessionId}
            agentReady={!!data.agentPid}
            joinTokenExpiresAt={data.joinTokenExpiresAt}
            hasActiveJoinLink={data.hasActiveJoinLink}
            onNewLink={async () => (await confirmLink()) && newLink.mutate({ id: sessionId })}
            onCancel={async () => (await confirmCancel()) && cancel.mutate({ id: sessionId })}
            isCancelling={cancel.isPending}
          />
        )}
        {data.status === "live" && <LiveState data={data} results={results} onAcknowledge={(id) => ack.mutate({ safetyEventId: id })} />}
        {data.status === "done" && <DoneState data={data} results={results} />}
        {data.status === "failed" && <FailedState reason={data.failureReason} />}
      </div>
    </>
  );
};

export const SessionIdViewLoading = () => (
  <LoadingState title="Loading Session" description="This may take a few seconds" />
);

export const SessionIdViewError = () => (
  <ErrorState title="Error Loading Session" description="Please try again later" />
);
