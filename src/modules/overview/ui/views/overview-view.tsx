"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  CalendarCheckIcon,
  CheckCircle2Icon,
  ClipboardPlusIcon,
  HeartPulseIcon,
  ShieldAlertIcon,
  SparklesIcon,
  UserPlusIcon,
  UsersIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { LIVE_REFETCH_MS } from "@/constants";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { AdherenceCard, AdherenceCardSkeleton } from "@/modules/analytics/ui/components/adherence-card";
import { PainFlagsList, PainFlagsListSkeleton } from "@/modules/analytics/ui/components/pain-flags-list";
import { WeeklySummaryCard } from "@/modules/analytics/ui/components/weekly-summary-card";
import { includeReplay } from "@/modules/analytics/ui/components/rom-trend-chart";
import { PanelEmpty } from "@/modules/dashboard/ui/components/panel-empty";
import { NewPatientDialog } from "@/modules/patients/ui/components/new-patient-dialog";
import { NewPrescriptionDialog } from "@/modules/prescriptions/ui/components/new-prescription-dialog";
import { CallSessionStatus } from "@/modules/sessions/types";

/** Shared with the page's prefetch so the hydrated cache key matches. */
export const RECENT_SESSIONS_INPUT = { pageSize: 6 } as const;

/* ---------- small building blocks ---------- */

const Panel = ({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) => (
  <section className={cn("rounded-xl border bg-card text-card-foreground shadow-sm", className)}>
    <header className="flex items-start justify-between gap-3 px-5 pt-5">
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action}
    </header>
    <div className="px-5 pb-5 pt-4">{children}</div>
  </section>
);

const StatTile = ({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint: string;
  tone?: "default" | "alert" | "success";
}) => (
  <div
    className={cn(
      "rounded-xl border bg-card p-4 shadow-sm sm:p-5",
      tone === "alert" && "border-rose-500/30 bg-rose-500/[0.04]",
    )}
  >
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-lg",
          tone === "alert" ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
            : tone === "success" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-primary/10 text-primary",
        )}
      >
        <Icon className="size-4" />
      </span>
    </div>
    <p
      className={cn(
        "mt-2 text-3xl font-semibold tabular-nums tracking-tight",
        tone === "alert" && "text-rose-700 dark:text-rose-300",
      )}
    >
      {value}
    </p>
    <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
  </div>
);

