import Link from "next/link"
import { format } from "date-fns"
import { LinkIcon, VideoIcon, XCircleIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/empty-state"

interface Props {
  sessionId: string;
  agentReady: boolean;
  joinTokenExpiresAt: Date | string | null;
  hasActiveJoinLink: boolean;
  onNewLink: () => void;
  onCancel: () => void;
  isCancelling: boolean;
}

export const ScheduledState = ({ sessionId, agentReady, joinTokenExpiresAt, hasActiveJoinLink, onNewLink, onCancel, isCancelling }: Props) => {
  return (
    <div className="bg-white rounded-lg px-4 py-5 flex flex-col gap-y-8 items-center justify-center">
      <EmptyState
        image={agentReady ? "/upcoming.svg" : "/processing.svg"}
        title={agentReady ? "Waiting for the patient" : "Starting the coach…"}
        description={agentReady
          ? "The coach is in the call. The session goes live when the patient joins with the link."
          : "The coach is joining the call. This takes a few seconds."}
      />
      {hasActiveJoinLink && joinTokenExpiresAt && (
        <p className="text-sm text-muted-foreground">Patient link active until {format(new Date(joinTokenExpiresAt), "MMM d, HH:mm")}</p>
      )}
      <div className="flex flex-col-reverse lg:flex-row lg:justify-center items-center gap-2 w-full">
        <Button variant="secondary" className="w-full lg:w-auto" onClick={onCancel} disabled={isCancelling}>
          <XCircleIcon />
          Cancel
        </Button>
        <Button variant="outline" className="w-full lg:w-auto" onClick={onNewLink}>
          <LinkIcon />
          New patient link
        </Button>
        <Button asChild className="w-full lg:w-auto">
          <Link href={`/call/${sessionId}`}>
            <VideoIcon />
            Join as physio
          </Link>
        </Button>
      </div>
    </div>
  )
}
