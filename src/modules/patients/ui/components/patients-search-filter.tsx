import { SearchIcon } from "lucide-react";

import { DEFAULT_PAGE } from "@/constants";
import { Input } from "@/components/ui/input";

import { usePatientsFilters } from "../../hooks/use-patients-filters";

export const PatientsSearchFilter = () => {
  const [filters, setFilters] = usePatientsFilters();

  return (
    <div className="relative w-full sm:w-72">
      <label htmlFor="patients-search" className="sr-only">Search patients by name or phone</label>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        id="patients-search"
        type="search"
        placeholder="Search by name or phone"
        className="h-10 bg-card pl-9"
        value={filters.search}
        onChange={(e) => setFilters({ search: e.target.value, page: DEFAULT_PAGE })}
      />
    </div>
  );
};
