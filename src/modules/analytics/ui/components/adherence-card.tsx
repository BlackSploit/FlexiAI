"use client";

import Link from "next/link";
import { CalendarCheckIcon } from "lucide-react";
import { useSuspenseQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { PanelEmpty } from "@/modules/dashboard/ui/components/panel-empty";

import { includeReplay } from "./rom-trend-chart";

const tone = (pct: number, planned: number) =>
  planned === 0 ? "muted" : pct >= 80 ? "good" : pct >= 50 ? "ok" : "low";

const barClass = {
  muted: "[&>[data-slot=progress-indicator]]:bg-muted-foreground/30",
  good: "[&>[data-slot=progress-indicator]]:bg-emerald-500",
  ok: "[&>[data-slot=progress-indicator]]:bg-primary",
  low: "[&>[data-slot=progress-indicator]]:bg-amber-500",
} as const;

const textClass = {
  muted: "text-muted-foreground",
  good: "text-emerald-700 dark:text-emerald-400",
  ok: "text-foreground",
  low: "text-amber-700 dark:text-amber-400",
} as const;

/** This week's adherence per patient: done / planned (Σ sessionsPerWeek of active prescriptions). */
export const AdherenceCard = ({ limit }: { limit?: number }) => {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.analytics.adherence.queryOptions({ includeReplay }));

  if (data.length === 0) {
    return (
      <PanelEmpty
        icon={CalendarCheckIcon}
        title="No patients yet"
        hint="Once a patient has an active prescription, you'll see how many of this week's sessions they've done."
      />
    );
  }

  // Least adherent first so the physio sees who needs a nudge.
  const sorted = [...data].sort((a, b) =>
    (a.planned === 0 ? 1 : 0) - (b.planned === 0 ? 1 : 0) || a.pct - b.pct);
  const rows = limit ? sorted.slice(0, limit) : sorted;

  return (
    <ul className="flex flex-col gap-y-1">
      {rows.map((row) => {
        const t = tone(row.pct, row.planned);
        return (
          <li key={row.patientId}>
            <Link
              href={`/patients/${row.patientId}`}
              className="flex items-center gap-x-3 rounded-lg p-2 -mx-2 transition-colors hover:bg-muted/60 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <GeneratedAvatar seed={row.name} variant="initials" className="size-8" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{row.name}</span>
                  <span className={cn("shrink-0 tabular-nums text-xs font-medium", textClass[t])}>
                    {row.planned === 0 ? "No active plan" : `${row.done}/${row.planned} · ${row.pct}%`}
                  </span>
                </div>
                <Progress
                  value={row.planned === 0 ? 0 : row.pct}
                  className={cn("mt-1.5 h-1.5", barClass[t])}
                  aria-label={`${row.name}: ${row.done} of ${row.planned} sessions this week`}
                />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
};

export const AdherenceCardSkeleton = ({ rows = 4 }: { rows?: number }) => (
  <div className="flex flex-col gap-4">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-3">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-1.5 w-full" />
        </div>
      </div>
    ))}
  </div>
);
