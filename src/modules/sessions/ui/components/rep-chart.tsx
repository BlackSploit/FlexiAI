"use client";

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";

import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

import type { PerRep } from "../../types";

const config = { peak: { label: "Peak angle", color: "var(--chart-1)" } } satisfies ChartConfig;

/** Peak per rep vs the target; too-fast reps in another colour. */
export const RepChart = ({ perRep, targetAngle }: { perRep: PerRep[]; targetAngle: number }) => {
  const data = perRep.map((r, i) => ({ rep: i + 1, peak: Math.round(r.peak), seconds: r.seconds, tooFast: r.tooFast }));
  if (data.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No counted reps in this set.</p>;
  return (
    <div className="flex flex-col gap-y-3">
      <ChartContainer
        config={config}
        className="h-60 w-full"
        role="img"
        aria-label={`Peak angle for ${data.length} reps against a target of ${targetAngle} degrees`}
      >
        <BarChart data={data} margin={{ left: 4, right: 16, top: 16 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="rep" tickLine={false} axisLine={false} tickFormatter={(v) => `#${v}`} />
          <YAxis domain={[0, Math.max(targetAngle + 20, ...data.map((d) => d.peak + 10))]} width={40} unit="°"
            tickLine={false} axisLine={false} />
          <ReferenceLine y={targetAngle} stroke="var(--foreground)" strokeOpacity={0.5} strokeDasharray="6 4"
            label={{ value: `Target ${targetAngle}°`, position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 12 }} />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, p) => {
                  const d = p?.[0]?.payload as (typeof data)[number] | undefined;
                  return d ? `Rep ${d.rep} · ${d.seconds.toFixed(1)} s${d.tooFast ? " (too fast)" : ""}` : "";
                }}
              />
            }
          />
          <Bar dataKey="peak" radius={[6, 6, 0, 0]} maxBarSize={48} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.rep} fill={d.tooFast ? "var(--chart-4)" : "var(--color-peak)"} />)}
          </Bar>
        </BarChart>
      </ChartContainer>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[var(--chart-1)]" />Good tempo</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[var(--chart-4)]" />Too fast</span>
        <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-foreground/50" />Target angle</span>
      </div>
    </div>
  );
};
