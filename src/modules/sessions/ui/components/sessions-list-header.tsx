"use client";

import { XIcon } from "lucide-react";

import { DEFAULT_PAGE } from "@/constants";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { PatientIdFilter } from "@/modules/patients/ui/components/patient-id-filter";

import { StatusFilter } from "./status-filter";
import { SessionsSearchFilter } from "./sessions-search-filter";
import { useSessionsFilters } from "../../hooks/use-sessions-filters";

/** Sessions start from a prescription, so there is no "New" button here. */
export const SessionsListHeader = () => {
  const [filters, setFilters] = useSessionsFilters();

  const isAnyFilterModified = !!filters.status || !!filters.search || !!filters.patientId || !!filters.prescriptionId;

  const onClearFilters = () => {
    setFilters({ status: null, patientId: "", prescriptionId: "", search: "", page: DEFAULT_PAGE });
  };

  return (
    <div className="pt-6 pb-4 px-4 md:px-8 flex flex-col gap-y-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
        <p className="text-sm text-muted-foreground">
          Every guided home-exercise call, its live status and what the coach measured.
        </p>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SessionsSearchFilter />
        <ScrollArea className="w-full lg:w-auto">
          <div className="flex items-center gap-2 pb-1 lg:pb-0">
            <StatusFilter />
            <PatientIdFilter value={filters.patientId} onChange={(id) => setFilters({ patientId: id, page: DEFAULT_PAGE })} />
            {isAnyFilterModified && (
              <Button variant="ghost" size="sm" onClick={onClearFilters} className="text-muted-foreground">
                <XIcon className="size-4" />
                Clear filters
              </Button>
            )}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    </div>
  );
};
