import { SearchIcon } from "lucide-react";

import { DEFAULT_PAGE } from "@/constants";
import { Input } from "@/components/ui/input";

import { useSessionsFilters } from "../../hooks/use-sessions-filters";

export const SessionsSearchFilter = () => {
  const [filters, setFilters] = useSessionsFilters();

  return (
    <div className="relative">
      <Input
        placeholder="Patient or exercise"
        className="h-9 bg-white w-[200px] pl-7"
        value={filters.search}
        onChange={(e) => setFilters({ search: e.target.value, page: DEFAULT_PAGE })}
      />
      <SearchIcon className="size-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
};
