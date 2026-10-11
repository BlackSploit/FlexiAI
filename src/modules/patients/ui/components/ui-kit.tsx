"use client";

import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import type { LucideIcon } from "lucide-react";
import { AlertTriangleIcon, ChevronLeftIcon, ChevronRightIcon, RotateCwIcon, VideoIcon } from "lucide-react";
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

import { cn } from "@/lib/utils";
import { PAIN_ALERT_THRESHOLD } from "@/constants";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/* Small presentational kit shared by the patients and prescriptions screens. */

export const PageHeader = ({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) => (
  <div className="px-4 pt-6 pb-4 md:px-8 flex flex-col gap-y-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
    {children}
  </div>
);

export const SectionCard = ({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) => (
  <section className={cn("rounded-xl border bg-card text-card-foreground shadow-sm", className)}>
    <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action}
    </header>
    <div className={cn("p-5", contentClassName)}>{children}</div>
  </section>
);

export const EmptyPanel = ({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) => (
  <div className={cn("flex flex-col items-center justify-center gap-y-3 px-6 py-12 text-center", className)}>
    <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
      <Icon className="size-6" aria-hidden />
    </span>
    <div className="flex max-w-sm flex-col gap-y-1">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
    {action && <div className="pt-2">{action}</div>}
  </div>
);

export const ErrorPanel = ({ title, description }: { title: string; description: string }) => (
  <div className="flex flex-1 items-center justify-center px-4 py-10 md:px-8">
    <div className="flex w-full max-w-md flex-col items-center gap-y-3 rounded-xl border bg-card p-8 text-center shadow-sm">
      <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangleIcon className="size-6" aria-hidden />
      </span>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
      <Button variant="outline" className="mt-2" onClick={() => window.location.reload()}>
        <RotateCwIcon />
        Try again
      </Button>
    </div>
  </div>
);

interface ListTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  onRowClick?: (row: TData) => void;
  getRowLabel?: (row: TData) => string;
}

/** Data table with a header row, hover state and keyboard-accessible row click-through. */
export function ListTable<TData, TValue>({ columns, data, onRowClick, getRowLabel }: ListTableProps<TData, TValue>) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <Table>
        <TableHeader className="bg-muted/40">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={cn(
                    "h-10 px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground",
                    (header.column.columnDef.meta as { className?: string } | undefined)?.className,
                  )}
                >
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              tabIndex={onRowClick ? 0 : undefined}
              aria-label={getRowLabel?.(row.original)}
              onClick={() => onRowClick?.(row.original)}
              onKeyDown={(e) => {
                if (onRowClick && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                  e.preventDefault();
                  onRowClick(row.original);
                }
              }}
              className={cn(
                onRowClick && "cursor-pointer transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={cn("px-4 py-3.5 text-sm", (cell.column.columnDef.meta as { className?: string } | undefined)?.className)}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export const TableSkeleton = ({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) => (
  <div className="overflow-hidden rounded-xl border bg-card shadow-sm" aria-busy="true" aria-label="Loading">
    <div className="flex gap-6 border-b bg-muted/40 px-4 py-3">
      {Array.from({ length: cols }).map((_, i) => <Skeleton key={i} className="h-3 flex-1 max-w-24" />)}
    </div>
    {Array.from({ length: rows }).map((_, r) => (
      <div key={r} className="flex items-center gap-6 border-b px-4 py-4 last:border-b-0">
        <div className="flex flex-1 items-center gap-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-2/3 max-w-40" />
            <Skeleton className="h-3 w-1/2 max-w-28" />
          </div>
        </div>
        {Array.from({ length: cols - 1 }).map((_, c) => (
          <Skeleton key={c} className="hidden h-5 flex-1 max-w-24 rounded-full sm:block" />
        ))}
      </div>
    ))}
  </div>
);

export const ListPagination = ({
  page,
  pageSize,
  total,
  totalPages,
  noun,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  noun: string;
  onPageChange: (page: number) => void;
}) => {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex flex-col-reverse items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{from}–{to}</span> of{" "}
        <span className="font-medium text-foreground">{total}</span> {noun}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
          <ChevronLeftIcon />
          Previous
        </Button>
        <span className="min-w-16 text-center text-sm tabular-nums text-muted-foreground">
          {page} / {totalPages || 1}
        </span>
        <Button variant="outline" size="sm" disabled={page >= totalPages || totalPages === 0}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}>
          Next
          <ChevronRightIcon />
        </Button>
      </div>
    </nav>
  );
};

