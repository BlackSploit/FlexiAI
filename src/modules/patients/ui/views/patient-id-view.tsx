"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  ActivityIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  ClipboardPlusIcon,
  HeartPulseIcon,
  NotebookPenIcon,
  SparklesIcon,
  TrendingUpIcon,
  VideoIcon,
} from "lucide-react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { PAIN_ALERT_THRESHOLD } from "@/constants";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm";
import { RomTrendChart } from "@/modules/analytics/ui/components/rom-trend-chart";
import { WeeklySummaryCard } from "@/modules/analytics/ui/components/weekly-summary-card";
import { PhysioNotes } from "@/modules/notes/ui/components/physio-notes";
import { StartSessionButton } from "@/modules/prescriptions/ui/components/start-session-button";
import { NewPrescriptionDialog } from "@/modules/prescriptions/ui/components/new-prescription-dialog";

import { UpdatePatientDialog } from "../components/update-patient-dialog";
import { PatientIdViewHeader } from "../components/patient-id-view-header";
import {
  ActiveBadge,
  DetailSkeleton,
  EmptyPanel,
  ErrorPanel,
  InlineSkeleton,
  SectionCard,
  SessionList,
  StatTile,
} from "../components/ui-kit";

interface Props {
  patientId: string;
};

export const PatientIdView = ({ patientId }: Props) => {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [newRxOpen, setNewRxOpen] = useState(false);

  const { data } = useSuspenseQuery(trpc.patients.getOne.queryOptions({ id: patientId }));
  const rx = useSuspenseQuery(trpc.prescriptions.getMany.queryOptions({ patientId, pageSize: 50 }));
  const sessions = useSuspenseQuery(trpc.sessions.getMany.queryOptions({ patientId, pageSize: 10 }));

  const removePatient = useMutation(
    trpc.patients.remove.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.patients.getMany.queryOptions({}));
        toast.success(`${data.name} was removed`);
        router.push("/patients");
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const [RemoveConfirmation, confirmRemove] = useConfirm(
    "Delete this patient?",
    `This permanently removes ${data.name}, their prescriptions, notes and ${data.sessionCount} ${data.sessionCount === 1 ? "session" : "sessions"} with results. This cannot be undone.`,
  );

  const handleRemove = async () => {
    if (!(await confirmRemove())) return;
    await removePatient.mutateAsync({ id: patientId });
  };

  const contact = { name: data.name, phone: data.phone, email: data.email };
  const activeRx = rx.data.items.filter((p) => p.active);
  const inactiveRx = rx.data.items.filter((p) => !p.active);
  const orderedRx = [...activeRx, ...inactiveRx];
  const painHigh = data.latestPain !== null && data.latestPain >= PAIN_ALERT_THRESHOLD;

  return (
    <>
      <RemoveConfirmation />
      <UpdatePatientDialog open={editOpen} onOpenChange={setEditOpen} initialValues={data} />
      <NewPrescriptionDialog open={newRxOpen} onOpenChange={setNewRxOpen} defaultPatientId={patientId} />
      <div className="flex-1 px-4 py-6 md:px-8 flex flex-col gap-y-6">
        <PatientIdViewHeader
          patient={data}
          onEdit={() => setEditOpen(true)}
          onNewPrescription={() => setNewRxOpen(true)}
          onRemove={handleRemove}
          isRemoving={removePatient.isPending}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <StatTile label="Active plans" icon={ClipboardListIcon} value={data.activePrescriptionCount}
            hint={inactiveRx.length > 0 ? `${inactiveRx.length} inactive` : "Prescribed exercises"} />
          <StatTile label="Sessions" icon={VideoIcon} value={data.sessionCount} hint="Guided calls so far" />
          <StatTile label="Last session" icon={ActivityIcon}
            value={data.lastSessionAt ? formatDistanceToNow(new Date(data.lastSessionAt)) : "—"}
            hint={data.lastSessionAt ? "ago" : "No sessions yet"} />
          <StatTile label="Latest pain" icon={HeartPulseIcon}
            value={data.latestPain === null ? "—" : (
              <span className={painHigh ? "text-rose-600 dark:text-rose-400" : undefined}>
                {data.latestPain}<span className="text-sm font-normal text-muted-foreground">/10</span>
              </span>
            )}
            hint={data.latestPain === null ? "Not reported" : painHigh ? "Above alert threshold" : "Patient-reported"} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2 min-w-0">
            <SectionCard
              title="Prescriptions"
              description="Exercises the coach guides this patient through."
              icon={ClipboardListIcon}
              contentClassName={orderedRx.length ? "p-0" : undefined}
              action={orderedRx.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => setNewRxOpen(true)}>
                  <ClipboardPlusIcon />
                  <span className="hidden sm:inline">Add</span>
                </Button>
              )}
            >
              {orderedRx.length === 0 ? (
                <EmptyPanel
                  className="py-8"
                  icon={ClipboardPlusIcon}
                  title="No prescriptions yet"
                  description="Choose an exercise, a target bend angle and reps. Then start a guided session from here."
                  action={
                    <Button onClick={() => setNewRxOpen(true)}>
                      <ClipboardPlusIcon />
                      New prescription
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y">
                  {orderedRx.map((p) => (
                    <li key={p.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                      <Link
                        href={`/prescriptions/${p.id}`}
                        className="group flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <ActivityIcon className="size-5" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium group-hover:underline">{p.exercise.nameEn}</span>
                            <ActiveBadge active={p.active} />
                          </div>
                          <p lang="ml" className="font-ml truncate text-xs text-muted-foreground">{p.exercise.nameMl}</p>
                          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                            Target {p.targetAngle}° · {p.reps} reps × {p.sets} {p.sets === 1 ? "set" : "sets"} · ≥{p.minSecondsPerRep}s/rep · {p.sessionsPerWeek}×/week
                          </p>
                        </div>
                        <ChevronRightIcon className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
                      </Link>
                      {p.active && (
                        <div className="sm:pl-2">
                          <StartSessionButton size="sm" label="Start session" prescriptionId={p.id} patient={contact} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title="Range of motion" description="Average peak bend angle per session, last 30 days." icon={TrendingUpIcon}>
              <Suspense fallback={<InlineSkeleton className="h-56" />}>
                <RomTrendChart patientId={patientId} />
              </Suspense>
            </SectionCard>

            <SectionCard
              title="Recent sessions"
              description="The last 10 guided calls."
              icon={VideoIcon}
              action={sessions.data.total > sessions.data.items.length && (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/sessions?patientId=${patientId}`}>View all</Link>
                </Button>
              )}
            >
              {sessions.data.items.length === 0 ? (
                <EmptyPanel
                  className="py-8"
                  icon={VideoIcon}
                  title="No sessions yet"
                  description={activeRx.length
                    ? "Start a guided session from a prescription above. Results appear here when it ends."
                    : "Add a prescription first, then start a guided session."}
                />
              ) : (
                <SessionList items={sessions.data.items} />
              )}
            </SectionCard>
          </div>

          <div className="flex flex-col gap-6 min-w-0">
            <SectionCard title="This week" description="Progress summary you can share." icon={SparklesIcon}>
              <Suspense fallback={<InlineSkeleton />}>
                <WeeklySummaryCard patientId={patientId} />
              </Suspense>
            </SectionCard>
            <SectionCard title="Physio notes" description="Private to you. Patients never see these." icon={NotebookPenIcon}>
              <Suspense fallback={<InlineSkeleton className="h-28" />}>
                <PhysioNotes patientId={patientId} />
              </Suspense>
            </SectionCard>
          </div>
        </div>
      </div>
    </>
  );
};

export const PatientIdViewLoading = () => {
  return <DetailSkeleton />;
};

export const PatientIdViewError = () => {
  return (
    <ErrorPanel
      title="Couldn’t load this patient"
      description="The patient may have been removed, or the connection dropped. Go back to your patients or try again."
    />
  )
}
