"use client"

import { formatDistanceToNow } from "date-fns"
import { ColumnDef } from "@tanstack/react-table"
import { ChevronRightIcon, ClipboardListIcon, PhoneIcon } from "lucide-react"

import { GeneratedAvatar } from "@/components/generated-avatar"

import { PatientsGetMany } from "../../types"
import { LanguageBadge, PainChip } from "./ui-kit"

export const columns: ColumnDef<PatientsGetMany[number]>[] = [
  {
    accessorKey: "name",
    header: "Patient",
    cell: ({ row }) => (
      <div className="flex items-center gap-3 min-w-0">
        <GeneratedAvatar variant="initials" seed={row.original.name} className="size-9 border" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{row.original.name}</span>
            <PainChip pain={row.original.latestPain} />
          </div>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <PhoneIcon className="size-3" aria-hidden />
            {row.original.phone ?? "No phone on file"}
          </span>
        </div>
      </div>
    ),
  },
  {
    accessorKey: "preferredLanguage",
    header: "Language",
    meta: { className: "hidden md:table-cell" },
    cell: ({ row }) => <LanguageBadge lang={row.original.preferredLanguage} />,
  },
  {
    accessorKey: "activePrescriptionCount",
    header: "Active plans",
    meta: { className: "hidden sm:table-cell" },
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <ClipboardListIcon className="size-4 text-muted-foreground" aria-hidden />
        <span className="tabular-nums font-medium">{row.original.activePrescriptionCount}</span>
        <span className="text-muted-foreground">active</span>
      </span>
    ),
  },
  {
    accessorKey: "lastSessionAt",
    header: "Last session",
    meta: { className: "hidden lg:table-cell" },
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="text-sm">
          {row.original.lastSessionAt
            ? formatDistanceToNow(new Date(row.original.lastSessionAt), { addSuffix: true })
            : "Not started yet"}
        </span>
        <span className="text-xs text-muted-foreground">
          {row.original.sessionCount} {row.original.sessionCount === 1 ? "session" : "sessions"} total
        </span>
      </div>
    ),
  },
  {
    id: "go",
    header: () => <span className="sr-only">Open</span>,
    meta: { className: "w-10" },
    cell: () => <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />,
  },
]
