"use client";

import { format } from "date-fns";
import { TrendingUpIcon } from "lucide-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { PanelEmpty } from "@/modules/dashboard/ui/components/panel-empty";

const config = {
  avgPeak: { label: "Average peak", color: "var(--primary)" },
  bestPeak: { label: "Best peak", color: "var(--primary)" },
} satisfies ChartConfig;

const TARGET_COLOR = "var(--color-emerald-600)";

export const includeReplay = process.env.NEXT_PUBLIC_DEMO_MODE === "true";   // DEV-14

interface Props {
  patientId: string;
  prescriptionId?: string;
}

type Point = { date: string | Date; avgPeak: number; bestPeak: number; score: number; isReplay: boolean };

const LegendItem = ({ className, label }: { className: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <span aria-hidden className={cn("inline-block", className)} />
    {label}
  </span>
);

/** ROM trend (§10.1): average and best peak per session vs the target line; replay points marked "demo". */
export const RomTrendChart = ({ patientId, prescriptionId }: Props) => {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.analytics.romTrend.queryOptions({ patientId, prescriptionId, includeReplay }));

  if (data.points.length === 0) {
    return (
      <PanelEmpty
        icon={TrendingUpIcon}
        title="No range-of-motion data yet"
        hint="After the first guided session, each session's average and best peak angle is plotted here against the target."
      />
    );
  }

  const points = data.points.map((p) => ({ ...p, label: format(new Date(p.date), "MMM d") }));
  const maxPeak = Math.max(...points.map((p) => p.bestPeak ?? 0));
  const yMax = Math.ceil(Math.max((data.targetAngle ?? 0) + 20, maxPeak + 10) / 10) * 10;
  const first = points[0].avgPeak;
  const latest = points[points.length - 1].avgPeak;
  const delta = points.length > 1 && first !== null && latest !== null ? Math.round(latest - first) : null;
  const hasReplay = points.some((p) => p.isReplay);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Latest average peak</p>
          <p className="text-2xl font-semibold tabular-nums tracking-tight">
            {latest !== null ? `${Math.round(latest)}°` : "—"}
            {delta !== null && (
              <span
                className={cn(
                  "ml-2 text-sm font-medium",
                  delta > 0 ? "text-emerald-600 dark:text-emerald-400"
                    : delta < 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                )}
              >
                {delta > 0 ? "+" : ""}{delta}° since first session
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <LegendItem className="h-0.5 w-4 rounded bg-primary" label="Average peak" />
          <LegendItem className="h-0 w-4 border-t-2 border-dashed border-primary/50" label="Best peak" />
          {data.targetAngle !== null && (
            <LegendItem className="h-0 w-4 border-t-2 border-dashed border-emerald-600" label={`Target ${data.targetAngle}°`} />
          )}
          {hasReplay && <LegendItem className="size-2.5 rounded-full border-2 border-primary bg-background" label="Demo replay" />}
        </div>
      </div>

      <ChartContainer config={config} className="aspect-auto h-56 w-full sm:h-64">
        <LineChart data={points} margin={{ left: 8, right: 16, top: 16, bottom: 4 }} accessibilityLayer>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
          <YAxis
            domain={[0, yMax]}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v: number) => `${v}°`}
            label={{
              value: "Peak angle", angle: -90, position: "insideLeft", offset: 0,
              style: { fontSize: 11, fill: "var(--muted-foreground)", textAnchor: "middle" },
            }}
          />
          {data.targetAngle !== null && (
            <ReferenceLine
              y={data.targetAngle}
              stroke={TARGET_COLOR}
              strokeDasharray="6 4"
              strokeWidth={1.5}
              label={{ value: `Target ${data.targetAngle}°`, position: "insideTopRight", fill: TARGET_COLOR, fontSize: 11, fontWeight: 600 }}
            />
          )}
          <ChartTooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = (active && payload?.[0]?.payload) as Point | false | undefined;
              if (!p) return null;
              return (
                <div className="min-w-40 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  <div className="mb-1.5 flex items-center justify-between gap-2 font-medium">
                    {format(new Date(p.date), "EEE, MMM d · HH:mm")}
                    {p.isReplay && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">demo</span>
                    )}
                  </div>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
                    <dt className="text-muted-foreground">Average peak</dt>
                    <dd className="font-medium tabular-nums">{Math.round(p.avgPeak)}°</dd>
                    <dt className="text-muted-foreground">Best peak</dt>
                    <dd className="font-medium tabular-nums">{Math.round(p.bestPeak)}°</dd>
                    {data.targetAngle !== null && (
                      <>
                        <dt className="text-muted-foreground">Target</dt>
                        <dd className="font-medium tabular-nums">{data.targetAngle}°</dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">Score</dt>
                    <dd className="font-medium tabular-nums">{Math.round(p.score)}</dd>
                  </dl>
                </div>
              );
            }}
          />
          <Line dataKey="bestPeak" stroke="var(--color-bestPeak)" strokeOpacity={0.45} strokeDasharray="4 4" strokeWidth={1.5}
            dot={false} activeDot={false} isAnimationActive={false} />
          <Line dataKey="avgPeak" stroke="var(--color-avgPeak)" strokeWidth={2.5} isAnimationActive={false}
            activeDot={{ r: 6, strokeWidth: 2, stroke: "var(--background)" }}
            dot={(props) => {
              const { cx, cy, payload, index } = props as { cx: number; cy: number; payload: { isReplay: boolean }; index: number };
              return payload.isReplay
                ? <circle key={index} cx={cx} cy={cy} r={4.5} fill="var(--background)" stroke="var(--color-avgPeak)" strokeWidth={2} />
                : <circle key={index} cx={cx} cy={cy} r={3.5} fill="var(--color-avgPeak)" stroke="var(--background)" strokeWidth={1.5} />;
            }} />
        </LineChart>
      </ChartContainer>
    </div>
  );
};

export const RomTrendChartSkeleton = () => (
  <div className="flex flex-col gap-3">
    <div className="space-y-2">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-7 w-40" />
    </div>
    <Skeleton className="h-56 w-full sm:h-64" />
  </div>
);
