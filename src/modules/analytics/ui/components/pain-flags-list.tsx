"use client";

import Link from "next/link";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangleIcon } from "lucide-react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const label = (f: { kind: string; painScore: number | null; symptom: string | null }) =>
  f.kind === "pain" ? `Pain ${f.painScore}/10`
    : f.kind === "symptom" ? (f.symptom ?? "symptom").replace("_", " ")
      : f.kind === "stop" ? "Stop pressed" : "Coach disconnected";

/** Safety events of the last 7 days (pain >= 7, symptoms, stops, agent down) with "Acknowledge". */
export const PainFlagsList = ({ limit }: { limit?: number }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(trpc.analytics.painFlags.queryOptions({ days: 7 }));
  const ack = useMutation(trpc.sessions.acknowledgeSafety.mutationOptions({
    onSuccess: async () => {
      await queryClient.invalidateQueries(trpc.analytics.painFlags.queryOptions({ days: 7 }));
      await queryClient.invalidateQueries(trpc.analytics.overview.queryOptions());
    },
    onError: (e) => toast.error(e.message),
  }));

  const rows = limit ? data.slice(0, limit) : data;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No safety alerts in the last 7 days.</p>;
  return (
    <ul className="flex flex-col divide-y">
      {rows.map((f) => (
        <li key={f.id} className="flex items-center gap-x-3 py-2">
          <AlertTriangleIcon className={f.acknowledgedAt ? "size-4 text-muted-foreground" : "size-4 text-rose-600"} />
          <div className="flex-1 min-w-0">
            <Link href={`/sessions/${f.sessionId}`} className="text-sm font-medium hover:underline">{f.patient.name}</Link>
            <div className="flex items-center gap-x-2 text-xs text-muted-foreground">
              <Badge variant={f.acknowledgedAt ? "outline" : "destructive"} className="capitalize">{label(f)}</Badge>
              {formatDistanceToNow(new Date(f.at), { addSuffix: true })}
            </div>
          </div>
          {!f.acknowledgedAt && (
            <Button size="sm" variant="outline" disabled={ack.isPending} onClick={() => ack.mutate({ safetyEventId: f.id })}>
              Acknowledge
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
};
