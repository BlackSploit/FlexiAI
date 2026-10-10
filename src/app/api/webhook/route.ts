import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { callSessions, safetyEvents } from "@/db/schema";
import { AGENT_USER_ID, PAIN_ALERT_THRESHOLD } from "@/constants";
import { getAgent, stopAgent } from "@/lib/agent-worker";
import { streamVideo } from "@/lib/stream-video";
import { finalizeSession, markLive, recordAgentDown } from "@/modules/sessions/server/lifecycle";

export const dynamic = "force-dynamic";

/** One place to read the call id: `call.id`, else the id part of `call_cid` ("type:id"). */
function getCallId(payload: Record<string, unknown>): string | undefined {
  const call = payload.call as { id?: string } | undefined;
  const callCid = payload.call_cid as string | undefined;
  return call?.id ?? callCid?.split(":")[1];
}

/** Unknown calls and unhandled events get 200 so Stream does not retry them. */
const ignored = () => NextResponse.json({ status: "ignored" });

/**
 * Stream webhook (§7.5): call lifecycle, a custom-event safety backstop, agent-down detection.
 * Never ends a call because a participant left.
 */
export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-signature");
  const apiKey = req.headers.get("x-api-key");
  if (!signature || !apiKey) {
    return NextResponse.json({ error: "Missing signature or API key" }, { status: 400 });
  }
  if (apiKey !== process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }
  const body = await req.text();
  if (!streamVideo.verifyWebhook(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const callId = getCallId(payload);
  if (!callId) return ignored();
  const [session] = await db.select().from(callSessions).where(eq(callSessions.streamCallId, callId));
  if (!session) return ignored();

  switch (payload.type) {
    case "call.session_started":
      await markLive(session.id);
      break;

    case "call.session_participant_left": {
      const participant = payload.participant as { user?: { id?: string } } | undefined;
      if (participant?.user?.id === AGENT_USER_ID && session.status === "live") {
        const alive = await getAgent(session.id).catch(() => null);
        if (!alive) await recordAgentDown(session.id, session.patientId, session.agentPid, "webhook");
      }
      // A patient leaving is handled by the agent's own timeout (exit code 4).
      break;
    }

    case "custom": {
      // Backstop only: whether custom events reach webhooks is unverified; the UI + agent paths are primary.
      const custom = (payload.custom ?? {}) as { type?: string; eventId?: string; score?: number; kind?: string; setIndex?: number };
      const kind = custom.type === "pc.stop" ? "stop"
        : custom.type === "pc.symptom" ? "symptom"
          : custom.type === "pc.pain_score" && (custom.score ?? 0) >= PAIN_ALERT_THRESHOLD ? "pain" : null;
      if (kind && custom.eventId) {
        await db.insert(safetyEvents).values({
          callSessionId: session.id, patientId: session.patientId, kind, source: "webhook", clientEventId: custom.eventId,
          symptom: kind === "symptom" ? custom.kind ?? null : null, painScore: kind === "pain" ? custom.score ?? null : null,
          setIndex: custom.setIndex ?? null,
        }).onConflictDoNothing();
      }
      break;
    }

    case "call.session_ended":
    case "call.ended":
      await finalizeSession(session.id, "no_sets");
      await stopAgent(session.id).catch(() => false);
      break;

    default:
      return ignored();
  }
  return NextResponse.json({ status: "ok" });
}
