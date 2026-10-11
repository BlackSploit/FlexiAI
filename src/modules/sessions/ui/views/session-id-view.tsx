"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useState } from "react";
import { AlertCircleIcon, ArrowLeftIcon, RotateCwIcon } from "lucide-react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { LIVE_REFETCH_MS } from "@/constants";
import { useConfirm } from "@/hooks/use-confirm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { DoneState } from "../components/done-state";
import { LiveState } from "../components/live-state";
import { FailedState } from "../components/failed-state";
import { SafetyAlerts } from "../components/safety-alerts";
import { PanelEmpty } from "../components/session-panels";
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
  const cancel = useMutation(trpc.sessions.cancel.mutationOptions({
    onSuccess: async () => {
      toast.success("Session cancelled");
      await refresh();
    },
    onError,
  }));
  const end = useMutation(trpc.sessions.end.mutationOptions({
    onSuccess: async () => {
      toast.success("Ending the session…");
      await refresh();
    },
    onError,
  }));
  const restart = useMutation(trpc.sessions.restartAgent.mutationOptions({
    onSuccess: async () => {
      toast.success("The coach is restarting and will resume the session");
      await refresh();
    },
    onError,
  }));
  const ack = useMutation(trpc.sessions.acknowledgeSafety.mutationOptions({
    onSuccess: async () => {
      toast.success("Alert acknowledged");
      await refresh();
    },
    onError,
  }));

  const [CancelConfirm, confirmCancel] = useConfirm("Cancel this session?", "The coach leaves and the patient link stops working.");
  const [EndConfirm, confirmEnd] = useConfirm("End the session for everyone?", "The call ends for the patient and the coach.");
  const [LinkConfirm, confirmLink] = useConfirm("Create a new patient link?", "The previous link stops working immediately.");

  const onNewLink = async () => {
    // Without an active link there is nothing to revoke, so skip the confirm.
    if (data.hasActiveJoinLink && !(await confirmLink())) return;
    newLink.mutate({ id: sessionId });
  };
  const onCancel = async () => (await confirmCancel()) && cancel.mutate({ id: sessionId });
  const onEnd = async () => (await confirmEnd()) && end.mutate({ id: sessionId });
  const onRestart = () => restart.mutate({ id: sessionId });

  return (
    <>
      <CancelConfirm />
      <EndConfirm />
      <LinkConfirm />
      {link && (
        <JoinLinkDialog open onOpenChange={(o) => !o && setLink(null)} sessionId={sessionId} joinUrl={link.joinUrl}
          expiresAt={link.expiresAt} patient={data.patient} />
      )}
      <div className="flex-1 py-6 px-4 md:px-8 flex flex-col gap-y-6 max-w-7xl w-full mx-auto">
        <SessionIdViewHeader data={data} onNewLink={onNewLink} onRestart={onRestart} onEnd={onEnd} onCancel={onCancel} />
        <SafetyAlerts
          events={data.openSafetyEvents}
          onAcknowledge={(id) => ack.mutate({ safetyEventId: id })}
          pendingId={ack.isPending ? ack.variables?.safetyEventId : null}
        />
        {data.status === "scheduled" && (
          <ScheduledState
            sessionId={sessionId}
            agentReady={!!data.agentPid}
            joinTokenExpiresAt={data.joinTokenExpiresAt}
            hasActiveJoinLink={data.hasActiveJoinLink}
            onNewLink={onNewLink}
            onCancel={onCancel}
            isCancelling={cancel.isPending}
            isCreatingLink={newLink.isPending}
          />
        )}
        {data.status === "live" && (
          <LiveState data={data} results={results} onRestart={onRestart} onEnd={onEnd}
            isRestarting={restart.isPending} isEnding={end.isPending} />
        )}
        {data.status === "done" && <DoneState data={data} results={results} />}
        {data.status === "failed" && (
          <FailedState reason={data.failureReason} prescriptionId={data.prescriptionId} patient={data.patient} />
        )}
      </div>
    </>
  );
};

export const SessionIdViewLoading = () => (
  <div className="flex-1 py-6 px-4 md:px-8 flex flex-col gap-y-6 max-w-7xl w-full mx-auto" aria-busy="true" aria-label="Loading session">
    <Skeleton className="h-4 w-28" />
    <div className="flex items-start gap-4">
      <Skeleton className="size-12 rounded-full" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80 max-w-[70vw]" />
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
    </div>
    <Skeleton className="h-72 rounded-xl" />
  </div>
);

export const SessionIdViewError = () => (
  <div className="flex-1 py-6 px-4 md:px-8 max-w-7xl w-full mx-auto">
    <div className="rounded-xl border bg-card shadow-sm">
      <PanelEmpty
        icon={AlertCircleIcon}
        tone="rose"
        title="This session could not be loaded"
        hint="It may have been removed, or the connection dropped. Try again or go back to all sessions."
        action={
          <>
            <Button variant="outline" onClick={() => window.location.reload()}><RotateCwIcon />Try again</Button>
            <Button asChild><Link href="/sessions"><ArrowLeftIcon />All sessions</Link></Button>
          </>
        }
      />
    </div>
  </div>
);
