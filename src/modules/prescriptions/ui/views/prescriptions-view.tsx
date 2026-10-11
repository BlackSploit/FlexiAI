"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ClipboardPlusIcon, SearchXIcon } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from "@/constants";
import { Button } from "@/components/ui/button";
import { EmptyPanel, ErrorPanel, ListPagination, ListTable, TableSkeleton } from "@/modules/patients/ui/components/ui-kit";

import { columns } from "../components/columns";
import { NewPrescriptionDialog } from "../components/new-prescription-dialog";
import { usePrescriptionsFilters } from "../../hooks/use-prescriptions-filters";

export const PrescriptionsView = () => {
  const router = useRouter();
  const trpc = useTRPC();
  const [filters, setFilters] = usePrescriptionsFilters();
  const [newOpen, setNewOpen] = useState(false);
  const { data } = useSuspenseQuery(trpc.prescriptions.getMany.queryOptions({ ...filters }));

  const filtered = !!filters.search || !!filters.patientId || !!filters.exerciseId || filters.active !== null;

  if (data.items.length === 0) {
    return (
      <div className="flex-1 px-4 pb-8 md:px-8">
        <NewPrescriptionDialog open={newOpen} onOpenChange={setNewOpen} />
        <div className="rounded-xl border border-dashed bg-card">
          {filtered ? (
            <EmptyPanel
              icon={SearchXIcon}
              title="No prescriptions match these filters"
              description="Try a different patient, exercise or status, or clear the filters to see every plan."
              action={
                <Button variant="outline"
                  onClick={() => setFilters({ search: "", patientId: "", exerciseId: "", active: null, page: DEFAULT_PAGE })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyPanel
              icon={ClipboardPlusIcon}
              title="No prescriptions yet"
              description="Prescribe an exercise with a target angle, reps, sets and tempo. The coach guides the patient through it on a video call."
              action={
                <Button onClick={() => setNewOpen(true)}>
                  <ClipboardPlusIcon />
                  New prescription
                </Button>
              }
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 px-4 pb-8 md:px-8 flex flex-col gap-y-4">
      <ListTable
        data={data.items}
        columns={columns}
        onRowClick={(row) => router.push(`/prescriptions/${row.id}`)}
        getRowLabel={(row) => `Open ${row.exercise.nameEn} for ${row.patient.name}`}
      />
      <ListPagination
        page={filters.page}
        pageSize={DEFAULT_PAGE_SIZE}
        total={data.total}
        totalPages={data.totalPages}
        noun={data.total === 1 ? "prescription" : "prescriptions"}
        onPageChange={(page) => setFilters({ page })}
      />
    </div>
  );
};

export const PrescriptionsViewLoading = () => (
  <div className="flex-1 px-4 pb-8 md:px-8">
    <TableSkeleton rows={6} cols={5} />
  </div>
);

export const PrescriptionsViewError = () => (
  <ErrorPanel
    title="Couldn’t load prescriptions"
    description="Something went wrong while fetching the list. Check your connection and try again."
  />
);
