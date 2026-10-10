"use client"

import { format } from "date-fns"
import { ColumnDef } from "@tanstack/react-table"
import { ClipboardListIcon, CornerDownRightIcon, VideoIcon } from "lucide-react"

import { PAIN_ALERT_THRESHOLD } from "@/constants"
import { Badge } from "@/components/ui/badge"
import { GeneratedAvatar } from "@/components/generated-avatar"

import { PatientsGetMany } from "../../types"

export const columns: ColumnDef<PatientsGetMany[number]>[] = [
  {
    accessorKey: "name",
    header: "Patient",
    cell: ({ row }) => (
      <div className="flex flex-col gap-y-1">
        <div className="flex items-center gap-x-2">
          <GeneratedAvatar variant="initials" seed={row.original.name} className="size-6" />
          <span className="font-semibold">{row.original.name}</span>
          {row.original.latestPain !== null && row.original.latestPain >= PAIN_ALERT_THRESHOLD && (
            <Badge variant="destructive">Pain {row.original.latestPain}/10</Badge>
          )}
        </div>
        <div className="flex items-center gap-x-2">
          <CornerDownRightIcon className="size-3 text-muted-foreground" />
          <span className="text-sm text-muted-foreground max-w-[220px] truncate">
            {row.original.phone ?? "No phone"}
          </span>
        </div>
      </div>
    ),
  },
  {
    accessorKey: "activePrescriptionCount",
    header: "Prescriptions",
    cell: ({ row }) => (
      <Badge variant="outline" className="flex items-center gap-x-2 [&>svg]:size-4">
        <ClipboardListIcon className="text-emerald-700" />
        {row.original.activePrescriptionCount} active
      </Badge>
    ),
  },
  {
    accessorKey: "sessionCount",
    header: "Sessions",
    cell: ({ row }) => (
      <div className="flex items-center gap-x-2">
        <Badge variant="outline" className="flex items-center gap-x-2 [&>svg]:size-4">
          <VideoIcon className="text-blue-700" />
          {row.original.sessionCount} {row.original.sessionCount === 1 ? "session" : "sessions"}
        </Badge>
        {row.original.lastSessionAt && (
          <span className="text-sm text-muted-foreground">last {format(new Date(row.original.lastSessionAt), "MMM d")}</span>
        )}
      </div>
    ),
  },
]
