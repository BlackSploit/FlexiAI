"use client";

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";

import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

import type { PerRep } from "../../types";

const config = { peak: { label: "Peak", color: "var(--chart-1)" } } satisfies ChartConfig;

/** Peak per rep vs the target; too-fast reps in another colour. */
export const RepChart = ({ perRep, targetAngle }: { perRep: PerRep[]; targetAngle: number }) => {
  const data = perRep.map((r, i) => ({ rep: i + 1, peak: Math.round(r.peak), seconds: r.seconds, tooFast: r.tooFast }));
  if (data.length === 0) return <p className="text-sm text-muted-foreground">No counted reps.</p>;
  return (
    <div className="flex flex-col gap-y-2">
      <ChartContainer config={config} className="h-56 w-full">
        <BarChart data={data} margin={{ left: 4, right: 16, top: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="rep" tickLine={false} axisLine={false} />
          <YAxis domain={[0, Math.max(targetAngle + 20, ...data.map((d) => d.peak + 10))]} width={36} unit="°"
            tickLine={false} axisLine={false} />
          <ReferenceLine y={targetAngle} stroke="var(--chart-2)" strokeDasharray="6 4"
            label={{ value: `Target ${targetAngle}°`, position: "insideTopRight", fill: "var(--chart-2)", fontSize: 12 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="peak" radius={4} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.rep} fill={d.tooFast ? "var(--chart-4)" : "var(--color-peak)"} />)}
          </Bar>
        </BarChart>
      </ChartContainer>
      <div className="flex gap-x-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-[var(--chart-1)]" />good tempo</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-[var(--chart-4)]" />too fast</span>
      </div>
    </div>
  );
};
