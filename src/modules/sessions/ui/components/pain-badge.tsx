import { PAIN_ALERT_THRESHOLD } from "@/constants";
import { cn } from "@/lib/utils";

/** Pain 0-10: calm below 4, amber 4-6, rose at the alert threshold and above. */
export const PainBadge = ({ pain, className }: { pain: number | null | undefined; className?: string }) => {
  if (pain === null || pain === undefined) return null;
  const tone = pain >= PAIN_ALERT_THRESHOLD
    ? "bg-rose-500/10 text-rose-700 border-rose-500/25 dark:text-rose-300"
    : pain >= 4
      ? "bg-amber-500/10 text-amber-700 border-amber-500/25 dark:text-amber-300"
      : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums whitespace-nowrap", tone, className)}
      title={`Pain reported: ${pain} out of 10`}
    >
      Pain {pain}/10
    </span>
  );
};
