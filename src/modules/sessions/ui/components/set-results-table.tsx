import { Badge } from "@/components/ui/badge";

import { SessionResults } from "../../types";
import { PainBadge } from "./pain-badge";

const STOP_LABEL: Record<string, string> = {
  completed: "completed", idle: "idle", stop_pressed: "stop pressed", pain: "pain", symptom: "symptom", disconnected: "disconnected",
};

/** One row per set: reps, peaks, tempo, score, pain and why it ended. */
export const SetResultsTable = ({ results }: { results: SessionResults }) => {
  return (
    <div className="bg-white rounded-lg border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground border-b">
          <tr className="text-left">
            <th className="p-3">#</th>
            <th className="p-3">Reps</th>
            <th className="p-3">Avg / best / lowest</th>
            <th className="p-3">Avg rep</th>
            <th className="p-3">Fast</th>
            <th className="p-3">Score</th>
            <th className="p-3">Pain</th>
            <th className="p-3">Ended</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.id} className="border-b last:border-0">
              <td className="p-3">{r.setIndex}</td>
              <td className="p-3">{r.repsDone}/{r.repsPlanned}</td>
              <td className="p-3">{Math.round(r.avgPeak)}° / {Math.round(r.bestPeak)}° / {Math.round(r.lowestPeak)}° <span className="text-muted-foreground">(target {r.targetAngle}°)</span></td>
              <td className="p-3">{r.avgRepSeconds.toFixed(1)} s</td>
              <td className="p-3">{r.fastReps}</td>
              <td className="p-3 font-medium">{Math.round(r.score)}</td>
              <td className="p-3">{r.pain === null ? <span className="text-muted-foreground">-</span> : <PainBadge pain={r.pain} />}</td>
              <td className="p-3"><Badge variant="outline">{STOP_LABEL[r.stopReason] ?? r.stopReason}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
