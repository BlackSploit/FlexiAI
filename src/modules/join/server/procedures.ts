import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { exercises, prescriptions, safetyEvents, user } from "@/db/schema";
import { PAIN_ALERT_THRESHOLD } from "@/constants";
import { forwardInput } from "@/lib/agent-worker";
import { createPatientCallToken } from "@/lib/stream-video";
import { baseProcedure, createTRPCRouter } from "@/trpc/init";
import { ClientToAgentEvent } from "@/modules/agent-bridge/schemas";

import { requireJoin } from "./require-join";

const tokenInput = z.object({ token: z.string().min(10).max(1024) });

/** Public patient endpoints: the signed link is the only credential (§7.2). */
export const joinRouter = createTRPCRouter({
  resolve: baseProcedure.input(tokenInput).query(async ({ input }) => {
    const session = await requireJoin(input.token);
    const [row] = await db
      .select({ patient: user, rx: prescriptions, ex: exercises })
      .from(prescriptions)
      .innerJoin(exercises, eq(exercises.id, prescriptions.exerciseId))
      .innerJoin(user, eq(user.id, prescriptions.patientId))
      .where(eq(prescriptions.id, session.prescriptionId));
    return {
      sessionId: session.id,
      streamCallId: session.streamCallId,
      callType: session.streamCallType,
      status: session.status,
      physioId: session.physioId,
      patient: { id: row.patient.id, name: row.patient.name, image: row.patient.image, preferredLanguage: row.patient.preferredLanguage },
      exercise: {
        id: row.ex.id, nameEn: row.ex.nameEn, nameMl: row.ex.nameMl, howToEn: row.ex.howToEn, howToMl: row.ex.howToMl,
        cameraView: row.ex.cameraView, mode: row.ex.mode,
      },
      prescription: { targetAngle: row.rx.targetAngle, reps: row.rx.reps, sets: row.rx.sets, minSecondsPerRep: row.rx.minSecondsPerRep },
    };
  }),

  /** Stream call token scoped to this one call, role call_member, 2 h; only while scheduled/live. */
  streamToken: baseProcedure.input(tokenInput).mutation(async ({ input }) => {
    const session = await requireJoin(input.token);
    return createPatientCallToken(session.patientId, session.streamCallId, session.streamCallType);
  }),

  /**
   * Backup input path (§7.8): Stop, symptoms and pain >= 7 are written to safety_events FIRST (so the physio
   * is alerted even if the agent is dead), then forwarded to the worker. Deduped by the client eventId.
   */
  sendInput: baseProcedure
    .input(tokenInput.extend({ event: ClientToAgentEvent }))
    .mutation(async ({ input }) => {
      const session = await requireJoin(input.token);
      const ev = input.event;
      const safety =
        ev.type === "pc.stop" ? { kind: "stop" as const }
          : ev.type === "pc.symptom" ? { kind: "symptom" as const, symptom: ev.kind }
            : ev.type === "pc.pain_score" && ev.score >= PAIN_ALERT_THRESHOLD
              ? { kind: "pain" as const, painScore: ev.score, setIndex: ev.setIndex } : null;
      if (safety) {
        await db.insert(safetyEvents).values({
          callSessionId: session.id, patientId: session.patientId, source: "ui", clientEventId: ev.eventId, ...safety,
        }).onConflictDoNothing();
      }
      await forwardInput(session.id, session.patientId, ev).catch((e) => console.warn("forwardInput", e.message));
      return { ok: true as const };
    }),
});
