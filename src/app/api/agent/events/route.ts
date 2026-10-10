import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { callSessions, safetyEvents, setResults } from "@/db/schema";
import { SIGNATURE_HEADER, verifySignedRequest } from "@/lib/signing";
import { AgentCallback } from "@/modules/agent-bridge/schemas";
import { applyAgentExit, markLive } from "@/modules/sessions/server/lifecycle";

export const dynamic = "force-dynamic";

const PATH = "/api/agent/events";
const ok = () => NextResponse.json({ ok: true });

/**
 * Worker -> web callbacks (§7.6). 401 bad signature (the worker re-signs and retries), 400 schema failure
 * (dead-lettered, never retried), 200 success AND duplicates, 5xx only for real DB failures (retried).
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  if (!verifySignedRequest(process.env.AGENT_CALLBACK_SECRET ?? "", "POST", PATH, body, req.headers.get(SIGNATURE_HEADER))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = AgentCallback.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "schema", issues: parsed.error.issues.slice(0, 3) }, { status: 400 });
  }
  const cb = parsed.data;

  const [session] = await db.select().from(callSessions).where(eq(callSessions.id, cb.sessionId));
  if (!session) return ok();                         // unknown/deleted session: nothing to do, do not retry

  switch (cb.type) {
    case "agent_joined":
      await markLive(session.id, `${cb.host}:${cb.pid}`);
      break;

    case "consent_given":
      await db.update(callSessions)
        .set({ consentGivenAt: sql`coalesce(${callSessions.consentGivenAt}, ${new Date(cb.at)})`, updatedAt: new Date() })
        .where(eq(callSessions.id, session.id));
      break;

    case "set_result": {
      const fields = {
        eventId: cb.eventId, repsDone: cb.repsDone, repsPlanned: cb.repsPlanned, targetAngle: cb.targetAngle,
        side: cb.side, avgPeak: cb.avgPeak, bestPeak: cb.bestPeak, lowestPeak: cb.lowestPeak,
        avgRepSeconds: cb.avgRepSeconds, fastReps: cb.fastReps, score: cb.score, feedbackMl: cb.feedbackMl,
        feedbackEn: cb.feedbackEn, feedbackSource: cb.feedbackSource, perRep: cb.perRep, stopReason: cb.stopReason,
      };
      // Upsert on (session, set): a partial set re-posted after a halt replaces the earlier row.
      await db.insert(setResults).values({ callSessionId: session.id, setIndex: cb.setIndex, ...fields })
        .onConflictDoUpdate({ target: [setResults.callSessionId, setResults.setIndex], set: fields });
      break;
    }

    case "pain_recorded":
      // No safety insert here: for score >= 7 the agent also posts safety_alert with the same clientEventId.
      await db.update(setResults).set({ pain: cb.score })
        .where(and(eq(setResults.callSessionId, session.id), eq(setResults.setIndex, cb.setIndex)));
      break;

    case "safety_alert":
      await db.insert(safetyEvents).values({
        callSessionId: session.id, patientId: session.patientId, kind: cb.kind, symptom: cb.symptom ?? null,
        painScore: cb.painScore ?? null, setIndex: cb.setIndex ?? null, source: "agent",
        clientEventId: cb.kind === "agent_down" ? `agent_down:${session.id}:${session.agentPid ?? "unknown"}` : cb.clientEventId,
      }).onConflictDoNothing();
      if (cb.setIndex && cb.kind !== "agent_down") {
        const stopReason = cb.kind === "stop" ? "stop_pressed" : cb.kind;
        await db.update(setResults).set({ stopReason })
          .where(and(eq(setResults.callSessionId, session.id), eq(setResults.setIndex, cb.setIndex)));
      }
      break;

    case "agent_exited":
      await applyAgentExit(session.id, cb.code);
      break;

    case "heartbeat":
      break;
  }
  return ok();
}
