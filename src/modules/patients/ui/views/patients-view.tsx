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
import { usePatientsFilters } from "../../hooks/use-patients-filters";

export const PatientsView = () => {
  const router = useRouter();
  const [filters, setFilters] = usePatientsFilters();

  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.patients.getMany.queryOptions({
    ...filters,
  }));

  return (
    <div className="flex-1 pb-4 px-4 md:px-8 flex flex-col gap-y-4">
      <DataTable
        data={data.items}
        columns={columns}
        onRowClick={(row) => router.push(`/patients/${row.id}`)}
      />
      <DataPagination
        page={filters.page}
        totalPages={data.totalPages}
        onPageChange={(page) => setFilters({ page })}
      />
      {data.items.length === 0 && (
        <EmptyState
          title="Add your first patient"
          description="Add a patient, give them a prescription, and start a guided session. The coach counts reps and checks range of motion while you watch the data."
        />
      )}
    </div>
  );
};

export const PatientsViewLoading = () => {
  return (
    <LoadingState
      title="Loading Patients"
      description="This may take a few seconds"
    />
  );
};

export const PatientsViewError = () => {
  return (
    <ErrorState
      title="Error Loading Patients"
      description="Something went wrong"
    />
  )
}
