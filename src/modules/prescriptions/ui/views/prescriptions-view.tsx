"use client";

import { useRouter } from "next/navigation";
import { useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { DataTable } from "@/components/data-table";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { DataPagination } from "@/components/data-pagination";

import { columns } from "../components/columns";
import { usePrescriptionsFilters } from "../../hooks/use-prescriptions-filters";

export const PrescriptionsView = () => {
  const router = useRouter();
  const trpc = useTRPC();
  const [filters, setFilters] = usePrescriptionsFilters();
  const { data } = useSuspenseQuery(trpc.prescriptions.getMany.queryOptions({ ...filters }));

  return (
    <div className="flex-1 pb-4 px-4 md:px-8 flex flex-col gap-y-4">
      <DataTable data={data.items} columns={columns} onRowClick={(row) => router.push(`/prescriptions/${row.id}`)} />
      <DataPagination page={filters.page} totalPages={data.totalPages} onPageChange={(page) => setFilters({ page })} />
      {data.items.length === 0 && (
        <EmptyState
          title="No prescriptions yet"
          description="Prescribe an exercise (target angle, reps, sets, tempo). The coach guides the patient through it on a video call."
        />
      )}
    </div>
  );
};

export const PrescriptionsViewLoading = () => (
  <LoadingState title="Loading Prescriptions" description="This may take a few seconds" />
);

export const PrescriptionsViewError = () => (
  <ErrorState title="Error Loading Prescriptions" description="Something went wrong" />
);
