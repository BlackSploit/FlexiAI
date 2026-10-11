"use client";

import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";

import { DEFAULT_PAGE } from "@/constants";
import { Button } from "@/components/ui/button";

import { PageHeader } from "./ui-kit";
import { NewPatientDialog } from "./new-patient-dialog";
import { PatientsSearchFilter } from "./patients-search-filter";
import { usePatientsFilters } from "../../hooks/use-patients-filters";

export const PatientsListHeader = () => {
  const [filters, setFilters] = usePatientsFilters();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const isAnyFilterModified = !!filters.search;

  const onClearFilters = () => {
    setFilters({
      search: "",
      page: DEFAULT_PAGE,
    });
  }

  return (
    <>
      <NewPatientDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />
      <PageHeader
        title="Patients"
        description="Everyone you prescribe home exercises to. Open a patient to see their plans, sessions and progress."
        action={
          <Button onClick={() => setIsDialogOpen(true)} className="w-full sm:w-auto">
            <PlusIcon />
            New patient
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <PatientsSearchFilter />
          {isAnyFilterModified && (
            <Button variant="ghost" size="sm" onClick={onClearFilters} className="text-muted-foreground">
              <XIcon />
              Clear filters
            </Button>
          )}
        </div>
      </PageHeader>
    </>
  );
};
