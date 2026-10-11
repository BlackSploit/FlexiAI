import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { CommandSelect } from "@/components/command-select";
import { GeneratedAvatar } from "@/components/generated-avatar";

interface Props {
  value: string;
  onChange: (patientId: string) => void;
}

/** Controlled patient picker, shared by the sessions and prescriptions list headers. */
export const PatientIdFilter = ({ value, onChange }: Props) => {
  const trpc = useTRPC();
  const [search, setSearch] = useState("");
  const { data } = useQuery(trpc.patients.getMany.queryOptions({ pageSize: 100, search }));

  return (
    <CommandSelect
      className="h-10 bg-card"
      placeholder="Patient"
      options={(data?.items ?? []).map((patient) => ({
        id: patient.id,
        value: patient.id,
        children: (
          <div className="flex items-center gap-x-2">
            <GeneratedAvatar seed={patient.name} variant="initials" className="size-4" />
            {patient.name}
          </div>
        ),
      }))}
      onSelect={onChange}
      onSearch={setSearch}
      value={value}
    />
  );
};
