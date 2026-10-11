import { Fragment } from "react";
import { BotIcon, ListChecksIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { SessionResults } from "../../types";
import { PainBadge } from "./pain-badge";

const STOP: Record<string, { label: string; tone: string }> = {
  completed: { label: "Completed", tone: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300" },
  idle: { label: "Idle", tone: "bg-muted text-muted-foreground border-border" },
  stop_pressed: { label: "Stop pressed", tone: "bg-amber-500/10 text-amber-700 border-amber-500/25 dark:text-amber-300" },
  pain: { label: "Pain", tone: "bg-rose-500/10 text-rose-700 border-rose-500/25 dark:text-rose-300" },
  symptom: { label: "Symptom", tone: "bg-rose-500/10 text-rose-700 border-rose-500/25 dark:text-rose-300" },
  disconnected: { label: "Disconnected", tone: "bg-muted text-muted-foreground border-border" },
};

const pill = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export const SourceBadge = ({ source }: { source: string }) => (
  <span className={cn(pill, source === "llm" ? "bg-violet-500/10 text-violet-700 border-violet-500/20 dark:text-violet-300" : "bg-muted text-muted-foreground border-border")}>
    {source === "llm" ? <BotIcon className="size-3" aria-hidden /> : <ListChecksIcon className="size-3" aria-hidden />}
    {source === "llm" ? "AI feedback" : "Rule-based"}
  </span>
);

const scoreTone = (s: number) => s >= 80 ? "text-emerald-600 dark:text-emerald-400" : s >= 50 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";

/** One row per set: reps, peaks, tempo, score, pain and why it ended, then its coach feedback in en + ml. */
export const SetResultsTable = ({ results, showFeedback = true }: { results: SessionResults; showFeedback?: boolean }) => {
  return (
    <section className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">Set results</h2>
          <p className="text-sm text-muted-foreground">What the coach measured in each set.</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr className="text-left">
              <th scope="col" className="px-5 py-2.5 font-medium">Set</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Reps</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Avg / best / lowest</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Avg tempo</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Too fast</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Score</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Pain</th>
              <th scope="col" className="px-3 py-2.5 pr-5 font-medium">Ended</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const stop = STOP[r.stopReason] ?? { label: r.stopReason, tone: "bg-muted text-muted-foreground border-border" };
              return (
                <Fragment key={r.id}>
                  <tr className={cn("align-top", !showFeedback && "border-b last:border-0")}>
                    <td className="px-5 pt-4 pb-2 font-semibold">{r.setIndex}</td>
                    <td className="px-3 pt-4 pb-2 tabular-nums">
                      {r.repsDone}<span className="text-muted-foreground">/{r.repsPlanned}</span>
                    </td>
                    <td className="px-3 pt-4 pb-2 tabular-nums whitespace-nowrap">
                      <span className={cn("font-medium", r.avgPeak >= r.targetAngle ? "text-emerald-600 dark:text-emerald-400" : "")}>{Math.round(r.avgPeak)}°</span>
                      {" / "}{Math.round(r.bestPeak)}° / {Math.round(r.lowestPeak)}°
                      <span className="block text-xs text-muted-foreground">target {r.targetAngle}°{r.side ? ` · ${r.side} side` : ""}</span>
                    </td>
                    <td className="px-3 pt-4 pb-2 tabular-nums whitespace-nowrap">{r.avgRepSeconds.toFixed(1)} s</td>
                    <td className={cn("px-3 pt-4 pb-2 tabular-nums", r.fastReps > 0 && "text-amber-600 dark:text-amber-400 font-medium")}>{r.fastReps}</td>
                    <td className={cn("px-3 pt-4 pb-2 text-base font-semibold tabular-nums", scoreTone(r.score))}>{Math.round(r.score)}</td>
                    <td className="px-3 pt-4 pb-2">{r.pain === null ? <span className="text-muted-foreground">–</span> : <PainBadge pain={r.pain} />}</td>
                    <td className="px-3 pt-4 pb-2 pr-5"><span className={cn(pill, stop.tone)}>{stop.label}</span></td>
                  </tr>
                  {showFeedback && (
                    <tr className="border-b last:border-0">
                      <td />
                      <td colSpan={7} className="px-3 pb-4 pr-5">
                        <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground">Coach feedback</span>
                            <SourceBadge source={r.feedbackSource} />
                          </div>
                          <p lang="ml" className="font-ml text-[15px] leading-relaxed">{r.feedbackMl}</p>
                          <p className="text-sm leading-relaxed text-muted-foreground">{r.feedbackEn}</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};