const statusMeta: Record<string, { label: string; className: string }> = {
  scheduled: { label: "Scheduled", className: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  live: { label: "Live", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  done: { label: "Completed", className: "bg-primary/10 text-primary" },
  failed: { label: "Failed", className: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
};

const StatusBadge = ({ status }: { status: string }) => {
  const meta = statusMeta[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", meta.className)}>
      {status === "live" && (
        <span className="relative flex size-1.5" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
        </span>
      )}
      {meta.label}
    </span>
  );
};

const greetingFor = (hour: number) => (hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening");

const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return /^dr\.?$/i.test(parts[0]) && parts[1] ? `${parts[0]} ${parts[1]}` : parts[0];
};

/* ---------- view ---------- */

export const OverviewView = ({ physioName = "" }: { physioName?: string }) => {
  const trpc = useTRPC();
  const [patientOpen, setPatientOpen] = useState(false);
  const [prescriptionOpen, setPrescriptionOpen] = useState(false);

  const overview = useSuspenseQuery(trpc.analytics.overview.queryOptions(undefined, {
    refetchInterval: (q) => ((q.state.data?.liveSessions ?? 0) > 0 ? LIVE_REFETCH_MS : 30_000),
  }));
  const live = useSuspenseQuery(trpc.sessions.getMany.queryOptions({ status: CallSessionStatus.Live, pageSize: 20 }, {
    refetchInterval: LIVE_REFETCH_MS,
  }));
  const recent = useSuspenseQuery(trpc.sessions.getMany.queryOptions(RECENT_SESSIONS_INPUT, { refetchInterval: 30_000 }));
  const adherence = useSuspenseQuery(trpc.analytics.adherence.queryOptions({ includeReplay }));
  const k = overview.data;

  const now = new Date();
  const name = shortName(physioName);
  const planned = adherence.data.reduce((s, r) => s + r.planned, 0);
  const done = adherence.data.reduce((s, r) => s + Math.min(r.done, r.planned), 0);
  const adherencePct = planned > 0 ? Math.round((done / planned) * 100) : null;

  const steps = [
    { done: adherence.data.length > 0, title: "Add your first patient", hint: "Name and phone number — no app or account needed for them.", action: () => setPatientOpen(true), cta: "Add patient" },
    { done: k.activePatients > 0, title: "Prescribe a home exercise", hint: "Pick an exercise, reps, sets and the target angle.", action: () => setPrescriptionOpen(true), cta: "New prescription" },
    { done: recent.data.total > 0, title: "Start a guided session", hint: "Share the one-time link; the coach counts reps in Malayalam.", href: "/prescriptions", cta: "Open prescriptions" },
  ];
  const showOnboarding = steps.some((s) => !s.done);
  const stepsDone = steps.filter((s) => s.done).length;

  return (
    <>
      <NewPatientDialog open={patientOpen} onOpenChange={setPatientOpen} />
      <NewPrescriptionDialog open={prescriptionOpen} onOpenChange={setPrescriptionOpen} />

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 md:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground" suppressHydrationWarning>{format(now, "EEEE, d MMMM yyyy")}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight" suppressHydrationWarning>
              {greetingFor(now.getHours())}{name ? `, ${name}` : ""}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {k.openPainFlags > 0
                ? `${k.openPainFlags} safety ${k.openPainFlags === 1 ? "alert needs" : "alerts need"} your review.`
                : k.liveSessions > 0
                  ? `${k.liveSessions} ${k.liveSessions === 1 ? "patient is" : "patients are"} exercising with the coach right now.`
                  : "Here's how your patients are doing this week."}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPatientOpen(true)}>
              <UserPlusIcon />
              New patient
            </Button>
            <Button onClick={() => setPrescriptionOpen(true)}>
              <ClipboardPlusIcon />
              New prescription
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatTile
            icon={UsersIcon}
            label="Active patients"
            value={k.activePatients}
            hint={adherence.data.length > 0 ? `${adherence.data.length} on your list` : "Add a patient to begin"}
          />
          <StatTile
            icon={CalendarCheckIcon}
            label="Sessions this week"
            value={k.sessionsThisWeek}
            hint={k.liveSessions > 0 ? `${k.liveSessions} live right now` : "Monday to Sunday"}
          />
          <StatTile
            icon={HeartPulseIcon}
            label="Adherence"
            value={adherencePct === null ? "—" : `${adherencePct}%`}
            hint={planned > 0 ? `${done} of ${planned} planned sessions done` : "No sessions planned yet"}
            tone={adherencePct !== null && adherencePct >= 80 ? "success" : "default"}
          />
          <StatTile
            icon={ShieldAlertIcon}
            label="Open safety alerts"
            value={k.openPainFlags}
            hint={k.openPainFlags > 0 ? "Review and acknowledge below" : "Nothing to review"}
            tone={k.openPainFlags > 0 ? "alert" : "success"}
          />
        </div>

        {/* Live now */}
        {live.data.items.length > 0 && (
          <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <span className="relative flex size-2.5" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
              </span>
              <h2 className="text-base font-semibold tracking-tight">Live now</h2>
              <span className="text-sm text-muted-foreground">· the coach is guiding these sessions</span>
            </div>
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {live.data.items.map((s) => (
                <li key={s.id} className="flex items-center gap-x-3 rounded-lg border bg-card p-3">
                  <GeneratedAvatar seed={s.patient.name} variant="initials" className="size-9" />
                  <Link href={`/sessions/${s.id}`} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.patient.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.exercise.nameEn} · {s.setCount}/{s.prescription.sets} sets done
                    </p>
                  </Link>
                  <Button asChild size="sm">
                    <Link href={`/call/${s.id}`}>
                      <VideoIcon />
                      Join
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Getting started */}
        {showOnboarding && (
          <Panel
            icon={SparklesIcon}
            title="Get started with PhysioCoach"
            description={`${stepsDone} of ${steps.length} steps done — your first guided session takes about five minutes to set up.`}
          >
            <ol className="grid gap-3 md:grid-cols-3">
              {steps.map((step, i) => (
                <li
                  key={step.title}
                  className={cn(
                    "flex flex-col gap-3 rounded-lg border p-4",
                    step.done ? "bg-muted/40" : "bg-background",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {step.done ? (
                      <CheckCircle2Icon className="size-5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <span className="flex size-5 items-center justify-center rounded-full border text-[11px] font-semibold text-muted-foreground">
                        {i + 1}
                      </span>
                    )}
                    <p className={cn("text-sm font-semibold", step.done && "text-muted-foreground line-through")}>{step.title}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">{step.hint}</p>
                  {!step.done && (
                    step.href ? (
                      <Button asChild size="sm" variant="outline" className="mt-auto self-start">
                        <Link href={step.href}>{step.cta}<ArrowRightIcon /></Link>
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="mt-auto self-start" onClick={step.action}>
                        {step.cta}<ArrowRightIcon />
                      </Button>
                    )
                  )}
                </li>
              ))}
            </ol>
          </Panel>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <Panel
              icon={ShieldAlertIcon}
              title="Needs attention"
              description="Safety alerts from the last 7 days"
            >
              <Suspense fallback={<PainFlagsListSkeleton />}>
                <PainFlagsList limit={6} />
              </Suspense>
            </Panel>

            <Panel
              icon={VideoIcon}
              title="Recent sessions"
              description="Latest guided sessions across your patients"
              action={recent.data.items.length > 0 ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/sessions">View all<ArrowRightIcon /></Link>
                </Button>
              ) : undefined}
            >
              {recent.data.items.length === 0 ? (
                <PanelEmpty
                  icon={VideoIcon}
                  title="No sessions yet"
                  hint="Start a session from a prescription and share the link with your patient. Results appear here."
                  action={
                    <Button asChild size="sm">
                      <Link href="/prescriptions">Go to prescriptions</Link>
                    </Button>
                  }
                />
              ) : (
                <ul className="-mx-2 flex flex-col">
                  {recent.data.items.map((s) => {
                    const when = new Date(s.startedAt ?? s.scheduledAt ?? s.createdAt);
                    return (
                      <li key={s.id}>
                        <Link
                          href={`/sessions/${s.id}`}
                          className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <GeneratedAvatar seed={s.patient.name} variant="initials" className="size-9" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium">{s.patient.name}</p>
                              {s.mode === "replay" && (
                                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">demo</span>
                              )}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {s.exercise.nameEn} · {formatDistanceToNow(when, { addSuffix: true })}
                            </p>
                          </div>
                          <div className="hidden text-right sm:block">
                            <p className="text-sm font-medium tabular-nums">
                              {s.avgPeak !== null && s.avgPeak !== undefined ? `${Math.round(Number(s.avgPeak))}°` : "—"}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {s.setCount}/{s.prescription.sets} sets
                            </p>
                          </div>
                          <StatusBadge status={s.status} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>

          <div className="flex flex-col gap-6">
            <Panel icon={HeartPulseIcon} title="Adherence this week" description="Sessions done vs planned">
              <Suspense fallback={<AdherenceCardSkeleton />}>
                <AdherenceCard limit={8} />
              </Suspense>
            </Panel>

            <Panel title="Quick actions">
              <div className="flex flex-col gap-2">
                <QuickAction icon={UserPlusIcon} title="New patient" hint="Add someone to your list" onClick={() => setPatientOpen(true)} />
                <QuickAction icon={ClipboardPlusIcon} title="New prescription" hint="Prescribe a home exercise" onClick={() => setPrescriptionOpen(true)} />
                <QuickAction icon={VideoIcon} title="Start a session" hint="From an active prescription" href="/prescriptions?active=true" />
              </div>
            </Panel>
          </div>
        </div>

        {adherence.data.length > 0 && (
          <Panel
            icon={SparklesIcon}
            title="Weekly summaries"
            description="Plain-language notes you can share with patients in Malayalam or English"
          >
            <div className="grid gap-4 md:grid-cols-2">
              {adherence.data.slice(0, 4).map((p) => (
                <div key={p.patientId} className="rounded-lg border bg-background p-4">
                  <Link href={`/patients/${p.patientId}`} className="text-sm font-semibold hover:underline">{p.name}</Link>
                  <Suspense fallback={<Skeleton className="mt-3 h-24 w-full" />}>
                    <WeeklySummaryCard patientId={p.patientId} />
                  </Suspense>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </>
  );
};

const QuickAction = ({
  icon: Icon,
  title,
  hint,
  onClick,
  href,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  onClick?: () => void;
  href?: string;
}) => {
  const inner = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </>
  );
  const className = "group flex w-full items-center gap-3 rounded-lg border bg-background p-3 transition-colors hover:border-primary/40 hover:bg-primary/[0.03] outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return href ? (
    <Link href={href} className={className}>{inner}</Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>{inner}</button>
  );
};

export const OverviewViewLoading = () => (
  <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 md:px-8" aria-busy="true" aria-label="Loading overview">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-40" />
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card p-5 shadow-sm">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-8 w-16" />
          <Skeleton className="mt-2 h-3 w-28" />
        </div>
      ))}
    </div>
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <Skeleton className="mb-5 h-5 w-40" />
          <PainFlagsListSkeleton />
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <Skeleton className="mb-5 h-5 w-40" />
          <PainFlagsListSkeleton rows={4} />
        </div>
      </div>
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <Skeleton className="mb-5 h-5 w-40" />
        <AdherenceCardSkeleton />
      </div>
    </div>
  </div>
);

export const OverviewViewError = () => (
  <ErrorState title="Couldn't load your overview" description="Check your connection and refresh the page." />
);
