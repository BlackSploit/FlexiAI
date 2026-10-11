"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PlusIcon, SearchXIcon, UsersIcon } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from "@/constants";
import { Button } from "@/components/ui/button";

import { columns } from "../components/columns";
import { NewPatientDialog } from "../components/new-patient-dialog";
import { usePatientsFilters } from "../../hooks/use-patients-filters";
import { EmptyPanel, ErrorPanel, ListPagination, ListTable, TableSkeleton } from "../components/ui-kit";

export const PatientsView = () => {
  const router = useRouter();
  const [filters, setFilters] = usePatientsFilters();
  const [newOpen, setNewOpen] = useState(false);

  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.patients.getMany.queryOptions({
    ...filters,
  }));

  if (data.items.length === 0) {
    return (
      <div className="flex-1 px-4 pb-8 md:px-8">
        <NewPatientDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => id && router.push(`/patients/${id}`)} />
        <div className="rounded-xl border border-dashed bg-card">
          {filters.search ? (
            <EmptyPanel
              icon={SearchXIcon}
              title="No patients match your search"
              description={`Nothing found for “${filters.search}”. Check the spelling or search by phone number.`}
              action={
                <Button variant="outline" onClick={() => setFilters({ search: "", page: DEFAULT_PAGE })}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <EmptyPanel
              icon={UsersIcon}
              title="Add your first patient"
              description="Add a patient, prescribe an exercise, and start a guided session. The coach counts reps and checks range of motion while you watch."
              action={
                <Button onClick={() => setNewOpen(true)}>
                  <PlusIcon />
                  New patient
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
        onRowClick={(row) => router.push(`/patients/${row.id}`)}
        getRowLabel={(row) => `Open ${row.name}`}
      />
      <ListPagination
        page={filters.page}
        pageSize={DEFAULT_PAGE_SIZE}
        total={data.total}
        totalPages={data.totalPages}
        noun={data.total === 1 ? "patient" : "patients"}
        onPageChange={(page) => setFilters({ page })}
      />
    </div>
  );
};

export const PatientsViewLoading = () => {
  return (
    <div className="flex-1 px-4 pb-8 md:px-8">
      <TableSkeleton rows={6} cols={4} />
    </div>
  );
};

export const PatientsViewError = () => {
  return (
    <ErrorPanel
      title="Couldn’t load your patients"
      description="Something went wrong while fetching the list. Check your connection and try again."
    />
  )
}
