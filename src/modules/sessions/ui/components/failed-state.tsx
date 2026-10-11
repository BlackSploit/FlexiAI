"use client";

import Link from "next/link"
import { CircleSlashIcon, ClipboardListIcon, TriangleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { FailureReason } from "@/modules/agent-bridge/schemas"
import { StartSessionButton } from "@/modules/prescriptions/ui/components/start-session-button"

import { PanelEmpty } from "./session-panels"

/** One line for every member of the FailureReason union (agent-bridge/schemas.ts). */
const MESSAGES: Record<FailureReason, { title: string; hint: string }> = {
  cancelled: { title: "Session cancelled", hint: "This session was cancelled before the patient joined. The patient link no longer works." },
  agent_start_failed: { title: "The coach could not start", hint: "The AI coach did not start, so the call never opened. Starting a new session usually fixes this." },
  agent_join_timeout: { title: "The coach did not join in time", hint: "The coach took too long to join the call. Start a new session and send the new link." },
  patient_never_joined: { title: "The patient did not join", hint: "Nobody opened the link within 15 minutes. You may want to call the patient, then start a new session." },
  patient_left: { title: "The patient left early", hint: "The patient left the call before finishing a set, so there are no results to show." },
  no_consent: { title: "Consent was not given", hint: "The patient did not agree to video analysis, so no exercise was measured. Nothing was recorded." },
  no_sets: { title: "No set was completed", hint: "The session ended before the patient finished a set." },
  agent_crashed: { title: "The coach stopped unexpectedly", hint: "The coach stopped before any set was completed. Start a new session to try again." },
};

interface Props {
  reason: string | null;
  prescriptionId: string;
  patient: { name: string; phone?: string | null; email?: string | null };
}

export const FailedState = ({ reason, prescriptionId, patient }: Props) => {
  const msg = (reason && MESSAGES[reason as FailureReason]) || { title: "No results", hint: "This session ended without results." };
  const cancelled = reason === "cancelled";
  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <PanelEmpty
        icon={cancelled ? CircleSlashIcon : TriangleAlertIcon}
        tone={cancelled ? "muted" : "rose"}
        title={msg.title}
        hint={msg.hint}
        action={
          <>
            <StartSessionButton prescriptionId={prescriptionId} patient={patient} label="Start a new session" />
            <Button asChild variant="outline">
              <Link href={`/prescriptions/${prescriptionId}`}><ClipboardListIcon />View prescription</Link>
            </Button>
          </>
        }
      />
    </div>
  )
}
