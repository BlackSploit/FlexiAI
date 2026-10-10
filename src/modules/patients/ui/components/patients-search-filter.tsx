import { SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";

import { usePatientsFilters } from "../../hooks/use-patients-filters";

export const PatientsSearchFilter = () => {
  const [filters, setFilters] = usePatientsFilters();

  return (
    <div className="relative">
      <Input
        placeholder="Filter by name or phone"
        className="h-9 bg-white w-[220px] pl-7"
        value={filters.search}
        onChange={(e) => setFilters({ search: e.target.value })}
      />
      <SearchIcon className="size-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
};
