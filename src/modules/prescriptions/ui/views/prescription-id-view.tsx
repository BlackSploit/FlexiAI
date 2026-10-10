"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRightIcon, MoreVerticalIcon, PencilIcon, TrashIcon } from "lucide-react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm";
import { DataTable } from "@/components/data-table";
import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { columns as sessionColumns } from "@/modules/sessions/ui/components/columns";

import { StartSessionButton } from "../components/start-session-button";
import { UpdatePrescriptionDialog } from "../components/update-prescription-dialog";

interface Props {
  prescriptionId: string;
  replayClip?: string;            // first AGENT_REPLAY_CLIPS entry, provided by the server page
}

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
        router.push("/prescriptions");
      }
    },
    onError: (e) => toast.error(e.message),
  }));
  const [RemoveConfirmation, confirmRemove] = useConfirm("Are you sure?", "This prescription will be removed (or deactivated if it has sessions).");

  const ex = data.exercise;

  return (
    <>
      <RemoveConfirmation />
      <UpdatePrescriptionDialog open={editOpen} onOpenChange={setEditOpen} initialValues={data} />
      <div className="flex-1 py-4 px-4 md:px-8 flex flex-col gap-y-4">
        <div className="flex items-center justify-between">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild className="font-medium text-xl"><Link href="/prescriptions">Prescriptions</Link></BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="text-foreground text-xl font-medium [&>svg]:size-4"><ChevronRightIcon /></BreadcrumbSeparator>
              <BreadcrumbItem>
                <BreadcrumbLink asChild className="font-medium text-xl text-foreground">
                  <Link href={`/patients/${data.patient.id}`}>{data.patient.name}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild><Button variant="ghost"><MoreVerticalIcon /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditOpen(true)}><PencilIcon className="size-4 text-black" />Edit</DropdownMenuItem>
              <DropdownMenuItem onClick={async () => (await confirmRemove()) && remove.mutate({ id: prescriptionId })}>
                <TrashIcon className="size-4 text-black" />Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="bg-white rounded-lg border p-5 flex flex-col gap-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-medium">{ex.nameEn}</h2>
              <p lang="ml" className="font-ml text-muted-foreground">{ex.nameMl}</p>
            </div>
            <Badge variant={data.active ? "default" : "outline"}>{data.active ? "Active" : "Inactive"}</Badge>
          </div>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div><dt className="text-muted-foreground">Target</dt><dd className="font-medium">{data.targetAngle}°</dd></div>
            <div><dt className="text-muted-foreground">Reps × sets</dt><dd className="font-medium">{data.reps} × {data.sets}</dd></div>
            <div><dt className="text-muted-foreground">Min per rep</dt><dd className="font-medium">{data.minSecondsPerRep} s</dd></div>
            <div><dt className="text-muted-foreground">Side</dt><dd className="font-medium capitalize">{data.side}</dd></div>
            <div><dt className="text-muted-foreground">Sessions / week</dt><dd className="font-medium">{data.sessionsPerWeek}</dd></div>
            <div><dt className="text-muted-foreground">Camera</dt><dd className="font-medium">{ex.cameraView === "front" ? "Facing" : "Side-on"}</dd></div>
          </dl>
          <div className="text-sm flex flex-col gap-y-1">
            <p>{ex.howToEn}</p>
            <p lang="ml" className="font-ml leading-relaxed">{ex.howToMl}</p>
          </div>
          {data.active && (
            <div className="flex flex-wrap gap-2">
              <StartSessionButton size="lg" prescriptionId={data.id} patient={data.patient} />
              {replayClip && <StartSessionButton size="lg" prescriptionId={data.id} patient={data.patient} mode="replay" clip={replayClip} />}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg border p-4 flex flex-col gap-y-3">
          <p className="font-medium">Sessions</p>
          <DataTable data={sessions.data.items} columns={sessionColumns} onRowClick={(row) => router.push(`/sessions/${row.id}`)} />
        </div>
      </div>
    </>
  );
};

export const PrescriptionIdViewLoading = () => (
  <LoadingState title="Loading Prescription" description="This may take a few seconds" />
);

export const PrescriptionIdViewError = () => (
  <ErrorState title="Error Loading Prescription" description="Something went wrong" />
);
