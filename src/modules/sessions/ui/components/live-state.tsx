"use client";

import Link from "next/link";
import { AlertTriangleIcon, VideoIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { SessionGetOne, SessionResults } from "../../types";
import { SetResultsTable } from "./set-results-table";

interface Props {
  data: SessionGetOne;
  results: SessionResults;
  onAcknowledge: (id: string) => void;
}

const alertText = (e: SessionGetOne["openSafetyEvents"][number]) =>
  e.kind === "pain" ? `Pain ${e.painScore}/10 reported`
    : e.kind === "symptom" ? `Symptom reported: ${(e.symptom ?? "").replace("_", " ")}`
      : e.kind === "stop" ? "Stop pressed" : "Coach disconnected: use Restart coach";

export const LiveState = ({ data, results, onAcknowledge }: Props) => {
  return (
    <div className="flex flex-col gap-y-4">
      {data.openSafetyEvents.map((e) => (
        <Alert key={e.id} variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{alertText(e)}{e.setIndex ? ` (set ${e.setIndex})` : ""}</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-2">
            The set was stopped and the patient was asked to rest.
            <Button size="sm" variant="outline" onClick={() => onAcknowledge(e.id)}>Acknowledge</Button>
          </AlertDescription>
        </Alert>
      ))}
      <div className="bg-white rounded-lg px-4 py-5 flex flex-col gap-y-6 items-center justify-center">
        <EmptyState image="/upcoming.svg" title="Session is live" description="The coach is guiding the patient. Results appear here after each set." />
        <Button asChild>
          <Link href={`/call/${data.id}`}><VideoIcon />Join call</Link>
        </Button>
      </div>
      {results.length > 0 && <SetResultsTable results={results} />}
    </div>
  );
};
