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
import { useSessionsFilters } from "../../hooks/use-sessions-filters";

export const SessionsView = () => {
  const trpc = useTRPC();
  const router = useRouter();
  const [filters, setFilters] = useSessionsFilters();
  const { data } = useSuspenseQuery(trpc.sessions.getMany.queryOptions({ ...filters }));

  return (
    <div className="flex-1 pb-4 px-4 md:px-8 flex flex-col gap-y-4">
      <DataTable data={data.items} columns={columns} onRowClick={(row) => router.push(`/sessions/${row.id}`)} />
      <DataPagination page={filters.page} totalPages={data.totalPages} onPageChange={(page) => setFilters({ page })} />
      {data.items.length === 0 && (
        <EmptyState
          title="No sessions yet"
          description="Open a prescription and click Start guided session. The coach joins the call and the patient gets a link."
        />
      )}
    </div>
  );
};

export const SessionsViewLoading = () => (
  <LoadingState title="Loading Sessions" description="This may take a few seconds" />
);

export const SessionsViewError = () => (
  <ErrorState title="Error Loading Sessions" description="Something went wrong" />
);
