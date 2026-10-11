"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, Loader2Icon, SparklesIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

import { includeReplay } from "./rom-trend-chart";

type Lang = "ml" | "en";

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) => (
  <div className="rounded-md bg-muted/50 px-2.5 py-2">
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className={cn(
      "text-base font-semibold tabular-nums",
      tone === "up" && "text-primary",
      tone === "down" && "text-destructive",
    )}>
      {value}
    </p>
  </div>
);

/**
 * This week's numbers with the stored (AI or rules) or live rule-based summary.
 * Malayalam / English toggle, "Generate AI summary" (falls back to rules server-side) and copy-to-share.
 */
export const WeeklySummaryCard = ({ patientId }: { patientId: string }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const queryOptions = trpc.analytics.weeklySummary.queryOptions({ patientId, includeReplay });
  const { data } = useSuspenseQuery(queryOptions);
  const [lang, setLang] = useState<Lang>("en");
  const [copied, setCopied] = useState(false);

  const generate = useMutation(trpc.analytics.generateWeeklySummary.mutationOptions({
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
      if (res.source === "llm") toast.success("AI summary ready. Review it before sharing.");
      else toast.info("AI summary unavailable, so the rule-based summary was saved.");
    },
    onError: (e) => toast.error(e.message),
  }));

  const text = lang === "ml" ? data.textMl : data.textEn;
  const isAi = data.source === "llm";
  const delta = data.avgPeakDeltaVsLastWeek;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(lang === "ml" ? "Malayalam summary copied" : "English summary copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the text and copy it manually.");
    }
  };

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          This week <span className="font-normal text-muted-foreground">· from {data.weekStart}</span>
        </p>
        <Badge
          variant={isAi ? "secondary" : "outline"}
          title={isAi ? "Written by AI from this week's numbers. Review before sharing." : "Generated from fixed rules"}
        >
          {isAi && <SparklesIcon aria-hidden />}
          {isAi ? "AI draft · review before sharing" : "Rules"}
        </Badge>
      </div>

      <div className="flex items-center gap-x-3">
        <Progress value={data.adherencePct} className="h-2" aria-label={`Adherence ${data.adherencePct}%`} />
        <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
          {data.sessionsDone}/{data.sessionsPlanned} sessions · {data.adherencePct}%
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Avg peak" value={data.avgPeak !== null ? `${Math.round(data.avgPeak)}°` : "–"} />
        <Stat
          label="vs last wk"
          value={delta !== null ? `${delta > 0 ? "+" : ""}${Math.round(delta)}°` : "–"}
          tone={delta !== null && delta > 0 ? "up" : delta !== null && delta < 0 ? "down" : undefined}
        />
        <Stat label="Max pain" value={data.maxPain !== null ? `${data.maxPain}/10` : "–"} />
      </div>

      <div className="rounded-md border bg-card">
        <div role="tablist" aria-label="Summary language" className="flex border-b p-1 gap-1">
          {(["en", "ml"] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={lang === l}
              onClick={() => setLang(l)}
              className={cn(
                "flex-1 rounded-sm px-2 py-1.5 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                lang === l ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l === "ml" ? <span lang="ml" className="font-ml">മലയാളം</span> : "English"}
            </button>
          ))}
        </div>
        <p
          role="tabpanel"
          {...(lang === "ml" ? { lang: "ml" } : {})}
          className={cn("p-3 leading-relaxed", lang === "ml" ? "font-ml text-base" : "text-sm")}
        >
          {text}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => generate.mutate({ patientId, includeReplay })}
          disabled={generate.isPending}
          aria-busy={generate.isPending}
        >
          {generate.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <SparklesIcon aria-hidden />}
          {generate.isPending ? "Generating…" : isAi ? "Regenerate AI summary" : "Generate AI summary"}
        </Button>
        <Button size="sm" variant="outline" onClick={copy} aria-label={`Copy ${lang === "ml" ? "Malayalam" : "English"} summary`}>
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {isAi && (
        <p className="text-xs text-muted-foreground">
          AI text states numbers only. Check it matches the figures above before sending it to the patient.
        </p>
      )}
    </div>
  );
};
