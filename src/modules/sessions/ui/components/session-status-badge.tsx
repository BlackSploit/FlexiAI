import { CircleCheckIcon, CircleSlashIcon, CircleXIcon, ClockIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Status = "scheduled" | "live" | "done" | "failed";

const STYLES: Record<Status | "cancelled", string> = {
  scheduled: "bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-300",
  live: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25 dark:text-emerald-300",
  done: "bg-primary/10 text-primary border-primary/20",
  failed: "bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-300",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const LABELS: Record<Status | "cancelled", string> = {
  scheduled: "Scheduled",
  live: "Live",
  done: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Status pill used across the sessions module. Live gets a pulsing emerald dot. */
export const SessionStatusBadge = ({
  status, failureReason, className,
}: { status: Status; failureReason?: string | null; className?: string }) => {
  const key = status === "failed" && failureReason === "cancelled" ? "cancelled" : status;
  const Icon = key === "scheduled" ? ClockIcon : key === "done" ? CircleCheckIcon : key === "cancelled" ? CircleSlashIcon : CircleXIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        STYLES[key],
        className,
      )}
    >
      {key === "live" ? (
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
      ) : (
        <Icon className="size-3.5" aria-hidden />
      )}
      {LABELS[key]}
    </span>
  );
};
