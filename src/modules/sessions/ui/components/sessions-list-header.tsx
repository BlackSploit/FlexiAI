"use client";

import { XCircleIcon } from "lucide-react";

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
    <div className="py-4 px-4 md:px-8 flex flex-col gap-y-4">
      <div className="flex items-center justify-between">
        <h5 className="font-medium text-xl">Sessions</h5>
      </div>
      <ScrollArea>
        <div className="flex items-center gap-x-2 p-1">
          <SessionsSearchFilter />
          <StatusFilter />
          <PatientIdFilter value={filters.patientId} onChange={(id) => setFilters({ patientId: id, page: DEFAULT_PAGE })} />
          {isAnyFilterModified && (
            <Button variant="outline" onClick={onClearFilters}>
              <XCircleIcon className="size-4" />
              Clear
            </Button>
          )}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
};
