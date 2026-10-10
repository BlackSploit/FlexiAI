"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, CalendarCheckIcon, UsersIcon, VideoIcon } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { LIVE_REFETCH_MS } from "@/constants";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { AdherenceCard } from "@/modules/analytics/ui/components/adherence-card";
import { PainFlagsList } from "@/modules/analytics/ui/components/pain-flags-list";
import { WeeklySummaryCard } from "@/modules/analytics/ui/components/weekly-summary-card";
import { CallSessionStatus } from "@/modules/sessions/types";
import { includeReplay } from "@/modules/analytics/ui/components/rom-trend-chart";

const Kpi = ({ icon: Icon, label, value, alert }: { icon: typeof VideoIcon; label: string; value: number; alert?: boolean }) => (
  <div className="bg-white rounded-lg border p-4 flex items-center gap-x-3">
    <div className={alert && value > 0 ? "rounded-md bg-rose-100 p-2 text-rose-700" : "rounded-md bg-muted p-2"}><Icon className="size-5" /></div>
    <div>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  </div>
);

const Panel = ({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <div className="bg-white rounded-lg border p-4 flex flex-col gap-y-3">
    <div className="flex items-center justify-between"><p className="font-medium">{title}</p>{action}</div>
    {children}
  </div>
);

const fallback = <p className="text-sm text-muted-foreground">Loading…</p>;

export const OverviewView = () => {
  const trpc = useTRPC();
  const overview = useSuspenseQuery(trpc.analytics.overview.queryOptions(undefined, {
    refetchInterval: (q) => ((q.state.data?.liveSessions ?? 0) > 0 ? LIVE_REFETCH_MS : 30_000),
  }));
  const live = useSuspenseQuery(trpc.sessions.getMany.queryOptions({ status: CallSessionStatus.Live, pageSize: 20 }, {
    refetchInterval: LIVE_REFETCH_MS,
  }));
  const adherence = useSuspenseQuery(trpc.analytics.adherence.queryOptions({ includeReplay }));
  const k = overview.data;

  return (
    <div className="flex-1 py-4 px-4 md:px-8 flex flex-col gap-y-4">
      <h5 className="font-medium text-xl">Overview</h5>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={VideoIcon} label="Live sessions" value={k.liveSessions} />
        <Kpi icon={CalendarCheckIcon} label="Sessions this week" value={k.sessionsThisWeek} />
        <Kpi icon={AlertTriangleIcon} label="Open safety alerts" value={k.openPainFlags} alert />
        <Kpi icon={UsersIcon} label="Active patients" value={k.activePatients} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Panel title="Live sessions">
            {live.data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No session is live right now.</p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {live.data.items.map((s) => (
                  <li key={s.id} className="rounded-md border p-3 flex items-center gap-x-3">
                    <GeneratedAvatar seed={s.patient.name} variant="initials" className="size-8" />
                    <Link href={`/sessions/${s.id}`} className="flex-1 min-w-0">
                      <p className="font-medium truncate">{s.patient.name}</p>
                      <p className="text-sm text-muted-foreground truncate">{s.exercise.nameEn} · {s.setCount} sets done</p>
                    </Link>
                    <Button asChild size="sm"><Link href={`/call/${s.id}`}>Join call</Link></Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Safety alerts (7 days)">
            <Suspense fallback={fallback}><PainFlagsList limit={10} /></Suspense>
          </Panel>
          {adherence.data.length > 0 && (
            <Panel title="Weekly summaries">
              <div className="grid gap-4 md:grid-cols-2">
                {adherence.data.slice(0, 4).map((p) => (
                  <div key={p.patientId} className="rounded-md border p-3">
                    <Link href={`/patients/${p.patientId}`} className="font-medium hover:underline">{p.name}</Link>
                    <Suspense fallback={fallback}><WeeklySummaryCard patientId={p.patientId} /></Suspense>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
        <Panel title="Adherence this week">
          <Suspense fallback={fallback}><AdherenceCard /></Suspense>
        </Panel>
      </div>
    </div>
  );
};

export const OverviewViewLoading = () => (
  <LoadingState title="Loading Overview" description="This may take a few seconds" />
);

export const OverviewViewError = () => (
  <ErrorState title="Error Loading Overview" description="Something went wrong" />
);
