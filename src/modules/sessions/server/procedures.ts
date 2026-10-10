import { z } from "zod";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, getTableColumns, ilike, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { callSessions, exercises, prescriptions, safetyEvents, setResults, user } from "@/db/schema";
import { createTRPCRouter, physioProcedure } from "@/trpc/init";
import {
  AGENT_USER_ID, DEFAULT_PAGE, DEFAULT_PAGE_SIZE, JOIN_LINK_TTL_HOURS, MAX_PAGE_SIZE, MIN_PAGE_SIZE,
} from "@/constants";
import { generateAvatarUri } from "@/lib/avatar";
import { createJoinToken } from "@/lib/join-token";
import { AgentWorkerError, forwardInput, getAgent, startAgent, stopAgent } from "@/lib/agent-worker";
import { CALL_TYPE, createGuidedCall, createPhysioUserToken, endGuidedCall, upsertStreamUsers } from "@/lib/stream-video";
import type { StartAgentRequest } from "@/modules/agent-bridge/schemas";

import { sessionInputSchema, sessionsStartSchema } from "../schemas";
import { CallSessionStatus } from "../types";
import { expireStaleScheduled } from "./lifecycle";

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const joinUrl = (token: string) => `${appUrl()}/join/${token}`;

const listColumns = {
  ...getTableColumns(callSessions),
  patient: { id: user.id, name: user.name, image: user.image, phone: user.phone, email: user.email },
  exercise: { id: exercises.id, nameEn: exercises.nameEn, nameMl: exercises.nameMl },
  prescription: {
    targetAngle: prescriptions.targetAngle, reps: prescriptions.reps, sets: prescriptions.sets,
    minSecondsPerRep: prescriptions.minSecondsPerRep,
  },
  duration: sql<number | null>`EXTRACT(EPOCH FROM (${callSessions.endedAt} - ${callSessions.startedAt}))`.as("duration"),
  setCount: db.$count(setResults, eq(setResults.callSessionId, callSessions.id)),
  bestScore: sql<number | null>`(select max(sr.score) from set_results sr where sr.call_session_id = ${callSessions.id})`,
  avgPeak: sql<number | null>`(select avg(sr.avg_peak) from set_results sr where sr.call_session_id = ${callSessions.id})`,
  maxPain: sql<number | null>`(select max(sr.pain) from set_results sr where sr.call_session_id = ${callSessions.id})`,
};

const baseQuery = () =>
  db.select(listColumns)
    .from(callSessions)
    .innerJoin(user, eq(user.id, callSessions.patientId))
    .innerJoin(prescriptions, eq(prescriptions.id, callSessions.prescriptionId))
    .innerJoin(exercises, eq(exercises.id, prescriptions.exerciseId));

