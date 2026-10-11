import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowLeftIcon, CalendarIcon, ClipboardListIcon, LinkIcon, MoreVerticalIcon, PhoneOffIcon, RotateCcwIcon, VideoIcon, XCircleIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { GeneratedAvatar } from "@/components/generated-avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { SessionGetOne } from "../../types";
import { sessionDate } from "./columns";
import { SessionStatusBadge } from "./session-status-badge";

interface Props {
  data: SessionGetOne;
  onNewLink: () => void;
  onRestart: () => void;
  onEnd: () => void;
  onCancel: () => void;
}

/** There is no "copy patient link": only sha256(token) is stored, so a new link revokes the old one. */
export const SessionIdViewHeader = ({ data, onNewLink, onRestart, onEnd, onCancel }: Props) => {
  const { status } = data;
  const open = status === "scheduled" || status === "live";
  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/sessions"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon className="size-4" />
        All sessions
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4 min-w-0">
          <GeneratedAvatar variant="initials" seed={data.patient.name} className="size-12 shrink-0" />
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{data.exercise.nameEn}</h1>
              <SessionStatusBadge status={status} failureReason={data.failureReason} />
              {data.mode === "replay" && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Demo replay</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <Link href={`/patients/${data.patient.id}`} className="font-medium text-foreground hover:underline">
                {data.patient.name}
              </Link>
              <span lang="ml" className="font-ml">{data.exercise.nameMl}</span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon className="size-3.5" aria-hidden />
                {format(sessionDate(data), "EEE d MMM yyyy, h:mm a")}
              </span>
              <Link href={`/prescriptions/${data.prescriptionId}`} className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline">
                <ClipboardListIcon className="size-3.5" aria-hidden />
                {data.prescription.sets} × {data.prescription.reps} reps to {data.prescription.targetAngle}°
              </Link>
            </div>
          </div>
        </div>
        {open && (
          <div className="flex items-center gap-2 shrink-0">
            {status === "live" && (
              <Button asChild className="hidden sm:inline-flex">
                <Link href={`/call/${data.id}`}><VideoIcon />Join live call</Link>
              </Button>
            )}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Session actions"><MoreVerticalIcon /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem asChild>
                  <Link href={`/call/${data.id}`}><VideoIcon />Join call</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onNewLink}><LinkIcon />New patient link</DropdownMenuItem>
                {status === "live" && (
                  <>
                    <DropdownMenuItem onClick={onRestart}><RotateCcwIcon />Restart coach</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={onEnd}><PhoneOffIcon />End session</DropdownMenuItem>
                  </>
                )}
                {status === "scheduled" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={onCancel}><XCircleIcon />Cancel session</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
};