export const LanguageBadge = ({ lang }: { lang: string | null | undefined }) =>
  lang === "en" ? (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
      English
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
      <span lang="ml" className="font-ml">മലയാളം</span>
    </span>
  );

export const ActiveBadge = ({ active }: { active: boolean }) =>
  active ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
      <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden />
      Inactive
    </span>
  );

export const PainChip = ({ pain }: { pain: number | null | undefined }) => {
  if (pain === null || pain === undefined) return null;
  const high = pain >= PAIN_ALERT_THRESHOLD;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        high
          ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
          : "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      )}
      title="Patient-reported pain (0–10)"
    >
      {high && <AlertTriangleIcon className="size-3" aria-hidden />}
      Pain {pain}/10
    </span>
  );
};

export const StatTile = ({ label, value, hint, icon: Icon }: {
  label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: LucideIcon;
}) => (
  <div className="flex flex-col gap-y-1 rounded-xl border bg-card p-4 shadow-sm">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}
    </div>
    <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
    {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
  </div>
);

/* ---------- Sessions (read-only rendering of sessions.getMany items) ---------- */

type SessionStatus = "scheduled" | "live" | "done" | "failed" | string;

export const SessionStatusBadge = ({ status }: { status: SessionStatus }) => {
  const styles: Record<string, { label: string; className: string; dot: string; pulse?: boolean }> = {
    scheduled: { label: "Scheduled", className: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-400", dot: "bg-sky-500" },
    live: { label: "Live", className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500", pulse: true },
    done: { label: "Completed", className: "border-primary/20 bg-primary/10 text-primary", dot: "bg-primary" },
    failed: { label: "Failed", className: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-400", dot: "bg-rose-500" },
  };
  const s = styles[status] ?? { label: status, className: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium", s.className)}>
      <span className="relative flex size-1.5" aria-hidden>
        {s.pulse && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-75", s.dot)} />}
        <span className={cn("relative inline-flex size-1.5 rounded-full", s.dot)} />
      </span>
      {s.label}
    </span>
  );
};

export interface SessionListItem {
  id: string;
  status: SessionStatus;
  mode: string;
  scheduledAt: Date | string;
  startedAt: Date | string | null;
  duration: number | null;
  setCount: number;
  bestScore: number | null;
  maxPain: number | null;
  exercise: { nameEn: string; nameMl: string };
}

const fmtDuration = (s: number | null) => {
  if (s === null || s === undefined || Number.isNaN(Number(s))) return null;
  const total = Math.round(Number(s));
  const m = Math.floor(total / 60);
  return m > 0 ? `${m} min ${total % 60}s` : `${total}s`;
};

/** Compact, mobile-friendly list of sessions with status, score and pain. */
export const SessionList = ({ items, showExercise = true }: { items: SessionListItem[]; showExercise?: boolean }) => (
  <ul className="-mx-5 -my-2 divide-y">
    {items.map((s) => {
      const when = new Date(s.startedAt ?? s.scheduledAt);
      const duration = fmtDuration(s.duration);
      return (
        <li key={s.id}>
          <Link
            href={`/sessions/${s.id}`}
            className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <VideoIcon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {showExercise ? s.exercise.nameEn : format(when, "EEE, d MMM")}
                </span>
                <SessionStatusBadge status={s.status} />
                {s.mode === "replay" && (
                  <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">Demo</span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <time dateTime={when.toISOString()} title={format(when, "PPpp")}>
                  {formatDistanceToNow(when, { addSuffix: true })}
                </time>
                {duration && <> · {duration}</>}
                {s.setCount > 0 && <> · {s.setCount} {s.setCount === 1 ? "set" : "sets"}</>}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {s.bestScore !== null && (
                <span className="text-sm font-semibold tabular-nums">
                  {Math.round(s.bestScore)}<span className="text-xs font-normal text-muted-foreground">/100</span>
                </span>
              )}
              <PainChip pain={s.maxPain} />
            </div>
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      );
    })}
  </ul>
);

export const DetailSkeleton = () => (
  <div className="flex flex-1 flex-col gap-4 px-4 py-6 md:px-8" aria-busy="true" aria-label="Loading">
    <Skeleton className="h-4 w-48" />
    <div className="flex items-center gap-4 rounded-xl border bg-card p-6 shadow-sm">
      <Skeleton className="size-16 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <Skeleton className="hidden h-10 w-40 sm:block" />
    </div>
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      <Skeleton className="h-72 rounded-xl lg:col-span-2" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  </div>
);

export const InlineSkeleton = ({ className }: { className?: string }) => (
  <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
    <Skeleton className={cn("h-40 w-full rounded-lg", className)} />
  </div>
);
