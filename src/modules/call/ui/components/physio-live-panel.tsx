"use client";

import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangleIcon, ExternalLinkIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useMutation } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";

import { PHASE_LABEL } from "../../strings";
import type { AgentFeed } from "../../hooks/use-agent-events";

const alertText = (a: NonNullable<AgentFeed["alert"]>) =>
  a.reason === "pain" ? `Pain ${a.score}/10 reported` : a.reason === "symptom" ? `Symptom reported: ${(a.symptom ?? "").replace("_", " ")}`
    : a.reason === "stop" ? "Patient pressed Stop" : "Coach disconnected";

const alertHint = (a: NonNullable<AgentFeed["alert"]>) =>
  a.reason === "agent_down" ? "The patient can still see and hear you. Restart the coach to resume counting."
    : "The set has been stopped. Check in with the patient before continuing.";

const Stat = ({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "warn" | "ok" }) => (
  <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border bg-background/60 p-3">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className={cn("truncate text-2xl font-semibold tabular-nums tracking-tight",
      tone === "warn" && "text-amber-600", tone === "ok" && "text-emerald-600")}>{value}</span>
    {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
  </div>
);

/** What the physio watches live: phase, set, the last rep vs target, every rep so far, and alerts. */
export const PhysioLivePanel = ({ feed, sessionId, targetAngle, repsPlanned, agentPresent = true, onDismiss }: {
  feed: AgentFeed; sessionId: string; targetAngle: number; repsPlanned?: number; agentPresent?: boolean; onDismiss: () => void;
}) => {
  const trpc = useTRPC();
  const restart = useMutation(trpc.sessions.restartAgent.mutationOptions({
    onSuccess: () => toast.success("Restarting the coach"),
    onError: (e) => toast.error(e.message),
  }));
  const r = feed.lastRep;
  const short = !!r && r.peak < targetAngle - 8;
  const phase = PHASE_LABEL[feed.phase]?.en ?? (feed.ready ? "Ready" : "Connecting");
  const live = feed.phase === "set";
  const coachMissing = !agentPresent || feed.alert?.reason === "agent_down";
  const goodReps = feed.reps.filter((rep) => rep.peak >= targetAngle - 8 && !rep.tooFast).length;

  return (
    <section aria-label="Live session" className="flex flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Live results</h2>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
          live ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : feed.phase === "halted" ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
              : feed.phase === "await_pain" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "bg-muted text-muted-foreground")}>
          {live && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" /><span className="relative inline-flex size-2 rounded-full bg-emerald-500" /></span>}
          {phase}
        </span>
      </div>

      {feed.alert && (
        <div role="alert" className="flex flex-col gap-3 rounded-lg bg-rose-600 p-3 text-white shadow-md animate-in fade-in slide-in-from-top-2">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="font-semibold">{alertText(feed.alert)}</p>
              <p className="text-sm text-white/85">{alertHint(feed.alert)}</p>
            </div>
            <button type="button" aria-label="Dismiss alert" onClick={onDismiss}
              className="rounded-md p-1 text-white/80 outline-none hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white">
              <XIcon className="size-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {feed.alert.reason === "agent_down" && (
              <Button size="sm" variant="secondary" disabled={restart.isPending} onClick={() => restart.mutate({ id: sessionId })}>
                <RotateCcwIcon className={cn(restart.isPending && "animate-spin")} /> Restart coach
              </Button>
            )}
            <Button size="sm" variant="secondary" asChild>
              <Link href={`/sessions/${sessionId}`} target="_blank" rel="noopener"><ExternalLinkIcon /> Open session</Link>
            </Button>
          </div>
        </div>
      )}

      {coachMissing && feed.alert?.reason !== "agent_down" && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <span className="text-amber-800 dark:text-amber-200">Coach not in the call yet.</span>
          <Button size="sm" variant="outline" disabled={restart.isPending} onClick={() => restart.mutate({ id: sessionId })}>
            <RotateCcwIcon className={cn(restart.isPending && "animate-spin")} /> Restart coach
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Reps this set" value={<>{r?.n ?? 0}<span className="text-base font-medium text-muted-foreground"> / {r?.repsPlanned ?? repsPlanned ?? "-"}</span></>}
          hint={feed.reps.length ? `${goodReps} on target` : "Waiting for first rep"} />
        <Stat label="Set" value={<>{feed.setIndex || "-"}<span className="text-base font-medium text-muted-foreground"> / {feed.setsPlanned}</span></>} hint={phase} />
        <Stat label="Last peak" value={r ? `${Math.round(r.peak)}°` : "-"} hint={`Target ${targetAngle}°`} tone={r ? (short ? "warn" : "ok") : undefined} />
        <Stat label="Tempo" value={r ? `${r.seconds.toFixed(1)}s` : "-"} hint={r ? (r.tooFast ? "Too fast" : "Controlled") : "Per rep"} tone={r?.tooFast ? "warn" : undefined} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Reps so far</span>
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-500" />on target</span>
            <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-amber-500" />short / fast</span>
          </span>
        </div>
        {feed.reps.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {feed.reps.map((rep) => {
              const ok = rep.peak >= targetAngle - 8 && !rep.tooFast;
              return (
                <span key={`${rep.setIndex}-${rep.n}`} title={`Rep ${rep.n}: ${Math.round(rep.peak)}°, ${rep.seconds.toFixed(1)}s${rep.tooFast ? " (fast)" : ""}`}
                  className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium tabular-nums animate-in zoom-in-75 fade-in",
                    ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300")}>
                  <span className="text-muted-foreground">#{rep.n}</span>{Math.round(rep.peak)}°
                </span>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">Reps appear here as the coach counts them.</p>
        )}
      </div>
    </section>
  );
};
