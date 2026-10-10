"use client"

import { format } from "date-fns";
import { ColumnDef } from "@tanstack/react-table"
import {
  CircleCheckIcon,
  CircleXIcon,
  ClockArrowUpIcon,
  ClockFadingIcon,
  CornerDownRightIcon,
  LoaderIcon,
} from "lucide-react"

import { cn, formatDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge"
import { GeneratedAvatar } from "@/components/generated-avatar"

import { SessionGetMany } from "../../types"
import { PainBadge } from "./pain-badge";

export const statusIconMap = {
  scheduled: ClockArrowUpIcon,
  live: LoaderIcon,
  done: CircleCheckIcon,
  failed: CircleXIcon,
};

export const statusColorMap = {
  scheduled: "bg-yellow-500/20 text-yellow-800 border-yellow-800/5",
  live: "bg-blue-500/20 text-blue-800 border-blue-800/5",
  done: "bg-emerald-500/20 text-emerald-800 border-emerald-800/5",
  failed: "bg-rose-500/20 text-rose-800 border-rose-800/5",
}

export const columns: ColumnDef<SessionGetMany[number]>[] = [
  {
    accessorKey: "exercise",
    header: "Session",
    cell: ({ row }) => (
      <div className="flex flex-col gap-y-1">
        <div className="flex items-center gap-x-2">
          <span className="font-semibold">{row.original.exercise.nameEn}</span>
          {row.original.mode === "replay" && <Badge variant="secondary">replay</Badge>}
        </div>
        <div className="flex items-center gap-x-2">
          <CornerDownRightIcon className="size-3 text-muted-foreground" />
          <GeneratedAvatar variant="initials" seed={row.original.patient.name} className="size-4" />
          <span className="text-sm text-muted-foreground max-w-[200px] truncate">{row.original.patient.name}</span>
          <span className="text-sm text-muted-foreground">
            {format(new Date(row.original.startedAt ?? row.original.scheduledAt), "MMM d")}
          </span>
        </div>
      </div>
    )
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const Icon = statusIconMap[row.original.status];
      return (
        <Badge variant="outline" className={cn("capitalize [&>svg]:size-4 text-muted-foreground", statusColorMap[row.original.status])}>
          <Icon className={cn(row.original.status === "live" && "animate-spin")} />
          {row.original.status}
        </Badge>
      )
    },
  },
  {
    accessorKey: "bestScore",
    header: "Result",
    cell: ({ row }) => row.original.setCount > 0 ? (
      <div className="flex items-center gap-x-2 text-sm">
        <span>{row.original.avgPeak !== null ? Math.round(row.original.avgPeak) : "-"}° / {row.original.prescription.targetAngle}°</span>
        <Badge variant="outline">score {row.original.bestScore !== null ? Math.round(row.original.bestScore) : "-"}</Badge>
        <PainBadge pain={row.original.maxPain} />
      </div>
    ) : <span className="text-sm text-muted-foreground">No sets</span>,
  },
  {
    accessorKey: "duration",
    header: "Duration",
    cell: ({ row }) => (
      <Badge variant="outline" className="capitalize [&>svg]:size-4 flex items-center gap-x-2">
        <ClockFadingIcon className="text-blue-700" />
        {row.original.duration ? formatDuration(row.original.duration) : "No duration"}
      </Badge>
    ),
  },
];
