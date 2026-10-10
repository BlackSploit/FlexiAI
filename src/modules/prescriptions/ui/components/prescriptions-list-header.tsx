"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon, SearchIcon, XCircleIcon } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { DEFAULT_PAGE } from "@/constants";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CommandSelect } from "@/components/command-select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
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
      <div className="py-4 px-4 md:px-8 flex flex-col gap-y-4">
        <div className="flex items-center justify-between">
          <h5 className="font-medium text-xl">Prescriptions</h5>
          <Button onClick={() => setIsDialogOpen(true)}>
            <PlusIcon />
            New Prescription
          </Button>
        </div>
        <ScrollArea>
          <div className="flex items-center gap-x-2 p-1">
            <div className="relative">
              <Input placeholder="Patient or exercise" className="h-9 bg-white w-[200px] pl-7" value={filters.search}
                onChange={(e) => setFilters({ search: e.target.value, page: DEFAULT_PAGE })} />
              <SearchIcon className="size-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            </div>
            <PatientIdFilter value={filters.patientId} onChange={(id) => setFilters({ patientId: id, page: DEFAULT_PAGE })} />
            <CommandSelect
              className="h-9"
              placeholder="Exercise"
              options={(exercises.data ?? []).map((e) => ({ id: e.id, value: e.id, children: e.nameEn }))}
              value={filters.exerciseId}
              onSelect={(id) => setFilters({ exerciseId: id, page: DEFAULT_PAGE })}
            />
            <CommandSelect
              className="h-9"
              placeholder="Active?"
              options={[{ id: "true", value: "true", children: "Active" }, { id: "false", value: "false", children: "Inactive" }]}
              value={filters.active === null ? "" : String(filters.active)}
              onSelect={(v) => setFilters({ active: v === "true", page: DEFAULT_PAGE })}
            />
            {isAnyFilterModified && (
              <Button variant="outline" size="sm"
                onClick={() => setFilters({ search: "", patientId: "", exerciseId: "", active: null, page: DEFAULT_PAGE })}>
                <XCircleIcon />
                Clear
              </Button>
            )}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    </>
  );
};
