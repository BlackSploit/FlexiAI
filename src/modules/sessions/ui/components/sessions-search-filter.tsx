"use client";

import { SearchIcon, XIcon } from "lucide-react";

import { DEFAULT_PAGE } from "@/constants";
import { Input } from "@/components/ui/input";

import { useSessionsFilters } from "../../hooks/use-sessions-filters";

export const SessionsSearchFilter = () => {
  const [filters, setFilters] = useSessionsFilters();

  return (
    <div className="relative w-full sm:w-64">
      <SearchIcon className="pointer-events-none size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        aria-label="Search sessions by patient or exercise"
        placeholder="Search patient or exercise"
        className="h-10 bg-background pl-8 pr-8"
        value={filters.search}
        onChange={(e) => setFilters({ search: e.target.value, page: DEFAULT_PAGE })}
      />
      {filters.search && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setFilters({ search: "", page: DEFAULT_PAGE })}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
};
