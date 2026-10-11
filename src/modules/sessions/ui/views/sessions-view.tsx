"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AlertCircleIcon, CalendarClockIcon, ChevronRightIcon, ClipboardListIcon, RotateCwIcon, SearchXIcon } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { DEFAULT_PAGE } from "@/constants";
import { formatDuration } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { DataPagination } from "@/components/data-pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { SessionGetMany } from "../../types";
import { PainBadge } from "../components/pain-badge";
import { sessionDate } from "../components/columns";
import { PanelEmpty } from "../components/session-panels";
import { SessionStatusBadge } from "../components/session-status-badge";
import { useSessionsFilters } from "../../hooks/use-sessions-filters";

type Row = SessionGetMany[number];

const Score = ({ value }: { value: number | null }) =>
  value === null ? <span className="text-muted-foreground">–</span> : (
    <span className="inline-flex min-w-10 justify-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary tabular-nums">
      {Math.round(value)}
    </span>
  );

const WhenCell = ({ row }: { row: Row }) => {
  const d = sessionDate(row);
  return (
    <div className="flex flex-col">
      <span className="text-sm whitespace-nowrap">{format(d, "d MMM yyyy")}</span>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {format(d, "h:mm a")} · {formatDistanceToNow(d, { addSuffix: true })}
      </span>
    </div>
  );
};

export const SessionsView = () => {
  const trpc = useTRPC();
  const router = useRouter();
  const [filters, setFilters] = useSessionsFilters();
  const { data } = useSuspenseQuery(trpc.sessions.getMany.queryOptions({ ...filters }));

  const filtered = !!filters.status || !!filters.search || !!filters.patientId || !!filters.prescriptionId;
  const open = (id: string) => router.push(`/sessions/${id}`);

  if (data.items.length === 0) {
    return (
      <div className="flex-1 pb-6 px-4 md:px-8">
        <div className="rounded-xl border bg-card shadow-sm">
          {filtered ? (
            <PanelEmpty
              icon={SearchXIcon}
              title="No sessions match these filters"
              hint="Try a different patient name, exercise or status."
              action={
                <Button variant="outline" onClick={() => setFilters({ status: null, patientId: "", prescriptionId: "", search: "", page: DEFAULT_PAGE })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <PanelEmpty
              icon={CalendarClockIcon}
              title="No guided sessions yet"
              hint="Open a prescription and choose Start guided session. The coach joins the call and you get a link to send the patient."
              action={<Button asChild><Link href="/prescriptions"><ClipboardListIcon />Go to prescriptions</Link></Button>}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 pb-6 px-4 md:px-8 flex flex-col gap-y-3">
      {/* Mobile: cards */}
      <ul className="flex flex-col gap-2 md:hidden">
        {data.items.map((row) => (
          <li key={row.id}>
            <Link
              href={`/sessions/${row.id}`}
              className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-accent/50 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <GeneratedAvatar variant="initials" seed={row.patient.name} className="size-10 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{row.patient.name}</p>
                    <p className="text-sm text-muted-foreground truncate">{row.exercise.nameEn}</p>
                  </div>
                </div>
                <SessionStatusBadge status={row.status} failureReason={row.failureReason} />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <span>{format(sessionDate(row), "d MMM, h:mm a")}</span>
                {row.duration ? <span>{formatDuration(row.duration)}</span> : null}
                <span>{row.setCount} {row.setCount === 1 ? "set" : "sets"}</span>
                {row.bestScore !== null && <span className="text-primary font-medium">Best {Math.round(row.bestScore)}</span>}
                <PainBadge pain={row.maxPain} />
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden md:block rounded-xl border bg-card shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="pl-5">Patient</TableHead>
              <TableHead>Exercise</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead className="text-right">Sets</TableHead>
              <TableHead className="text-center">Best score</TableHead>
              <TableHead>Max pain</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((row) => (
              <TableRow
                key={row.id}
                tabIndex={0}
                onClick={() => open(row.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(row.id); } }}
                className="group cursor-pointer outline-none focus-visible:bg-accent/60"
                aria-label={`Open session: ${row.exercise.nameEn} with ${row.patient.name}`}
              >
                <TableCell className="pl-5 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <GeneratedAvatar variant="initials" seed={row.patient.name} className="size-8 shrink-0" />
                    <span className="font-medium truncate max-w-[180px]">{row.patient.name}</span>
                  </div>
                </TableCell>
                <TableCell className="py-3">
                  <div className="flex flex-col min-w-0">
                    <span className="truncate max-w-[220px]">{row.exercise.nameEn}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.prescription.sets} × {row.prescription.reps} to {row.prescription.targetAngle}°
                      {row.mode === "replay" && " · demo replay"}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="py-3"><SessionStatusBadge status={row.status} failureReason={row.failureReason} /></TableCell>
                <TableCell className="py-3"><WhenCell row={row} /></TableCell>
                <TableCell className="py-3 text-right tabular-nums text-sm">
                  {row.duration ? formatDuration(row.duration) : <span className="text-muted-foreground">–</span>}
                </TableCell>
                <TableCell className="py-3 text-right tabular-nums text-sm">
                  {row.setCount}<span className="text-muted-foreground">/{row.prescription.sets}</span>
                </TableCell>
                <TableCell className="py-3 text-center"><Score value={row.bestScore} /></TableCell>
                <TableCell className="py-3">
                  {row.maxPain === null ? <span className="text-muted-foreground text-sm">–</span> : <PainBadge pain={row.maxPain} />}
                </TableCell>
                <TableCell className="py-3 pr-4">
                  <ChevronRightIcon className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="hidden sm:block text-sm text-muted-foreground">
          {data.total} {data.total === 1 ? "session" : "sessions"}
        </p>
        <div className="flex-1 sm:flex-none sm:min-w-72">
          <DataPagination page={filters.page} totalPages={data.totalPages} onPageChange={(page) => setFilters({ page })} />
        </div>
      </div>
    </div>
  );
};

export const SessionsViewLoading = () => (
  <div className="flex-1 pb-6 px-4 md:px-8" aria-busy="true" aria-label="Loading sessions">
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="hidden md:flex gap-6 border-b bg-muted/40 px-5 py-3">
        {[120, 140, 80, 100, 70, 50, 70, 70].map((w, i) => <Skeleton key={i} className="h-3" style={{ width: w }} />)}
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b last:border-0 px-5 py-4">
          <Skeleton className="size-9 rounded-full shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="hidden md:block h-3.5 w-24" />
          <Skeleton className="hidden md:block h-5 w-12 rounded-full" />
        </div>
      ))}
    </div>
  </div>
);

export const SessionsViewError = () => (
  <div className="flex-1 pb-6 px-4 md:px-8">
    <div className="rounded-xl border bg-card shadow-sm">
      <PanelEmpty
        icon={AlertCircleIcon}
        tone="rose"
        title="Sessions could not be loaded"
        hint="Check your connection and try again. No session data was changed."
        action={<Button variant="outline" onClick={() => window.location.reload()}><RotateCwIcon />Try again</Button>}
      />
    </div>
  </div>
);
