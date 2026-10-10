"use client"

import { ColumnDef } from "@tanstack/react-table"

import { Badge } from "@/components/ui/badge"
import { GeneratedAvatar } from "@/components/generated-avatar"

import { PrescriptionsGetMany } from "../../types"
import { StartSessionButton } from "./start-session-button"

export const columns: ColumnDef<PrescriptionsGetMany[number]>[] = [
  {
    accessorKey: "patient",
    header: "Patient",
    cell: ({ row }) => (
      <div className="flex items-center gap-x-2">
        <GeneratedAvatar variant="initials" seed={row.original.patient.name} className="size-6" />
        <span className="font-semibold">{row.original.patient.name}</span>
      </div>
    ),
  },
  {
    accessorKey: "exercise",
    header: "Exercise",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span>{row.original.exercise.nameEn}</span>
        <span lang="ml" className="font-ml text-xs text-muted-foreground">{row.original.exercise.nameMl}</span>
      </div>
    ),
  },
  {
    accessorKey: "targetAngle",
    header: "Plan",
    cell: ({ row }) => (
      <span className="text-sm">
        {row.original.targetAngle}° · {row.original.reps} × {row.original.sets} · ≥{row.original.minSecondsPerRep}s
      </span>
    ),
  },
  {
    accessorKey: "active",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={row.original.active ? "default" : "outline"}>{row.original.active ? "Active" : "Inactive"}</Badge>
    ),
  },
  {
    id: "start",
    header: "",
    cell: ({ row }) => row.original.active ? (
      <StartSessionButton size="sm" label="Start" prescriptionId={row.original.id} patient={row.original.patient} />
    ) : null,
  },
]
