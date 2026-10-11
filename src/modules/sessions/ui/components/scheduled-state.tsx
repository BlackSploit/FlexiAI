import Link from "next/link"
import { format, formatDistanceToNow } from "date-fns"
import { CheckCircle2Icon, Loader2Icon, QrCodeIcon, SmartphoneIcon, VideoIcon, XCircleIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface Props {
  sessionId: string;
  agentReady: boolean;
  joinTokenExpiresAt: Date | string | null;
  hasActiveJoinLink: boolean;
  onNewLink: () => void;
  onCancel: () => void;
  isCancelling: boolean;
  isCreatingLink?: boolean;
}

const Step = ({ done, active, title, hint }: { done: boolean; active: boolean; title: string; hint: string }) => (
  <li className="flex items-start gap-3">
    <span className={cn(
      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
      done ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" : active ? "border-primary/30 bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
    )}>
      {done ? <CheckCircle2Icon className="size-4" /> : active ? <Loader2Icon className="size-3.5 animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
    </span>
    <div className="flex flex-col">
      <span className={cn("text-sm font-medium", !done && !active && "text-muted-foreground")}>{title}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  </li>
);

export const ScheduledState = ({
  sessionId, agentReady, joinTokenExpiresAt, hasActiveJoinLink, onNewLink, onCancel, isCancelling, isCreatingLink,
}: Props) => {
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <section className="lg:col-span-3 rounded-xl border bg-card p-6 shadow-sm flex flex-col gap-6">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            {agentReady ? <SmartphoneIcon className="size-6" /> : <Loader2Icon className="size-6 animate-spin" />}
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">{agentReady ? "Waiting for the patient" : "Starting the coach…"}</h2>
            <p className="text-sm text-muted-foreground">
              {agentReady
                ? "The coach is in the call. The session goes live as soon as the patient opens their link."
                : "The coach is joining the call. This usually takes a few seconds."}
            </p>
          </div>
        </div>
        <ol className="flex flex-col gap-4">
          <Step done title="Session created" hint="A private video call was set up for this prescription." active={false} />
          <Step done={agentReady} active={!agentReady} title="Coach joins the call" hint="Watches pose, counts reps and speaks Malayalam." />
          <Step done={false} active={agentReady} title="Patient joins with the link" hint="No account needed. Consent is asked before any analysis." />
        </ol>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t pt-5">
          <Button variant="ghost" className="text-rose-600 hover:text-rose-700 hover:bg-rose-500/10" onClick={onCancel} disabled={isCancelling}>
            <XCircleIcon />
            {isCancelling ? "Cancelling…" : "Cancel session"}
          </Button>
          <Button asChild variant="outline">
            <Link href={`/call/${sessionId}`}><VideoIcon />Join call</Link>
          </Button>
        </div>
      </section>

      <section className="lg:col-span-2 rounded-xl border bg-card p-6 shadow-sm flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Patient link</h2>
          <p className="text-sm text-muted-foreground">
            For privacy the link is shown only once. Create a fresh one to share by QR code, WhatsApp or copy.
          </p>
        </div>
        {hasActiveJoinLink && joinTokenExpiresAt ? (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm">
            <p className="font-medium text-emerald-700 dark:text-emerald-300">A link is active</p>
            <p className="text-xs text-muted-foreground">
              Valid until {format(new Date(joinTokenExpiresAt), "d MMM, h:mm a")} ({formatDistanceToNow(new Date(joinTokenExpiresAt), { addSuffix: true })})
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm">
            <p className="font-medium text-amber-700 dark:text-amber-300">No active link</p>
            <p className="text-xs text-muted-foreground">Create one so the patient can join.</p>
          </div>
        )}
        <Button className="h-11 mt-auto" onClick={onNewLink} disabled={isCreatingLink}>
          <QrCodeIcon />
          {isCreatingLink ? "Creating link…" : hasActiveJoinLink ? "Share a new link" : "Create patient link"}
        </Button>
        {hasActiveJoinLink && (
          <p className="text-xs text-muted-foreground text-center">Creating a new link stops the previous one working.</p>
        )}
      </section>
    </div>
  )
}
