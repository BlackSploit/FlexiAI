"use client";

import { format } from "date-fns";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";
import { ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";

const config = {
  avgPeak: { label: "Average peak", color: "var(--chart-1)" },
  bestPeak: { label: "Best peak", color: "var(--chart-1)" },
} satisfies ChartConfig;

export const includeReplay = process.env.NEXT_PUBLIC_DEMO_MODE === "true";   // DEV-14

interface Props {
  patientId: string;
  prescriptionId?: string;
}

/** ROM trend (§10.1): average and best peak per session vs the target line; replay points marked "demo". */
export const RomTrendChart = ({ patientId, prescriptionId }: Props) => {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.analytics.romTrend.queryOptions({ patientId, prescriptionId, includeReplay }));

  if (data.points.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No completed sets in the last 30 days yet.</p>;
  }
  const points = data.points.map((p) => ({ ...p, label: format(new Date(p.date), "MMM d") }));
  const maxPeak = Math.max(...points.map((p) => p.bestPeak ?? 0));
  const yMax = Math.ceil(Math.max((data.targetAngle ?? 0) + 20, maxPeak + 10) / 10) * 10;

  return (
    <ChartContainer config={config} className="h-64 w-full">
      <LineChart data={points} margin={{ left: 4, right: 16, top: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis domain={[0, yMax]} tickLine={false} axisLine={false} width={36} unit="°" />
        {data.targetAngle !== null && (
          <ReferenceLine y={data.targetAngle} stroke="var(--chart-2)" strokeDasharray="6 4"
            label={{ value: `Target ${data.targetAngle}°`, position: "insideTopRight", fill: "var(--chart-2)", fontSize: 12 }} />
        )}
        <ChartTooltip
          content={({ active, payload }) => {
            const p = active && payload?.[0]?.payload;
            if (!p) return null;
            return (
              <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                <div className="font-medium flex items-center gap-2">
                  {format(new Date(p.date), "MMM d, HH:mm")}
                  {p.isReplay && <Badge variant="secondary">demo</Badge>}
                </div>
                <div>Average peak {Math.round(p.avgPeak)}°</div>
                <div>Best peak {Math.round(p.bestPeak)}°</div>
                <div>Score {Math.round(p.score)}</div>
              </div>
            );
          }}
        />
        <Line dataKey="avgPeak" stroke="var(--color-avgPeak)" strokeWidth={2.5} isAnimationActive={false}
          dot={(props) => {
            const { cx, cy, payload, index } = props as { cx: number; cy: number; payload: { isReplay: boolean }; index: number };
            return payload.isReplay
              ? <circle key={index} cx={cx} cy={cy} r={5} fill="var(--background)" stroke="var(--color-avgPeak)" strokeWidth={2} />
              : <circle key={index} cx={cx} cy={cy} r={4} fill="var(--color-avgPeak)" />;
          }} />
        <Line dataKey="bestPeak" stroke="var(--color-bestPeak)" strokeOpacity={0.5} strokeDasharray="4 4" dot={false}
          isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  );
};
