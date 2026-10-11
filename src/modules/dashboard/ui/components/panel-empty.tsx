import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface Props {
  icon: LucideIcon;
  title: string;
  hint: string;
  action?: React.ReactNode;
  tone?: "primary" | "success";
  className?: string;
}

/** Compact designed empty state for dashboard cards and lists. */
export const PanelEmpty = ({ icon: Icon, title, hint, action, tone = "primary", className }: Props) => (
  <div className={cn("flex flex-col items-center justify-center gap-3 px-4 py-8 text-center", className)}>
    <span
      className={cn(
        "flex size-11 items-center justify-center rounded-full",
        tone === "success" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-primary/10 text-primary",
      )}
    >
      <Icon className="size-5" />
    </span>
    <div className="space-y-1">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mx-auto max-w-xs text-sm text-muted-foreground">{hint}</p>
    </div>
    {action}
  </div>
);
