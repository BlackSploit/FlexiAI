"use client"

import { formatDistanceToNow } from "date-fns"
import { ColumnDef } from "@tanstack/react-table"
import { TargetIcon } from "lucide-react"

import { GeneratedAvatar } from "@/components/generated-avatar"
import { ActiveBadge } from "@/modules/patients/ui/components/ui-kit"

import { PrescriptionsGetMany } from "../../types"
import { StartSessionButton } from "./start-session-button"

export const columns: ColumnDef<PrescriptionsGetMany[number]>[] = [
  {
    accessorKey: "exercise",
    header: "Exercise",
    cell: ({ row }) => (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium">{row.original.exercise.nameEn}</span>
        <span lang="ml" className="font-ml truncate text-xs text-muted-foreground">{row.original.exercise.nameMl}</span>
        <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground sm:hidden">
          <GeneratedAvatar variant="initials" seed={row.original.patient.name} className="size-4" />
          {row.original.patient.name}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "patient",
    header: "Patient",
    meta: { className: "hidden sm:table-cell" },
    cell: ({ row }) => (
      <div className="flex items-center gap-2 min-w-0">
        <GeneratedAvatar variant="initials" seed={row.original.patient.name} className="size-7 border" />
        <span className="truncate">{row.original.patient.name}</span>
      </div>
    ),
  },
  {
    accessorKey: "targetAngle",
    header: "Plan",
    meta: { className: "hidden md:table-cell" },
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1 text-sm font-medium tabular-nums">
          <TargetIcon className="size-3.5 text-primary" aria-hidden />
          {row.original.targetAngle}°
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {row.original.reps} × {row.original.sets} · ≥{row.original.minSecondsPerRep}s/rep
        </span>
      </div>
    ),
  },
  {
    accessorKey: "active",
    header: "Status",
    cell: ({ row }) => (
      <div className="flex flex-col items-start gap-1">
        <ActiveBadge active={row.original.active} />
        <span className="hidden text-xs text-muted-foreground lg:block">
          {row.original.sessionCount > 0
            ? `${row.original.sessionCount} ${row.original.sessionCount === 1 ? "session" : "sessions"}${row.original.lastScore !== null ? ` · last ${Math.round(row.original.lastScore)}/100` : ""}`
            : `Added ${formatDistanceToNow(new Date(row.original.createdAt), { addSuffix: true })}`}
        </span>
      </div>
    ),
  },
  {
    id: "start",
    header: () => <span className="sr-only">Start session</span>,
    meta: { className: "text-right" },
    cell: ({ row }) => row.original.active ? (
      <StartSessionButton size="sm" label="Start" prescriptionId={row.original.id} patient={row.original.patient} />
    ) : null,
  },
]
