import { EmptyState } from "@/components/empty-state"
import type { FailureReason } from "@/modules/agent-bridge/schemas"

/** One line for every member of the FailureReason union (agent-bridge/schemas.ts). */
const MESSAGES: Record<FailureReason, string> = {
  cancelled: "This session was cancelled.",
  agent_start_failed: "The coach could not be started. Start a new session from the prescription.",
  agent_join_timeout: "The coach did not join the call in time. Start a new session.",
  patient_never_joined: "The patient did not join within 15 minutes.",
  patient_left: "The patient left before any set was completed.",
  no_consent: "The patient did not give consent, so no exercise was analysed.",
  no_sets: "The session ended before any set was completed.",
  agent_crashed: "The coach stopped unexpectedly before any set was completed.",
};

export const FailedState = ({ reason }: { reason: string | null }) => {
  return (
    <div className="bg-white rounded-lg px-4 py-5 flex flex-col gap-y-8 items-center justify-center">
      <EmptyState
        image="/cancelled.svg"
        title="No results"
        description={(reason && MESSAGES[reason as FailureReason]) || "This session ended without results."}
      />
    </div>
  )
}
