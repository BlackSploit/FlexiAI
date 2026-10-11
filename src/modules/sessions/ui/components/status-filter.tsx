"use client";

import { CircleCheckIcon, CircleXIcon, ClockIcon, LayersIcon, RadioIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { DEFAULT_PAGE } from "@/constants";

import { CallSessionStatus } from "../../types";
import { useSessionsFilters } from "../../hooks/use-sessions-filters";

const OPTIONS = [
  { value: null, label: "All", icon: LayersIcon },
  { value: CallSessionStatus.Scheduled, label: "Scheduled", icon: ClockIcon },
  { value: CallSessionStatus.Live, label: "Live", icon: RadioIcon },
  { value: CallSessionStatus.Done, label: "Completed", icon: CircleCheckIcon },
  { value: CallSessionStatus.Failed, label: "Failed", icon: CircleXIcon },
] as const;

/** Segmented status filter (writes ?status=). */
export const StatusFilter = () => {
  const [filters, setFilters] = useSessionsFilters();

  return (
    <div role="group" aria-label="Filter by status" className="inline-flex items-center gap-1 rounded-lg border bg-muted/50 p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = (filters.status ?? null) === value;
        return (
          <button
            key={label}
            type="button"
            aria-pressed={active}
            onClick={() => setFilters({ status: value, page: DEFAULT_PAGE })}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors",
              "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className={cn("size-3.5", active && value === CallSessionStatus.Live && "text-emerald-600")} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
};
