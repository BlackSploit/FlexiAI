import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Designed empty state: icon in a soft primary circle, title, hint, optional CTA. */
export const PanelEmpty = ({
  icon: Icon, title, hint, action, tone = "primary", className,
}: {
  icon: LucideIcon;
  title: string;
  hint: ReactNode;
  action?: ReactNode;
  tone?: "primary" | "rose" | "muted" | "emerald";
  className?: string;
}) => {
  const ring = {
    primary: "bg-primary/10 text-primary",
    rose: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
    muted: "bg-muted text-muted-foreground",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  }[tone];
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <div className={cn("flex size-14 items-center justify-center rounded-full", ring)}>
        <Icon className="size-6" aria-hidden />
      </div>
      <div className="flex max-w-md flex-col gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {action && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
};

/** Stat tile: small muted label, big number, small hint. */
export const StatTile = ({
  label, value, hint, icon: Icon, tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "good" | "warn" | "bad";
}) => {
  const valueTone = {
    default: "text-foreground",
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-rose-600 dark:text-rose-400",
  }[tone];
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}
      </div>
      <p className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", valueTone)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
};

export const SectionCard = ({
  title, description, action, children, className, bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) => (
  <section className={cn("rounded-xl border bg-card shadow-sm", className)}>
    {(title || action) && (
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="flex flex-col gap-0.5">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
    )}
    <div className={cn("p-5", bodyClassName)}>{children}</div>
  </section>
);
