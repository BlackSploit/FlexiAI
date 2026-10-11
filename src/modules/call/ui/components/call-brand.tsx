import Image from "next/image";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Bilingual = { ml: string; en: string };

/** Malayalam on top (larger), English underneath. */
export const Bi = ({ t, className, mlClassName, enClassName }: {
  t: Bilingual; className?: string; mlClassName?: string; enClassName?: string;
}) => (
  <span className={cn("flex flex-col leading-tight", className)}>
    <span lang="ml" className={cn("font-ml", mlClassName)}>{t.ml}</span>
    <span className={cn("text-[0.8em] opacity-80", enClassName)}>{t.en}</span>
  </span>
);

export const BrandMark = ({ className, compact }: { className?: string; compact?: boolean }) => (
  <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
    <Image src="/logo.svg" width={28} height={28} alt="" className="size-7 shrink-0 rounded-lg shadow-sm" />
    <span className={cn(compact && "sr-only sm:not-sr-only")}>Physio<span className="text-primary">Coach</span></span>
  </span>
);

/** Dark, full-height call surface with a soft teal glow. Cards inside may be light. */
export const CallShell = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn(
    "relative flex min-h-full w-full flex-col overflow-x-hidden bg-neutral-950 text-white",
    "bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,color-mix(in_oklch,var(--primary)_28%,transparent),transparent)]",
    className,
  )}>
    {children}
  </div>
);

export const BrandedLoading = ({ label }: { label?: Bilingual }) => (
  <CallShell className="h-full items-center justify-center">
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-5 px-6 text-center">
      <span className="relative flex size-16 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-white/10 border-t-primary" />
        <Image src="/logo.svg" width={32} height={32} alt="" className="size-8 rounded-lg" />
      </span>
      <span className="text-sm font-medium tracking-tight text-white/80">
        {label ? <Bi t={label} className="items-center gap-1" mlClassName="text-base text-white" /> : "PhysioCoach"}
      </span>
    </div>
  </CallShell>
);

const TONES = {
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-600",
  danger: "bg-rose-500/10 text-rose-600",
  warning: "bg-amber-500/10 text-amber-600",
} as const;

/** Centered branded card for ended / error / inactive states. */
export const StatusCard = ({ icon: Icon, tone = "primary", title, description, children }: {
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) => (
  <CallShell className="h-full overflow-y-auto">
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <BrandMark className="text-lg" />
      <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border bg-card p-6 text-center text-card-foreground shadow-xl sm:p-8">
        <span className={cn("flex size-14 items-center justify-center rounded-full", TONES[tone])}>
          <Icon className="size-7" aria-hidden />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </div>
        {children}
      </div>
    </div>
  </CallShell>
);
