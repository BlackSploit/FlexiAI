import "server-only";

import { and, eq, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { callSessions, safetyEvents, setResults } from "@/db/schema";
import { AGENT_JOIN_TIMEOUT_S, AGENT_USER_ID } from "@/constants";
import { endGuidedCall, streamVideo } from "@/lib/stream-video";
import type { FailureReason } from "@/modules/agent-bridge/schemas";

/**
 * Session state rules shared by sessions.*, the Stream webhook (§7.5) and the agent callbacks (§7.6).
 * Every function is idempotent: final rows (done/failed) are never changed again.
 */
const FINAL = ["done", "failed"] as const;

async function hasSets(sessionId: string) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(setResults)
    .where(eq(setResults.callSessionId, sessionId));
  return row.n > 0;
}

/** scheduled -> live; startedAt ??= now. */
export async function markLive(sessionId: string, agentPid?: string) {
  await db.update(callSessions)
    .set({
      status: "live",
      startedAt: sql`coalesce(${callSessions.startedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(and(eq(callSessions.id, sessionId), eq(callSessions.status, "scheduled")));
  if (agentPid) {
    await db.update(callSessions).set({ agentPid }).where(eq(callSessions.id, sessionId));
  }
}

/** done when any set exists, else failed with `reason`; endedAt = now. No-op on final rows. */
export async function finalizeSession(sessionId: string, reasonIfNoSets: FailureReason, forceFailed?: FailureReason) {
  const sets = await hasSets(sessionId);
  const failed = forceFailed ?? (sets ? null : reasonIfNoSets);
  await db.update(callSessions)
    .set({
      status: failed ? "failed" : "done",
      failureReason: failed,
      endedAt: sql`coalesce(${callSessions.endedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(and(eq(callSessions.id, sessionId), sql`${callSessions.status} not in ('done', 'failed')`));
}

/** agent_down safety row; the same key from the webhook and the exit handler dedupes to one row. */
export async function recordAgentDown(sessionId: string, patientId: string, agentPid: string | null, source: "agent" | "webhook") {
  await db.insert(safetyEvents).values({
    callSessionId: sessionId, patientId, kind: "agent_down", source,
    clientEventId: `agent_down:${sessionId}:${agentPid ?? "unknown"}`,
  }).onConflictDoNothing();
}

/** Exit-code contract (§8.14). */
export async function applyAgentExit(sessionId: string, code: number) {
  const [session] = await db.select().from(callSessions).where(eq(callSessions.id, sessionId));
  if (!session || (FINAL as readonly string[]).includes(session.status)) return;
  switch (code) {
    case 0:
      return finalizeSession(sessionId, "no_sets");
    case 3:
      return finalizeSession(sessionId, "patient_never_joined", "patient_never_joined");
    case 4:
      return finalizeSession(sessionId, "patient_left");
    case 5:
      return finalizeSession(sessionId, "no_consent", "no_consent");
    default: {
      await finalizeSession(sessionId, "agent_crashed");
      await recordAgentDown(sessionId, session.patientId, session.agentPid, "agent");
      try {   // both UIs show "Coach disconnected"
        await streamVideo.video.call(session.streamCallType, session.streamCallId).sendCallEvent({
          user_id: AGENT_USER_ID,
          custom: { type: "pc.safety_alert", v: 1, eventId: `agentdown${Date.now()}`, ts: Date.now(), reason: "agent_down" },
        });
      } catch {
        /* the call may already be gone */
      }
    }
  }
}

/**
 * Lazy join-timeout producer (§7.4, no scheduler in v1): a scheduled session whose agent has not joined
 * within 90 s becomes failed/agent_join_timeout and its call is ended.
 */
export async function expireStaleScheduled(physioId: string) {
  const cutoff = new Date(Date.now() - AGENT_JOIN_TIMEOUT_S * 1000);
  const stale = await db.update(callSessions)
    .set({ status: "failed", failureReason: "agent_join_timeout", endedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(callSessions.physioId, physioId), eq(callSessions.status, "scheduled"),
      lt(callSessions.createdAt, cutoff), isNull(callSessions.startedAt)))
    .returning({ id: callSessions.id, streamCallId: callSessions.streamCallId, streamCallType: callSessions.streamCallType });
  await Promise.allSettled(stale.map((s) => endGuidedCall(s.streamCallId, s.streamCallType)));
  return stale.map((s) => s.id);
}

export const isFinal = (status: string) => (FINAL as readonly string[]).includes(status);
