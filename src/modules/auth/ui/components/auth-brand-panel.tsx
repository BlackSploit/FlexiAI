import Image from "next/image";
import { ActivityIcon, AudioLinesIcon, ShieldCheckIcon } from "lucide-react";

const VALUES = [
  {
    icon: ActivityIcon,
    title: "Real-time rep counting",
    description: "Pose tracking counts every rep and flags form issues as they happen.",
  },
  {
    icon: AudioLinesIcon,
    title: "Malayalam voice coaching",
    description: "Patients hear calm, clear cues in the language they think in.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Progress you can trust",
    description: "Reps, pain scores and trends for every session. No video is stored.",
  },
];

export const AuthBrandPanel = () => {
  return (
    <aside className="relative hidden overflow-hidden bg-radial from-sidebar-accent to-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full border border-white/10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-16 size-[28rem] rounded-full border border-white/5"
      />

      <div className="relative flex items-center gap-3">
        <Image src="/logo.svg" alt="" width={40} height={40} priority />
        <span className="text-lg font-semibold tracking-tight text-white">PhysioCoach</span>
      </div>

      <div className="relative max-w-md space-y-8">
        <div className="space-y-3">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            Guided home physiotherapy, in Malayalam
          </h2>
          <p lang="ml" className="font-ml text-base text-sidebar-foreground/80">
            വീട്ടിലിരുന്ന് സുരക്ഷിതമായ വ്യായാമം
          </p>
          <p className="text-sm text-sidebar-foreground/75">
            Prescribe a programme, send your patient a link, and watch them train with a live AI coach.
          </p>
        </div>

        <ul className="space-y-5">
          {VALUES.map(({ icon: Icon, title, description }) => (
            <li key={title} className="flex gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                <Icon className="size-5 text-white" aria-hidden />
              </span>
              <div className="space-y-0.5">
                <p className="text-sm font-semibold text-white">{title}</p>
                <p className="text-sm text-sidebar-foreground/70">{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-sidebar-foreground/60">
        Built for physiotherapists in Kerala. Patients join with a one-time link, no account needed.
      </p>
    </aside>
  );
};
