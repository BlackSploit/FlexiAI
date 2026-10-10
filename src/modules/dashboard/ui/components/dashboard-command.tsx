import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Dispatch, SetStateAction, useState } from "react";

import {
  CommandResponsiveDialog,
  CommandInput,
  CommandItem,
  CommandList,
  CommandGroup,
  CommandEmpty
} from "@/components/ui/command";
import { useTRPC } from "@/trpc/client";
import { GeneratedAvatar } from "@/components/generated-avatar";

interface Props {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
};

export const DashboardCommand = ({ open, setOpen }: Props) => {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const trpc = useTRPC();
  const patients = useQuery(trpc.patients.getMany.queryOptions({ search, pageSize: 100 }));
  const sessions = useQuery(trpc.sessions.getMany.queryOptions({ search, pageSize: 100 }));

  const go = (href: string) => {
    router.push(href);
    setOpen(false);
  };

  return (
    <CommandResponsiveDialog shouldFilter={false} open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Find a patient or session…"
        value={search}
        onValueChange={(value) => setSearch(value)}
      />
      <CommandList>
        <CommandEmpty>
          <span className="text-muted-foreground text-sm">No results found</span>
        </CommandEmpty>
        <CommandGroup heading="Patients">
          {patients.data?.items.map((patient) => (
            <CommandItem key={patient.id} onSelect={() => go(`/patients/${patient.id}`)}>
              <GeneratedAvatar seed={patient.name} variant="initials" className="size-5" />
              {patient.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Sessions">
          {sessions.data?.items.map((session) => (
            <CommandItem key={session.id} onSelect={() => go(`/sessions/${session.id}`)}>
              {session.exercise.nameEn} · {session.patient.name}
              <span className="ml-auto text-xs text-muted-foreground capitalize">{session.status}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandResponsiveDialog>
  );
};
