"use client";

import { formatDistanceToNow } from "date-fns";
import { CheckIcon, HandIcon, HeartPulseIcon, ShieldAlertIcon, UnplugIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { SessionGetOne } from "../../types";

type SafetyEvent = SessionGetOne["openSafetyEvents"][number];

const SYMPTOM: Record<string, string> = {
  dizziness: "dizziness",
  chest_pain: "chest pain",
  sharp_pain: "sharp pain",
};

const describe = (e: SafetyEvent) => {
  switch (e.kind) {
    case "pain": return { title: `Pain ${e.painScore ?? "?"}/10 reported`, icon: HeartPulseIcon, hint: "The set was stopped and the patient was asked to rest." };
    case "symptom": return {
      title: `Symptom reported: ${SYMPTOM[e.symptom ?? ""] ?? (e.symptom ?? "unspecified").replace(/_/g, " ")}`,
      icon: ShieldAlertIcon,
      hint: "The set was stopped and the patient was asked to rest. Check on the patient before continuing.",
    };
    case "stop": return { title: "Stop pressed", icon: HandIcon, hint: "Exercise was paused straight away." };
    default: return { title: "Coach disconnected", icon: UnplugIcon, hint: "Use Restart coach to resume from the next set." };
  }
};

/** Unacknowledged safety events: prominent rose banners, each with Acknowledge. */
export const SafetyAlerts = ({
  events, onAcknowledge, pendingId,
}: { events: SafetyEvent[]; onAcknowledge: (id: string) => void; pendingId?: string | null }) => {
  if (events.length === 0) return null;
  return (
    <section aria-label="Safety alerts" role="alert" className="flex flex-col gap-2">
      {events.map((e) => {
        const { title, icon: Icon, hint } = describe(e);
        return (
          <div
            key={e.id}
            className="flex flex-col gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 shadow-sm sm:flex-row sm:items-center"
          >
            <div className="flex flex-1 items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rose-600 text-white">
                <Icon className="size-5" aria-hidden />
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="font-semibold text-rose-800 dark:text-rose-200">
                  {title}{e.setIndex ? <span className="font-normal"> · set {e.setIndex}</span> : null}
                </p>
                <p className="text-sm text-rose-800/80 dark:text-rose-200/80">{hint}</p>
                <p className="text-xs text-rose-800/70 dark:text-rose-200/70">
                  {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })} · via {e.source}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/40 self-start sm:self-center"
              disabled={pendingId === e.id}
              onClick={() => onAcknowledge(e.id)}
            >
              <CheckIcon />
              {pendingId === e.id ? "Acknowledging…" : "Acknowledge"}
            </Button>
          </div>
        );
      })}
    </section>
  );
};