async function getOwnSession(physioId: string, id: string) {
  const [row] = await baseQuery().where(and(eq(callSessions.id, id), eq(callSessions.physioId, physioId)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
  return row;
}

/** Everything the agent process needs (§7.7 StartAgentRequest). */
async function agentPayload(sessionId: string, extra: Partial<StartAgentRequest> = {}): Promise<StartAgentRequest> {
  const [row] = await db
    .select({ s: callSessions, rx: prescriptions, ex: exercises, patient: user })
    .from(callSessions)
    .innerJoin(prescriptions, eq(prescriptions.id, callSessions.prescriptionId))
    .innerJoin(exercises, eq(exercises.id, prescriptions.exerciseId))
    .innerJoin(user, eq(user.id, callSessions.patientId))
    .where(eq(callSessions.id, sessionId));
  return {
    sessionId, callType: row.s.streamCallType, callId: row.s.streamCallId, agentUserId: AGENT_USER_ID,
    patient: { id: row.patient.id, name: row.patient.name, lang: row.patient.preferredLanguage },
    physioId: row.s.physioId,
    exercise: {
      id: row.ex.id, joints: row.ex.joints, mode: row.ex.mode, rest: row.ex.rest, start: row.ex.start,
      minPeak: row.ex.minPeak, cameraView: row.ex.cameraView,
    },
    prescription: {
      side: row.rx.side, targetAngle: row.rx.targetAngle, reps: row.rx.reps, sets: row.rx.sets,
      minSecondsPerRep: row.rx.minSecondsPerRep,
    },
    mode: row.s.mode,
    ...extra,
  };
}

const replayAllowList = () => (process.env.AGENT_REPLAY_CLIPS ?? "").split(",").map((c) => c.trim()).filter(Boolean);

export const sessionsRouter = createTRPCRouter({
  getMany: physioProcedure
    .input(
      z.object({
        page: z.number().default(DEFAULT_PAGE),
        pageSize: z.number().min(MIN_PAGE_SIZE).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
        search: z.string().nullish(),
        patientId: z.string().nullish(),
        prescriptionId: z.string().nullish(),
        status: z.nativeEnum(CallSessionStatus).nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await expireStaleScheduled(ctx.auth.user.id);
      const { page, pageSize, search, patientId, prescriptionId, status } = input;
      const where = and(
        eq(callSessions.physioId, ctx.auth.user.id),
        search ? or(ilike(user.name, `%${search}%`), ilike(exercises.nameEn, `%${search}%`)) : undefined,
        patientId ? eq(callSessions.patientId, patientId) : undefined,
        prescriptionId ? eq(callSessions.prescriptionId, prescriptionId) : undefined,
        status ? eq(callSessions.status, status) : undefined,
      );
      const data = await baseQuery()
        .where(where)
        .orderBy(desc(callSessions.createdAt), desc(callSessions.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      // Joins are only needed for the name search.
      const totalQuery = search
        ? db.select({ count: count() }).from(callSessions)
          .innerJoin(user, eq(user.id, callSessions.patientId))
          .innerJoin(prescriptions, eq(prescriptions.id, callSessions.prescriptionId))
          .innerJoin(exercises, eq(exercises.id, prescriptions.exerciseId)).where(where)
        : db.select({ count: count() }).from(callSessions).where(where);
      const [total] = await totalQuery;
      return { items: data, total: total.count, totalPages: Math.ceil(total.count / pageSize) };
    }),

  getOne: physioProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      await expireStaleScheduled(ctx.auth.user.id);
      const row = await getOwnSession(ctx.auth.user.id, input.id);
      const openSafetyEvents = await db.select().from(safetyEvents)
        .where(and(eq(safetyEvents.callSessionId, input.id), isNull(safetyEvents.acknowledgedAt)))
        .orderBy(desc(safetyEvents.createdAt));
      const { joinTokenHash, ...rest } = row;
      return {
        ...rest,
        hasActiveJoinLink: !!joinTokenHash && !!row.joinTokenExpiresAt && new Date(row.joinTokenExpiresAt) > new Date()
          && (row.status === "scheduled" || row.status === "live"),
        openSafetyEvents,
      };
    }),

  getResults: physioProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      await getOwnSession(ctx.auth.user.id, input.id);
      return db.select().from(setResults).where(eq(setResults.callSessionId, input.id)).orderBy(asc(setResults.setIndex));
    }),

  start: physioProcedure
    .input(sessionsStartSchema)
    .mutation(async ({ ctx, input }) => {
      const physio = ctx.auth.user;
      const [row] = await db
        .select({ rx: prescriptions, ex: exercises, patient: user })
        .from(prescriptions)
        .innerJoin(exercises, eq(exercises.id, prescriptions.exerciseId))
        .innerJoin(user, eq(user.id, prescriptions.patientId))
        .where(and(eq(prescriptions.id, input.prescriptionId), eq(prescriptions.physioId, physio.id)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Prescription not found" });
      if (!row.rx.active) throw new TRPCError({ code: "BAD_REQUEST", message: "This prescription is not active" });
      if (row.rx.targetAngle < row.ex.minPeak) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Target must be at least ${row.ex.minPeak}°` });
      }
      if (input.mode === "replay" && (!input.clip || !replayAllowList().includes(input.clip))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Replay clip is not allowed" });
      }

      const id = nanoid();
      await db.insert(callSessions).values({
        id, streamCallId: id, streamCallType: CALL_TYPE, status: "scheduled", mode: input.mode,
        physioId: physio.id, patientId: row.patient.id, prescriptionId: row.rx.id,
      });

      try {
        // The call must exist BEFORE the agent starts (else the agent's get_or_create uses type defaults).
        await createGuidedCall({
          callId: id, callSessionId: id, prescriptionId: row.rx.id, exerciseId: row.ex.id, mode: input.mode,
          physio: { id: physio.id, name: physio.name, image: physio.image },
          patient: { id: row.patient.id, name: row.patient.name, image: row.patient.image },
        });
        const agent = await startAgent(await agentPayload(id, input.mode === "replay" ? { clip: input.clip } : {}));
        await db.update(callSessions).set({ agentPid: `${agent.host}:${agent.pid}` }).where(eq(callSessions.id, id));
      } catch (e) {
        console.error("sessions.start failed", e instanceof AgentWorkerError ? e.message : e);
        await db.update(callSessions)
          .set({ status: "failed", failureReason: "agent_start_failed", endedAt: new Date(), updatedAt: new Date() })
          .where(eq(callSessions.id, id));
        await endGuidedCall(id).catch(() => undefined);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not start the coach. Try again." });
      }

      const { token, hash, expiresAt } = createJoinToken(row.patient.id, id, JOIN_LINK_TTL_HOURS * 3600);
      const [session] = await db.update(callSessions)
        .set({ joinTokenHash: hash, joinTokenExpiresAt: expiresAt, updatedAt: new Date() })
        .where(eq(callSessions.id, id))
        .returning();
      return { session, joinUrl: joinUrl(token) };
    }),

  regenerateJoinLink: physioProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await getOwnSession(ctx.auth.user.id, input.id);
      if (row.status !== "scheduled" && row.status !== "live") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This session has ended" });
      }
      const { token, hash, expiresAt } = createJoinToken(row.patientId, row.id, JOIN_LINK_TTL_HOURS * 3600);
      await db.update(callSessions).set({ joinTokenHash: hash, joinTokenExpiresAt: expiresAt, updatedAt: new Date() })
        .where(eq(callSessions.id, row.id));          // the old link stops working
      return { joinUrl: joinUrl(token), expiresAt };
    }),

  cancel: physioProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await getOwnSession(ctx.auth.user.id, input.id);
      if (row.status !== "scheduled") throw new TRPCError({ code: "BAD_REQUEST", message: "Only a scheduled session can be cancelled" });
      const [updated] = await db.update(callSessions)
        .set({ status: "failed", failureReason: "cancelled", endedAt: new Date(), updatedAt: new Date() })
        .where(eq(callSessions.id, row.id)).returning();
      await stopAgent(row.id).catch(() => false);
      await endGuidedCall(row.streamCallId, row.streamCallType).catch(() => undefined);
      return updated;
    }),

  end: physioProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await getOwnSession(ctx.auth.user.id, input.id);
      await stopAgent(row.id, "end").catch(() => false);
      await endGuidedCall(row.streamCallId, row.streamCallType).catch(() => undefined);
      return row;                                      // status settles via the agent callback / webhook
    }),

  restartAgent: physioProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await getOwnSession(ctx.auth.user.id, input.id);
      if (row.status !== "live") throw new TRPCError({ code: "BAD_REQUEST", message: "Only a live session can restart its coach" });
      await stopAgent(row.id, "restart").catch(() => false);
      // Wait until the old agent is gone (the worker SIGKILLs after 10 s): two agents with one user id
      // must never be in the call together.
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline && (await getAgent(row.id).catch(() => null))) {
        await new Promise((r) => setTimeout(r, 500));
      }
      const [{ maxSet }] = await db.select({ maxSet: sql<number | null>`max(${setResults.setIndex})` })
        .from(setResults).where(eq(setResults.callSessionId, row.id));
      try {
        const agent = await startAgent(await agentPayload(row.id, {
          startSetIndex: (maxSet ?? 0) + 1, consentGiven: !!row.consentGivenAt,
        }));
        const agentPid = `${agent.host}:${agent.pid}`;
        await db.update(callSessions).set({ agentPid, updatedAt: new Date() }).where(eq(callSessions.id, row.id));
        return { agentPid };
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not restart the coach. Try again." });
      }
    }),

  acknowledgeSafety: physioProcedure
    .input(z.object({ safetyEventId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [ev] = await db
        .select({ id: safetyEvents.id })
        .from(safetyEvents)
        .innerJoin(callSessions, eq(callSessions.id, safetyEvents.callSessionId))
        .where(and(eq(safetyEvents.id, input.safetyEventId), eq(callSessions.physioId, ctx.auth.user.id)));
      if (!ev) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
      const [updated] = await db.update(safetyEvents).set({ acknowledgedAt: new Date() })
        .where(eq(safetyEvents.id, ev.id)).returning();
      return updated;
    }),

  /** Physio Stop: the authenticated twin of join.sendInput (backup path, §7.8). */
  sendInput: physioProcedure
    .input(sessionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await getOwnSession(ctx.auth.user.id, input.id);
      if (input.event.type !== "pc.stop") throw new TRPCError({ code: "BAD_REQUEST", message: "Only Stop is accepted" });
      await db.insert(safetyEvents).values({
        callSessionId: row.id, patientId: row.patientId, kind: "stop", source: "ui", clientEventId: input.event.eventId,
      }).onConflictDoNothing();
      await forwardInput(row.id, ctx.auth.user.id, input.event).catch((e) => console.warn("forwardInput", e.message));
      return { ok: true as const };
    }),

  physioToken: physioProcedure.mutation(async ({ ctx }) => {
    const u = ctx.auth.user;
    await upsertStreamUsers([{
      id: u.id, name: u.name, image: u.image ?? generateAvatarUri({ seed: u.name, variant: "initials" }), appRole: "physio",
    }]);
    return createPhysioUserToken(u.id);
  }),
});
