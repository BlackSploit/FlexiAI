"use client";

import Link from "next/link";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ActivityIcon, CheckIcon, HandIcon, ShieldCheckIcon, ThermometerIcon, UnplugIcon } from "lucide-react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelEmpty } from "@/modules/dashboard/ui/components/panel-empty";

type Flag = { kind: string; painScore: number | null; symptom: string | null };

const label = (f: Flag) =>
  f.kind === "pain" ? `Pain ${f.painScore}/10`
    : f.kind === "symptom" ? (f.symptom ?? "symptom").replaceAll("_", " ")
      : f.kind === "stop" ? "Stop pressed" : "Coach disconnected";

const icon = (kind: string) =>
  kind === "pain" ? ThermometerIcon : kind === "symptom" ? ActivityIcon : kind === "stop" ? HandIcon : UnplugIcon;

/** Safety events of the last 7 days (pain >= 7, symptoms, stops, agent down) with "Acknowledge". */
export const PainFlagsList = ({ limit }: { limit?: number }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(trpc.analytics.painFlags.queryOptions({ days: 7 }));
  const ack = useMutation(trpc.sessions.acknowledgeSafety.mutationOptions({
    onSuccess: async () => {
      toast.success("Alert acknowledged");
      await queryClient.invalidateQueries(trpc.analytics.painFlags.queryOptions({ days: 7 }));
      await queryClient.invalidateQueries(trpc.analytics.overview.queryOptions());
    },
    onError: (e) => toast.error(e.message),
  }));

  // Open alerts first, newest first within each group.
  const sorted = [...data].sort((a, b) => Number(!!a.acknowledgedAt) - Number(!!b.acknowledgedAt));
  const rows = limit ? sorted.slice(0, limit) : sorted;

  if (rows.length === 0) {
    return (
      <PanelEmpty
        icon={ShieldCheckIcon}
        tone="success"
        title="All clear this week"
        hint="Pain of 7/10 or more, reported symptoms, Stop presses and coach disconnects will show up here."
      />
    );
  }

  return (
    <ul className="flex flex-col divide-y">
      {rows.map((f) => {
        const Icon = icon(f.kind);
        const open = !f.acknowledgedAt;
        const pending = ack.isPending && ack.variables?.safetyEventId === f.id;
        return (
          <li key={f.id} className="flex items-center gap-x-3 py-3 first:pt-0 last:pb-0">
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full",
                open ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-muted text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Link href={`/sessions/${f.sessionId}`} className="truncate text-sm font-medium hover:underline">
                  {f.patient.name}
                </Link>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                    open ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-muted text-muted-foreground",
                  )}
                >
                  {label(f)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(f.at), { addSuffix: true })}
                {f.setIndex ? ` · set ${f.setIndex}` : null}
                {!open && " · acknowledged"}
              </p>
            </div>
            {open ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => ack.mutate({ safetyEventId: f.id })}>
                {pending ? "Saving…" : "Acknowledge"}
              </Button>
            ) : (
              <CheckIcon className="size-4 text-muted-foreground" aria-label="Acknowledged" />
            )}
          </li>
        );
      })}
    </ul>
  );
};

export const PainFlagsListSkeleton = ({ rows = 3 }: { rows?: number }) => (
  <div className="flex flex-col gap-4">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>
    ))}
  </div>
);
