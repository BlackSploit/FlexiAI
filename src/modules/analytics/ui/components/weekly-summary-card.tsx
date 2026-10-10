"use client";

import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

import { includeReplay } from "./rom-trend-chart";

/** This week's numbers with the rule-based (or stored AI) summary; English / Malayalam toggle. */
export const WeeklySummaryCard = ({ patientId }: { patientId: string }) => {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.analytics.weeklySummary.queryOptions({ patientId, includeReplay }));
  const [lang, setLang] = useState<"en" | "ml">("en");

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">This week</p>
        <div className="flex items-center gap-x-2">
          <Badge variant="outline">{data.source === "llm" ? "AI" : "Rules"}</Badge>
          <Button variant="ghost" size="sm" onClick={() => setLang(lang === "en" ? "ml" : "en")}>
            {lang === "en" ? <span lang="ml" className="font-ml">മലയാളം</span> : "English"}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-x-3">
        <Progress value={data.adherencePct} className="h-2" />
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {data.sessionsDone}/{data.sessionsPlanned} sessions
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div><p className="text-muted-foreground">Avg peak</p><p className="font-medium">{data.avgPeak !== null ? `${Math.round(data.avgPeak)}°` : "-"}</p></div>
        <div>
          <p className="text-muted-foreground">vs last week</p>
          <p className="font-medium">
            {data.avgPeakDeltaVsLastWeek !== null ? `${data.avgPeakDeltaVsLastWeek > 0 ? "+" : ""}${Math.round(data.avgPeakDeltaVsLastWeek)}°` : "-"}
          </p>
        </div>
        <div><p className="text-muted-foreground">Max pain</p><p className="font-medium">{data.maxPain ?? "-"}</p></div>
      </div>
      {lang === "en"
        ? <p className="text-sm leading-relaxed">{data.textEn}</p>
        : <p lang="ml" className="text-base font-ml leading-relaxed">{data.textMl}</p>}
    </div>
  );
};
