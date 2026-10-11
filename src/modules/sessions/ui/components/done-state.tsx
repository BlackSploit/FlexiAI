"use client";

import { Suspense, useState } from "react";
import {
  ActivityIcon, GaugeIcon, HeartPulseIcon, Layers3Icon, RepeatIcon, TimerIcon, TrophyIcon,
} from "lucide-react";

import { cn, formatDuration } from "@/lib/utils";
import { PAIN_ALERT_THRESHOLD } from "@/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { PhysioNotes } from "@/modules/notes/ui/components/physio-notes";

import { SessionGetOne, SessionResults } from "../../types";
import { RepChart } from "./rep-chart";
import { SetResultsTable } from "./set-results-table";
import { PanelEmpty, SectionCard, StatTile } from "./session-panels";

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export const DoneState = ({ data, results }: { data: SessionGetOne; results: SessionResults }) => {
  const [setIdx, setSetIdx] = useState(0);

  const plannedSets = data.prescription.sets;
  const repsDone = results.reduce((a, r) => a + r.repsDone, 0);
  const repsPlanned = results.reduce((a, r) => a + r.repsPlanned, 0) || data.prescription.reps * plannedSets;
  const avgPeak = avg(results.map((r) => r.avgPeak));
  const avgTempo = avg(results.map((r) => r.avgRepSeconds));
  const bestScore = results.length ? Math.max(...results.map((r) => r.score)) : null;
  const pains = results.map((r) => r.pain).filter((p): p is number => p !== null);
  const maxPain = pains.length ? Math.max(...pains) : null;
  const target = data.prescription.targetAngle;
  const minTempo = data.prescription.minSecondsPerRep;
  const selected = results.length ? results[Math.min(setIdx, results.length - 1)] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Sets"
          icon={Layers3Icon}
          value={<>{results.length}<span className="text-base text-muted-foreground">/{plannedSets}</span></>}
          hint={results.length >= plannedSets ? "All sets finished" : "Some sets not finished"}
          tone={results.length >= plannedSets ? "good" : "warn"}
        />
        <StatTile
          label="Reps"
          icon={RepeatIcon}
          value={<>{repsDone}<span className="text-base text-muted-foreground">/{repsPlanned}</span></>}
          hint={`${Math.round((repsDone / Math.max(repsPlanned, 1)) * 100)}% of plan`}
        />
        <StatTile
          label="Avg peak"
          icon={GaugeIcon}
          value={avgPeak === null ? "–" : `${Math.round(avgPeak)}°`}
          hint={`Target ${target}°${avgPeak !== null ? ` · ${avgPeak >= target ? "reached" : `${Math.round(target - avgPeak)}° short`}` : ""}`}
          tone={avgPeak === null ? "default" : avgPeak >= target ? "good" : avgPeak >= target * 0.85 ? "warn" : "bad"}
        />
        <StatTile
          label="Avg tempo"
          icon={TimerIcon}
          value={avgTempo === null ? "–" : `${avgTempo.toFixed(1)} s`}
          hint={`Aim for ${minTempo} s or more per rep`}
          tone={avgTempo === null ? "default" : avgTempo >= minTempo ? "good" : "warn"}
        />
        <StatTile
          label="Best score"
          icon={TrophyIcon}
          value={bestScore === null ? "–" : Math.round(bestScore)}
          hint={data.duration ? `Out of 100 · ${formatDuration(data.duration)} session` : "Out of 100"}
        />
        <StatTile
          label="Max pain"
          icon={HeartPulseIcon}
          value={maxPain === null ? "–" : `${maxPain}/10`}
          hint={maxPain === null ? "Not reported" : maxPain >= PAIN_ALERT_THRESHOLD ? "At or above alert level" : "Reported by patient"}
          tone={maxPain === null ? "default" : maxPain >= PAIN_ALERT_THRESHOLD ? "bad" : maxPain >= 4 ? "warn" : "good"}
        />
      </div>

      <SectionCard
        title="Peak angle per rep"
        description="Each bar is one counted rep. The dashed line is the prescribed target."
        action={results.length > 1 ? (
          <div role="group" aria-label="Choose set" className="inline-flex flex-wrap gap-1 rounded-lg border bg-muted/50 p-1">
            {results.map((r, i) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={i === setIdx}
                onClick={() => setSetIdx(i)}
                className={cn(
                  "h-8 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  i === setIdx ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Set {r.setIndex}
              </button>
            ))}
          </div>
        ) : undefined}
      >
        {selected ? <RepChart perRep={selected.perRep} targetAngle={selected.targetAngle} /> : (
          <PanelEmpty icon={ActivityIcon} title="No reps to chart" hint="No set results were saved for this session." className="py-8" />
        )}
      </SectionCard>

      {results.length > 0 && <SetResultsTable results={results} />}

      <SectionCard title="Physio notes" description={`Private notes about ${data.patient.name}. Not shown to the patient.`}>
        <Suspense fallback={<div className="flex flex-col gap-2"><Skeleton className="h-20 w-full" /><Skeleton className="h-4 w-1/3" /></div>}>
          <PhysioNotes patientId={data.patient.id} />
        </Suspense>
      </SectionCard>
    </div>
  );
};
