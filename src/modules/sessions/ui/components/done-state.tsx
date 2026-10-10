"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { BarChart3Icon, BookOpenTextIcon, ClockFadingIcon, ListIcon, NotebookPenIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/utils";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PhysioNotes } from "@/modules/notes/ui/components/physio-notes";

import { SessionGetOne, SessionResults } from "../../types";
import { PainBadge } from "./pain-badge";
import { RepChart } from "./rep-chart";
import { SetResultsTable } from "./set-results-table";

const tabClass = "text-muted-foreground rounded-none bg-background data-[state=active]:shadow-none border-b-2 border-transparent data-[state=active]:border-b-primary data-[state=active]:text-accent-foreground h-full hover:text-accent-foreground";

export const DoneState = ({ data, results }: { data: SessionGetOne; results: SessionResults }) => {
  const [lang, setLang] = useState<"en" | "ml">("en");
  return (
    <Tabs defaultValue="summary" className="flex flex-col gap-y-4">
      <div className="bg-white rounded-lg border px-3">
        <ScrollArea>
          <TabsList className="p-0 bg-background justify-start rounded-none h-13">
            <TabsTrigger value="summary" className={tabClass}><BookOpenTextIcon />Summary</TabsTrigger>
            <TabsTrigger value="sets" className={tabClass}><ListIcon />Sets</TabsTrigger>
            <TabsTrigger value="reps" className={tabClass}><BarChart3Icon />Reps</TabsTrigger>
            <TabsTrigger value="notes" className={tabClass}><NotebookPenIcon />Notes</TabsTrigger>
          </TabsList>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      <TabsContent value="summary" className="flex flex-col gap-y-4">
        <div className="bg-white rounded-lg border p-5 flex flex-col gap-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <GeneratedAvatar variant="initials" seed={data.patient.name} className="size-8" />
            <Link href={`/patients/${data.patient.id}`} className="text-lg font-medium hover:underline">{data.patient.name}</Link>
            <span className="text-muted-foreground">· {data.exercise.nameEn}</span>
            {data.mode === "replay" && <Badge variant="secondary">replay</Badge>}
            <Badge variant="outline" className="flex items-center gap-x-2 [&>svg]:size-4">
              <ClockFadingIcon className="text-blue-700" />
              {data.duration ? formatDuration(data.duration) : "No duration"}
            </Badge>
          </div>
          {results.map((r) => (
            <div key={r.id} className="rounded-md border p-4 flex flex-col gap-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">Set {r.setIndex}</p>
                <Badge variant="outline">score {Math.round(r.score)}</Badge>
                <Badge variant="outline">{r.feedbackSource === "llm" ? "AI note" : "Rule note"}</Badge>
                <PainBadge pain={r.pain} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div><p className="text-muted-foreground">Avg peak</p><p className="font-medium">{Math.round(r.avgPeak)}° of {r.targetAngle}°</p></div>
                <div><p className="text-muted-foreground">Best / lowest</p><p className="font-medium">{Math.round(r.bestPeak)}° / {Math.round(r.lowestPeak)}°</p></div>
                <div><p className="text-muted-foreground">Reps</p><p className="font-medium">{r.repsDone}/{r.repsPlanned}</p></div>
                <div><p className="text-muted-foreground">Too fast</p><p className="font-medium">{r.fastReps}</p></div>
              </div>
              {lang === "en"
                ? <p className="text-sm leading-relaxed">{r.feedbackEn}</p>
                : <p lang="ml" className="font-ml leading-relaxed">{r.feedbackMl}</p>}
            </div>
          ))}
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setLang(lang === "en" ? "ml" : "en")}>
            {lang === "en" ? <span lang="ml" className="font-ml">മലയാളത്തിൽ കാണുക</span> : "Show in English"}
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="sets"><SetResultsTable results={results} /></TabsContent>

      <TabsContent value="reps" className="flex flex-col gap-y-4">
        {results.map((r) => (
          <div key={r.id} className="bg-white rounded-lg border p-4">
            <p className="font-medium mb-2">Set {r.setIndex}</p>
            <RepChart perRep={r.perRep} targetAngle={r.targetAngle} />
          </div>
        ))}
      </TabsContent>

      <TabsContent value="notes">
        <div className="bg-white rounded-lg border p-4">
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
            <PhysioNotes patientId={data.patient.id} />
          </Suspense>
        </div>
      </TabsContent>
    </Tabs>
  );
};
