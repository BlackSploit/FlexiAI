"use client";

import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";
import { useMutation } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";

import { PHASE_LABEL } from "../../strings";
import type { AgentFeed } from "../../hooks/use-agent-events";

const alertText = (a: NonNullable<AgentFeed["alert"]>) =>
  a.reason === "pain" ? `Pain ${a.score}/10 reported` : a.reason === "symptom" ? `Symptom: ${(a.symptom ?? "").replace("_", " ")}`
    : a.reason === "stop" ? "Stop pressed" : "Coach disconnected";

/** What the physio watches live: phase, set, the last rep vs target, every rep so far, and alerts. */
export const PhysioLivePanel = ({ feed, sessionId, targetAngle, onDismiss }: {
  feed: AgentFeed; sessionId: string; targetAngle: number; onDismiss: () => void;
}) => {
  const trpc = useTRPC();
  const restart = useMutation(trpc.sessions.restartAgent.mutationOptions({
    onSuccess: () => toast.success("Restarting the coach"),
    onError: (e) => toast.error(e.message),
  }));
  const r = feed.lastRep;
  return (
    <div className="rounded-lg bg-white text-foreground p-4 flex flex-col gap-y-3">
      {feed.alert && (
        <div className="rounded-md bg-rose-600 text-white p-3 flex flex-col gap-2">
          <p className="font-semibold flex items-center gap-2"><AlertTriangleIcon className="size-4" />{alertText(feed.alert)}</p>
          <div className="flex gap-2">
            {feed.alert.reason === "agent_down" && (
              <Button size="sm" variant="secondary" disabled={restart.isPending} onClick={() => restart.mutate({ id: sessionId })}>
                <RotateCcwIcon /> Restart coach
              </Button>
            )}
            <Button size="sm" variant="secondary" asChild><Link href={`/sessions/${sessionId}`}>Open session</Link></Button>
            <Button size="sm" variant="ghost" className="text-white" onClick={onDismiss}>Dismiss</Button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div><p className="text-muted-foreground">Phase</p><p className="font-medium">{PHASE_LABEL[feed.phase]?.en ?? (feed.ready ? "Ready" : "Connecting")}</p></div>
        <div><p className="text-muted-foreground">Set</p><p className="font-medium">{feed.setIndex || "-"} / {feed.setsPlanned}</p></div>
        <div><p className="text-muted-foreground">Last rep</p>
          <p className={cn("font-medium", r && r.peak < targetAngle - 8 && "text-amber-600")}>{r ? `${Math.round(r.peak)}° of ${targetAngle}°` : "-"}</p></div>
        <div><p className="text-muted-foreground">Tempo</p><p className="font-medium">{r ? `${r.seconds.toFixed(1)} s${r.tooFast ? " (fast)" : ""}` : "-"}</p></div>
      </div>
      {feed.reps.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {feed.reps.map((rep) => (
            <span key={`${rep.setIndex}-${rep.n}`} className={cn("rounded px-1.5 py-0.5 text-xs border",
              rep.peak >= targetAngle - 8 ? "border-emerald-600 text-emerald-700" : "border-amber-500 text-amber-700",
              rep.tooFast && "bg-amber-50")}>
              {rep.n}: {Math.round(rep.peak)}°
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
