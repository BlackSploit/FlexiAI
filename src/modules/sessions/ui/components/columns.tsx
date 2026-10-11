"use client"

import { format } from "date-fns";
import { ColumnDef } from "@tanstack/react-table"
import { ClockIcon, TrophyIcon } from "lucide-react"

import { formatDuration } from "@/lib/utils";
import { GeneratedAvatar } from "@/components/generated-avatar"

import { SessionGetMany } from "../../types"
import { PainBadge } from "./pain-badge";
import { SessionStatusBadge } from "./session-status-badge";

export const sessionDate = (s: { startedAt: string | Date | null; scheduledAt: string | Date }) =>
  new Date(s.startedAt ?? s.scheduledAt);

/** Compact columns for embedded session lists (patient and prescription pages). */
export const columns: ColumnDef<SessionGetMany[number]>[] = [
  {
    accessorKey: "exercise",
    header: "Session",
    cell: ({ row }) => (
      <div className="flex items-center gap-3 min-w-0">
        <GeneratedAvatar variant="initials" seed={row.original.patient.name} className="size-9 shrink-0" />
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium truncate">{row.original.exercise.nameEn}</span>
            {row.original.mode === "replay" && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Demo replay</span>
            )}
          </div>
          <span className="text-xs text-muted-foreground truncate">
            {row.original.patient.name} · {format(sessionDate(row.original), "d MMM yyyy, h:mm a")}
          </span>
        </div>
      </div>
    )
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <SessionStatusBadge status={row.original.status} failureReason={row.original.failureReason} />,
  },
  {
    accessorKey: "bestScore",
    header: "Result",
    cell: ({ row }) => row.original.setCount > 0 ? (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="tabular-nums">
          {row.original.avgPeak !== null ? Math.round(row.original.avgPeak) : "–"}°
          <span className="text-muted-foreground"> / {row.original.prescription.targetAngle}°</span>
        </span>
        {row.original.bestScore !== null && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
            <TrophyIcon className="size-3" aria-hidden />{Math.round(row.original.bestScore)}
          </span>
        )}
        <PainBadge pain={row.original.maxPain} />
      </div>
    ) : <span className="text-sm text-muted-foreground">No sets yet</span>,
  },
  {
    accessorKey: "duration",
    header: "Duration",
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground whitespace-nowrap">
        <ClockIcon className="size-3.5" aria-hidden />
        {row.original.duration ? formatDuration(row.original.duration) : "–"}
      </span>
    ),
  },
];
