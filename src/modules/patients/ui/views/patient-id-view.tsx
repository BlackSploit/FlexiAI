"use client";

import { toast } from "sonner";
import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { MailIcon, PhoneIcon, VideoIcon } from "lucide-react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/hooks/use-confirm";
import { DataTable } from "@/components/data-table";
import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { RomTrendChart } from "@/modules/analytics/ui/components/rom-trend-chart";
import { WeeklySummaryCard } from "@/modules/analytics/ui/components/weekly-summary-card";
import { PhysioNotes } from "@/modules/notes/ui/components/physio-notes";
import { columns as sessionColumns } from "@/modules/sessions/ui/components/columns";
import { StartSessionButton } from "@/modules/prescriptions/ui/components/start-session-button";
import { NewPrescriptionDialog } from "@/modules/prescriptions/ui/components/new-prescription-dialog";

import { isPlaceholderEmail } from "../../schemas";
import { UpdatePatientDialog } from "../components/update-patient-dialog";
import { PatientIdViewHeader } from "../components/patient-id-view-header";

interface Props {
  patientId: string;
};

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="bg-white rounded-lg border p-4 flex flex-col gap-y-3">
    <p className="font-medium">{title}</p>
    {children}
  </div>
);

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
        router.push("/patients");
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const [RemoveConfirmation, confirmRemove] = useConfirm(
    "Are you sure?",
    `This removes ${data.name} and ${data.sessionCount} ${data.sessionCount === 1 ? "session" : "sessions"} with their results.`,
  );

  const handleRemove = async () => {
    if (!(await confirmRemove())) return;
    await removePatient.mutateAsync({ id: patientId });
  };

  const contact = { name: data.name, phone: data.phone, email: data.email };

  return (
    <>
      <RemoveConfirmation />
      <UpdatePatientDialog open={editOpen} onOpenChange={setEditOpen} initialValues={data} />
      <NewPrescriptionDialog open={newRxOpen} onOpenChange={setNewRxOpen} defaultPatientId={patientId} />
      <div className="flex-1 py-4 px-4 md:px-8 flex flex-col gap-y-4">
        <PatientIdViewHeader
          patientId={patientId}
          patientName={data.name}
          onEdit={() => setEditOpen(true)}
          onNewPrescription={() => setNewRxOpen(true)}
          onRemove={handleRemove}
        />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <div className="bg-white rounded-lg border p-4 flex flex-wrap items-center gap-4">
              <GeneratedAvatar variant="initials" seed={data.name} className="size-12" />
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl font-medium">{data.name}</h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {data.phone && <span className="flex items-center gap-1"><PhoneIcon className="size-3.5" />{data.phone}</span>}
                  {data.email && !isPlaceholderEmail(data.email) && (
                    <span className="flex items-center gap-1"><MailIcon className="size-3.5" />{data.email}</span>
                  )}
                  <span>{data.preferredLanguage === "ml" ? "Malayalam" : "English"}</span>
                </div>
              </div>
              <Badge variant="outline" className="flex items-center gap-x-2 [&>svg]:size-4">
                <VideoIcon className="text-blue-700" />
                {data.sessionCount} {data.sessionCount === 1 ? "session" : "sessions"}
              </Badge>
            </div>

            <Card title="Prescriptions">
              {rx.data.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No prescriptions yet. Use the menu to add one.</p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {rx.data.items.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <button className="text-left" onClick={() => router.push(`/prescriptions/${p.id}`)}>
                        <p className="font-medium">{p.exercise.nameEn}
                          {!p.active && <Badge variant="outline" className="ml-2">inactive</Badge>}</p>
                        <p className="text-sm text-muted-foreground">
                          {p.targetAngle}° · {p.reps} × {p.sets} · ≥{p.minSecondsPerRep}s · {p.sessionsPerWeek}/week
                        </p>
                      </button>
                      {p.active && <StartSessionButton size="sm" label="Start" prescriptionId={p.id} patient={contact} />}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Range of motion (last 30 days)">
              <Suspense fallback={<p className="text-sm text-muted-foreground">Loading chart…</p>}>
                <RomTrendChart patientId={patientId} />
              </Suspense>
            </Card>

            <Card title="Recent sessions">
              <DataTable data={sessions.data.items} columns={sessionColumns} onRowClick={(row) => router.push(`/sessions/${row.id}`)} />
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card title="Weekly summary">
              <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
                <WeeklySummaryCard patientId={patientId} />
              </Suspense>
            </Card>
            <Card title="Notes">
              <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
                <PhysioNotes patientId={patientId} />
              </Suspense>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
};

export const PatientIdViewLoading = () => {
  return (
    <LoadingState
      title="Loading Patient"
      description="This may take a few seconds"
    />
  );
};

export const PatientIdViewError = () => {
  return (
    <ErrorState
      title="Error Loading Patient"
      description="Something went wrong"
    />
  )
}
