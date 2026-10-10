import { CircleXIcon, CircleCheckIcon, ClockArrowUpIcon, VideoIcon } from "lucide-react";

import { CommandSelect } from "@/components/command-select";

import { CallSessionStatus } from "../../types";
import { useSessionsFilters } from "../../hooks/use-sessions-filters";

const icons = {
  [CallSessionStatus.Scheduled]: ClockArrowUpIcon,
  [CallSessionStatus.Live]: VideoIcon,
  [CallSessionStatus.Done]: CircleCheckIcon,
  [CallSessionStatus.Failed]: CircleXIcon,
};

const options = Object.values(CallSessionStatus).map((status) => {
  const Icon = icons[status];
  return {
    id: status,
    value: status,
    children: (
      <div className="flex items-center gap-x-2 capitalize">
        <Icon />
        {status}
      </div>
    ),
  };
});

export const StatusFilter = () => {
  const [filters, setFilters] = useSessionsFilters();

  return (
    <CommandSelect
      placeholder="Status"
      className="h-9"
      options={options}
      onSelect={(value) => setFilters({ status: value as CallSessionStatus, page: 1 })}
      value={filters.status ?? ""}
    />
  );
};
