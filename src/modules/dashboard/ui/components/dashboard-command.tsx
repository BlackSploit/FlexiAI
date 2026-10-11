"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { ClipboardListIcon, LayoutDashboardIcon, SearchXIcon, UsersIcon, VideoIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  CommandResponsiveDialog,
  CommandInput,
  CommandItem,
  CommandList,
  CommandGroup,
  CommandEmpty,
  CommandSeparator,
} from "@/components/ui/command";
import { useTRPC } from "@/trpc/client";
import { GeneratedAvatar } from "@/components/generated-avatar";

interface Props {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
};

const pages = [
  { icon: LayoutDashboardIcon, label: "Overview", href: "/overview" },
  { icon: UsersIcon, label: "Patients", href: "/patients" },
  { icon: ClipboardListIcon, label: "Prescriptions", href: "/prescriptions" },
  { icon: VideoIcon, label: "Sessions", href: "/sessions" },
];

const statusClass: Record<string, string> = {
  scheduled: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  live: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  done: "bg-primary/10 text-primary",
  failed: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

export const DashboardCommand = ({ open, setOpen }: Props) => {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  const trpc = useTRPC();
  const patients = useQuery(trpc.patients.getMany.queryOptions({ search: debounced, pageSize: 8 }, { enabled: open }));
  const sessions = useQuery(trpc.sessions.getMany.queryOptions({ search: debounced, pageSize: 8 }, { enabled: open }));

  const go = (href: string) => {
    router.push(href);
    setOpen(false);
    setSearch("");
  };

  const q = search.trim().toLowerCase();
  const matchingPages = pages.filter((p) => !q || p.label.toLowerCase().includes(q));
  const patientItems = patients.data?.items ?? [];
  const sessionItems = sessions.data?.items ?? [];
  const loading = patients.isFetching || sessions.isFetching;

  return (
    <CommandResponsiveDialog shouldFilter={false} open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search patients, exercises or pages…"
        value={search}
        onValueChange={(value) => setSearch(value)}
      />
      <CommandList>
        <CommandEmpty>
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <SearchXIcon className="size-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {loading ? "Searching…" : "No patients or sessions match that search"}
            </span>
          </div>
        </CommandEmpty>
        {matchingPages.length > 0 && (
          <CommandGroup heading="Go to">
            {matchingPages.map((p) => (
              <CommandItem key={p.href} value={`page-${p.href}`} onSelect={() => go(p.href)}>
                <p.icon className="size-4 text-muted-foreground" />
                {p.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {patientItems.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Patients">
              {patientItems.map((patient) => (
                <CommandItem key={patient.id} value={`patient-${patient.id}`} onSelect={() => go(`/patients/${patient.id}`)}>
                  <GeneratedAvatar seed={patient.name} variant="initials" className="size-6" />
                  <span className="truncate">{patient.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {sessionItems.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Sessions">
              {sessionItems.map((session) => (
                <CommandItem key={session.id} value={`session-${session.id}`} onSelect={() => go(`/sessions/${session.id}`)}>
                  <VideoIcon className="size-4 text-muted-foreground" />
                  <span className="truncate">{session.exercise.nameEn} · {session.patient.name}</span>
                  <span
                    className={cn(
                      "ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                      statusClass[session.status] ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    {session.status}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandResponsiveDialog>
  );
};
