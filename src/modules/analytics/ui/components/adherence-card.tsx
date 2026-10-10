"use client";

import Link from "next/link";
import { useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { Progress } from "@/components/ui/progress";
import { GeneratedAvatar } from "@/components/generated-avatar";

import { includeReplay } from "./rom-trend-chart";

/** This week's adherence per patient: done / planned (Σ sessionsPerWeek of active prescriptions). */
export const AdherenceCard = () => {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.analytics.adherence.queryOptions({ includeReplay }));

  if (data.length === 0) return <p className="text-sm text-muted-foreground">No patients yet.</p>;
  return (
    <ul className="flex flex-col gap-y-3">
      {data.map((row) => (
        <li key={row.patientId}>
          <Link href={`/patients/${row.patientId}`} className="flex items-center gap-x-3 hover:bg-muted/50 rounded-md p-1">
            <GeneratedAvatar seed={row.name} variant="initials" className="size-7" />
            <div className="flex-1 min-w-0">
              <div className="flex justify-between text-sm">
                <span className="truncate">{row.name}</span>
                <span className="text-muted-foreground">{row.done}/{row.planned}</span>
              </div>
              <Progress value={row.pct} className="h-1.5 mt-1" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
};
