"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon, SearchIcon, XIcon } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { DEFAULT_PAGE } from "@/constants";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CommandSelect } from "@/components/command-select";
import { PageHeader } from "@/modules/patients/ui/components/ui-kit";
import { PatientIdFilter } from "@/modules/patients/ui/components/patient-id-filter";

import { NewPrescriptionDialog } from "./new-prescription-dialog";
import { usePrescriptionsFilters } from "../../hooks/use-prescriptions-filters";

export const PrescriptionsListHeader = () => {
  const trpc = useTRPC();
  const [filters, setFilters] = usePrescriptionsFilters();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const exercises = useQuery(trpc.exercises.getMany.queryOptions());

  const isAnyFilterModified = !!filters.search || !!filters.patientId || !!filters.exerciseId || filters.active !== null;

  return (
    <>
      <NewPrescriptionDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />
      <PageHeader
        title="Prescriptions"
        description="Home exercise plans with a target bend angle, reps and tempo. Start a guided session from any active plan."
        action={
          <Button onClick={() => setIsDialogOpen(true)} className="w-full sm:w-auto">
            <PlusIcon />
            New prescription
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <label htmlFor="rx-search" className="sr-only">Search by patient or exercise</label>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="rx-search" type="search" placeholder="Search patient or exercise" className="h-10 bg-card pl-9"
              value={filters.search}
              onChange={(e) => setFilters({ search: e.target.value, page: DEFAULT_PAGE })} />
          </div>
          <PatientIdFilter value={filters.patientId} onChange={(id) => setFilters({ patientId: id, page: DEFAULT_PAGE })} />
          <CommandSelect
            className="h-10 bg-card"
            placeholder="Exercise"
            options={(exercises.data ?? []).map((e) => ({ id: e.id, value: e.id, children: e.nameEn }))}
            value={filters.exerciseId}
            onSelect={(id) => setFilters({ exerciseId: id, page: DEFAULT_PAGE })}
          />
          <CommandSelect
            className="h-10 bg-card"
            placeholder="Status"
            options={[{ id: "true", value: "true", children: "Active" }, { id: "false", value: "false", children: "Inactive" }]}
            value={filters.active === null ? "" : String(filters.active)}
            onSelect={(v) => setFilters({ active: v === "true", page: DEFAULT_PAGE })}
          />
          {isAnyFilterModified && (
            <Button variant="ghost" size="sm" className="text-muted-foreground"
              onClick={() => setFilters({ search: "", patientId: "", exerciseId: "", active: null, page: DEFAULT_PAGE })}>
              <XIcon />
              Clear filters
            </Button>
          )}
        </div>
      </PageHeader>
    </>
  );
};
