"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ActivityIcon, PhoneOffIcon, RotateCcwIcon, ShieldCheckIcon, VideoIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

import { SessionGetOne, SessionResults } from "../../types";
import { SetResultsTable } from "./set-results-table";
import { PanelEmpty, SectionCard } from "./session-panels";

interface Props {
  data: SessionGetOne;
  results: SessionResults;
  onRestart: () => void;
  onEnd: () => void;
  isRestarting?: boolean;
  isEnding?: boolean;
}

export const LiveState = ({ data, results, onRestart, onEnd, isRestarting, isEnding }: Props) => {
  const planned = data.prescription.sets;
  const done = results.length;
  const pct = Math.min(100, Math.round((done / Math.max(planned, 1)) * 100));
  return (
    <div className="flex flex-col gap-4">
      <section className="relative overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-card to-card p-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <span className="relative mt-1 flex size-3 shrink-0" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
            </span>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Session is live</h2>
              <p className="text-sm text-muted-foreground">
                The coach is guiding {data.patient.name}
                {data.startedAt ? ` · started ${formatDistanceToNow(new Date(data.startedAt), { addSuffix: true })}` : ""}.
                Results appear here after each set.
              </p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheckIcon className="size-3.5" aria-hidden />
                {data.consentGivenAt ? "Patient gave consent. Video is analysed live and never recorded." : "Waiting for patient consent before any analysis."}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
            <Button asChild size="lg" className="h-12 px-6 text-base">
              <Link href={`/call/${data.id}`}><VideoIcon className="size-5" />Join live call</Link>
            </Button>
            <Button variant="outline" size="lg" className="h-12" onClick={onRestart} disabled={isRestarting}>
              <RotateCcwIcon />
              {isRestarting ? "Restarting…" : "Restart coach"}
            </Button>
            <Button variant="ghost" size="lg" className="h-12 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10" onClick={onEnd} disabled={isEnding}>
              <PhoneOffIcon />
              End
            </Button>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Sets completed</span>
            <span className="tabular-nums text-muted-foreground">{done} of {planned}</span>
          </div>
          <Progress value={pct} aria-label={`${done} of ${planned} sets completed`} />
        </div>
      </section>

      {results.length > 0 ? (
        <SetResultsTable results={results} />
      ) : (
        <SectionCard title="Set results">
          <PanelEmpty
            icon={ActivityIcon}
            title="No sets finished yet"
            hint="When the patient finishes a set, reps, range and tempo appear here within a few seconds."
            className="py-8"
          />
        </SectionCard>
      )}
    </div>
  );
};
