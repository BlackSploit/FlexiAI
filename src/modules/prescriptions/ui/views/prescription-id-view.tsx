"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDaysIcon,
  CameraIcon,
  ChevronRightIcon,
  InfoIcon,
  MoreVerticalIcon,
  PencilIcon,
  RepeatIcon,
  TargetIcon,
  TimerIcon,
  TrashIcon,
  TrendingUpIcon,
  VideoIcon,
} from "lucide-react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RomTrendChart } from "@/modules/analytics/ui/components/rom-trend-chart";
import {
  ActiveBadge,
  DetailSkeleton,
  EmptyPanel,
  ErrorPanel,
  InlineSkeleton,
  SectionCard,
  SessionList,
} from "@/modules/patients/ui/components/ui-kit";

import { StartSessionButton } from "../components/start-session-button";
import { UpdatePrescriptionDialog } from "../components/update-prescription-dialog";

interface Props {
  prescriptionId: string;
  replayClip?: string;            // first AGENT_REPLAY_CLIPS entry, provided by the server page
}

const Spec = ({ icon: Icon, label, value, hint }: {
  icon: typeof TargetIcon; label: string; value: React.ReactNode; hint?: string;
}) => (
  <div className="flex items-start gap-3 rounded-lg border bg-background p-3">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
      <Icon className="size-4" aria-hidden />
    </span>
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold tabular-nums leading-tight">{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  </div>
);

export const PrescriptionIdView = ({ prescriptionId, replayClip }: Props) => {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { data } = useSuspenseQuery(trpc.prescriptions.getOne.queryOptions({ id: prescriptionId }));
  const sessions = useSuspenseQuery(trpc.sessions.getMany.queryOptions({ prescriptionId, pageSize: 20 }));

  const remove = useMutation(trpc.prescriptions.remove.mutationOptions({
    onSuccess: async (res) => {
      await queryClient.invalidateQueries(trpc.prescriptions.getMany.queryOptions({}));
      if (res.deactivated) {
        toast.info("The prescription has sessions, so it was deactivated instead of deleted.");
        await queryClient.invalidateQueries(trpc.prescriptions.getOne.queryOptions({ id: prescriptionId }));
      } else {
        toast.success("Prescription deleted");
        router.push("/prescriptions");
      }
    },
    onError: (e) => toast.error(e.message),
  }));
  const [RemoveConfirmation, confirmRemove] = useConfirm(
    "Delete this prescription?",
    data.sessionCount > 0
      ? "It has session history, so it will be deactivated instead. Past results are kept."
      : "This prescription will be permanently removed.",
  );

  const ex = data.exercise;
  const sideLabel = data.side === "auto" ? "Auto" : data.side === "left" ? "Left" : "Right";

  return (
    <>
      <RemoveConfirmation />
      <UpdatePrescriptionDialog open={editOpen} onOpenChange={setEditOpen} initialValues={data} />
      <div className="flex-1 px-4 py-6 md:px-8 flex flex-col gap-y-6">
        <div className="flex items-center justify-between gap-2">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            <Link href="/prescriptions" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Prescriptions
            </Link>
            <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />
            <Link href={`/patients/${data.patient.id}`} className="truncate rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {data.patient.name}
            </Link>
            <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate font-medium text-foreground" aria-current="page">{ex.nameEn}</span>
          </nav>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Prescription actions"><MoreVerticalIcon /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setEditOpen(true)}><PencilIcon className="size-4" />Edit plan</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={remove.isPending}
                onClick={async () => (await confirmRemove()) && remove.mutate({ id: prescriptionId })}>
                <TrashIcon className="size-4" />{data.sessionCount > 0 ? "Deactivate" : "Delete"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5 md:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <ActiveBadge active={data.active} />
                  <span className="inline-flex items-center gap-1 rounded-full border bg-background/70 px-2 py-0.5 text-xs text-muted-foreground">
                    <CameraIcon className="size-3" aria-hidden />
                    {ex.cameraView === "front" ? "Camera facing the patient" : "Camera side-on"}
                  </span>
                </div>
                <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{ex.nameEn}</h1>
                <p lang="ml" className="font-ml mt-1 text-lg text-muted-foreground">{ex.nameMl}</p>
                <Link href={`/patients/${data.patient.id}`}
                  className="mt-3 inline-flex items-center gap-2 rounded-full border bg-background/70 py-1 pl-1 pr-3 text-sm hover:bg-background">
                  <GeneratedAvatar variant="initials" seed={data.patient.name} className="size-6" />
                  {data.patient.name}
                </Link>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row lg:flex-col lg:items-stretch">
                {data.active ? (
                  <>
                    <StartSessionButton size="lg" prescriptionId={data.id} patient={data.patient} />
                    {replayClip && <StartSessionButton size="lg" prescriptionId={data.id} patient={data.patient} mode="replay" clip={replayClip} />}
                    <p className="text-xs text-muted-foreground lg:max-w-56">
                      Creates a one-time join link to send the patient. No video is recorded.
                    </p>
                  </>
                ) : (
                  <div className="flex items-start gap-2 rounded-lg border bg-background/70 p-3 text-sm text-muted-foreground lg:max-w-64">
                    <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>This plan is inactive. <button type="button" className="font-medium text-primary hover:underline" onClick={() => setEditOpen(true)}>Edit it</button> and switch it on to start sessions.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-5 border-t p-5 md:p-6">
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <Spec icon={TargetIcon} label="Target angle" value={`${data.targetAngle}°`} hint={`Minimum counted ${ex.minPeak}°`} />
              <Spec icon={RepeatIcon} label="Reps × sets" value={`${data.reps} × ${data.sets}`} />
              <Spec icon={TimerIcon} label="Tempo" value={`≥ ${data.minSecondsPerRep}s`} hint="per rep" />
              <Spec icon={CalendarDaysIcon} label="Frequency" value={`${data.sessionsPerWeek}× / week`} />
              <Spec icon={CameraIcon} label="Side" value={sideLabel} hint={data.side === "auto" ? "Best visible side" : undefined} />
            </dl>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg bg-muted/40 p-4">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">How to</p>
                <p className="text-sm leading-relaxed">{ex.howToEn}</p>
              </div>
              <div className="rounded-lg bg-muted/40 p-4">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Coach says (Malayalam)</p>
                <p lang="ml" className="font-ml text-sm leading-relaxed">{ex.howToMl}</p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-5">
          <SectionCard className="lg:col-span-3 min-w-0" title="Range of motion trend"
            description="Average peak angle for this exercise, last 30 days." icon={TrendingUpIcon}>
            <Suspense fallback={<InlineSkeleton className="h-56" />}>
              <RomTrendChart patientId={data.patient.id} prescriptionId={data.id} />
            </Suspense>
          </SectionCard>
          <SectionCard className="lg:col-span-2 min-w-0" title="Session history"
            description={`${data.sessionCount} ${data.sessionCount === 1 ? "session" : "sessions"} on this plan`} icon={VideoIcon}>
            {sessions.data.items.length === 0 ? (
              <EmptyPanel
                className="py-8"
                icon={VideoIcon}
                title="No sessions yet"
                description={data.active
                  ? "Start a guided session above. Rep counts, scores and pain reports show up here."
                  : "Activate this plan to start guided sessions."}
              />
            ) : (
              <SessionList items={sessions.data.items} showExercise={false} />
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
};

export const PrescriptionIdViewLoading = () => <DetailSkeleton />;

export const PrescriptionIdViewError = () => (
  <ErrorPanel
    title="Couldn’t load this prescription"
    description="It may have been deleted, or the connection dropped. Go back to prescriptions or try again."
  />
);
