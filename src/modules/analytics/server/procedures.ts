import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { callSessions, physioPatientLinks, prescriptions, safetyEvents, setResults, user, weeklySummaries } from "@/db/schema";
import { createTRPCRouter, physioProcedure } from "@/trpc/init";
import { assertOwnPatient } from "@/modules/patients/server/procedures";

import { adherencePct, weeklySummaryRules } from "../lib/weekly-summary-rules";

/** Weeks start Monday 00:00 Asia/Kolkata; stored timestamps are UTC wall time. */
const IST = (col: string) => sql.raw(`((${col}) at time zone 'UTC') at time zone 'Asia/Kolkata'`);
const weekOf = (col: string) => sql`date_trunc('week', ${IST(col)})::date`;
const weekStartSql = (weekStart?: string | null) =>
  weekStart ? sql`date_trunc('week', ${weekStart}::date)::date` : sql`date_trunc('week', now() at time zone 'Asia/Kolkata')::date`;
const modeFilter = (includeReplay: boolean) => sql.raw(includeReplay ? "true" : "cs.mode = 'live'");
const weekInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish();

/** Numbers for one patient-week, computed live (DEV-5). */
async function weekNumbers(physioId: string, patientId: string, weekStart: string | null | undefined, includeReplay: boolean) {
  const ws = weekStartSql(weekStart);
  const sessionWeek = weekOf("coalesce(cs.started_at, cs.scheduled_at)");
  const [row] = await db.execute(sql`
    with s as (
      select cs.id, ${sessionWeek} as wk from call_sessions cs
      where cs.patient_id = ${patientId} and cs.physio_id = ${physioId} and ${modeFilter(includeReplay)}
    )
    select
      (select count(distinct s.id) from s where s.wk = ${ws}
         and exists (select 1 from set_results sr where sr.call_session_id = s.id))::int as "sessionsDone",
      coalesce((select sum(p.sessions_per_week) from prescriptions p
         where p.patient_id = ${patientId} and p.physio_id = ${physioId} and p.active), 0)::int as "sessionsPlanned",
      (select avg(sr.avg_peak) from set_results sr join s on s.id = sr.call_session_id where s.wk = ${ws}) as "avgPeak",
      (select avg(sr.avg_peak) from set_results sr join s on s.id = sr.call_session_id
         where s.wk = (${ws} - interval '7 days')::date) as "avgPeakLastWeek",
      (select max(sr.best_peak) from set_results sr join s on s.id = sr.call_session_id where s.wk = ${ws}) as "bestPeak",
      (select max(sr.pain) from set_results sr join s on s.id = sr.call_session_id where s.wk = ${ws}) as "maxPain",
      (select case when sum(sr.reps_done) > 0 then 100.0 * sum(sr.fast_reps) / sum(sr.reps_done) end
         from set_results sr join s on s.id = sr.call_session_id where s.wk = ${ws}) as "fastRepPct",
      (select p.target_angle from prescriptions p where p.patient_id = ${patientId} and p.physio_id = ${physioId}
         order by p.active desc, p.created_at desc limit 1) as "targetAngle",
      ${ws}::text as "weekStart"
  `).then((r) => r.rows as Record<string, unknown>[]);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    sessionsDone: Number(row.sessionsDone), sessionsPlanned: Number(row.sessionsPlanned),
    avgPeak: num(row.avgPeak), avgPeakLastWeek: num(row.avgPeakLastWeek), bestPeak: num(row.bestPeak),
    maxPain: num(row.maxPain), fastRepPct: num(row.fastRepPct), targetAngle: num(row.targetAngle),
    weekStart: String(row.weekStart),
  };
}

export const analyticsRouter = createTRPCRouter({
  overview: physioProcedure.query(async ({ ctx }) => {
    const me = ctx.auth.user.id;
    const [row] = await db.execute(sql`
      select
        (select count(*) from call_sessions where physio_id = ${me} and status = 'live')::int as "liveSessions",
        (select count(*) from call_sessions cs where cs.physio_id = ${me}
           and ${weekOf("coalesce(cs.started_at, cs.scheduled_at)")} = ${weekStartSql()})::int as "sessionsThisWeek",
        (select count(*) from safety_events se join call_sessions cs on cs.id = se.call_session_id
           where cs.physio_id = ${me} and se.acknowledged_at is null)::int as "openPainFlags",
        (select count(distinct patient_id) from prescriptions where physio_id = ${me} and active)::int as "activePatients"
    `).then((r) => r.rows as Record<string, number>[]);
    return row as { liveSessions: number; sessionsThisWeek: number; openPainFlags: number; activePatients: number };
  }),

  romTrend: physioProcedure
    .input(z.object({
      patientId: z.string(), prescriptionId: z.string().nullish(), days: z.number().int().min(1).max(365).default(30),
      includeReplay: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      await assertOwnPatient(ctx.auth.user.id, input.patientId);
      const since = new Date(Date.now() - input.days * 86_400_000);
      const date = sql<Date>`coalesce(${callSessions.startedAt}, ${callSessions.scheduledAt})`;
      const points = await db
        .select({
          sessionId: callSessions.id,
          date,
          avgPeak: sql<number>`round(avg(${setResults.avgPeak})::numeric, 1)::float`,
          bestPeak: sql<number>`max(${setResults.bestPeak})`,
          score: sql<number>`max(${setResults.score})`,
          isReplay: sql<boolean>`${callSessions.mode} = 'replay'`,
        })
        .from(callSessions)
        .innerJoin(setResults, eq(setResults.callSessionId, callSessions.id))
        .where(and(
          eq(callSessions.physioId, ctx.auth.user.id),
          eq(callSessions.patientId, input.patientId),
          input.prescriptionId ? eq(callSessions.prescriptionId, input.prescriptionId) : undefined,
          gte(date, since),
          input.includeReplay ? undefined : eq(callSessions.mode, "live"),
        ))
        .groupBy(callSessions.id)
        .orderBy(date);
      const [rx] = await db.select({ targetAngle: prescriptions.targetAngle }).from(prescriptions)
        .where(and(
          eq(prescriptions.physioId, ctx.auth.user.id),
          input.prescriptionId ? eq(prescriptions.id, input.prescriptionId) : eq(prescriptions.patientId, input.patientId),
        ))
        .orderBy(desc(prescriptions.active), desc(prescriptions.createdAt)).limit(1);
      return { targetAngle: rx?.targetAngle ?? null, points };
    }),

  adherence: physioProcedure
    .input(z.object({ patientId: z.string().nullish(), weekStart: weekInput, includeReplay: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      const me = ctx.auth.user.id;
      const ws = weekStartSql(input.weekStart);
      const rows = await db
        .select({
          patientId: user.id,
          name: user.name,
          planned: sql<number>`coalesce((select sum(p.sessions_per_week) from prescriptions p
            where p.patient_id = ${user.id} and p.physio_id = ${me} and p.active), 0)::int`,
          done: sql<number>`(select count(distinct cs.id) from call_sessions cs
            where cs.patient_id = ${user.id} and cs.physio_id = ${me} and ${modeFilter(input.includeReplay)}
              and ${weekOf("coalesce(cs.started_at, cs.scheduled_at)")} = ${ws}
              and exists (select 1 from set_results sr where sr.call_session_id = cs.id))::int`,
        })
        .from(user)
        .innerJoin(physioPatientLinks, eq(physioPatientLinks.patientId, user.id))
        .where(and(eq(physioPatientLinks.physioId, me), input.patientId ? eq(user.id, input.patientId) : undefined))
        .orderBy(user.name);
      return rows.map((r) => ({ ...r, pct: adherencePct(r.done, r.planned) }));
    }),

  painFlags: physioProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(7) }).default({}))
    .query(async ({ ctx, input }) => {
      return db
        .select({
          id: safetyEvents.id, sessionId: safetyEvents.callSessionId, kind: safetyEvents.kind,
          symptom: safetyEvents.symptom, painScore: safetyEvents.painScore, setIndex: safetyEvents.setIndex,
          at: safetyEvents.createdAt, acknowledgedAt: safetyEvents.acknowledgedAt,
          patient: { id: user.id, name: user.name },
        })
        .from(safetyEvents)
        .innerJoin(callSessions, eq(callSessions.id, safetyEvents.callSessionId))
        .innerJoin(user, eq(user.id, safetyEvents.patientId))
        .where(and(eq(callSessions.physioId, ctx.auth.user.id),
          gte(safetyEvents.createdAt, new Date(Date.now() - input.days * 86_400_000))))
        .orderBy(desc(safetyEvents.createdAt));
    }),

  weeklySummary: physioProcedure
    .input(z.object({ patientId: z.string(), weekStart: weekInput, includeReplay: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      await assertOwnPatient(ctx.auth.user.id, input.patientId);
      const n = await weekNumbers(ctx.auth.user.id, input.patientId, input.weekStart, input.includeReplay);
      const base = {
        ...n,
        adherencePct: adherencePct(n.sessionsDone, n.sessionsPlanned),
        avgPeakDeltaVsLastWeek: n.avgPeak !== null && n.avgPeakLastWeek !== null
          ? Math.round((n.avgPeak - n.avgPeakLastWeek) * 10) / 10 : null,
      };
      const [stored] = await db.select().from(weeklySummaries)
        .where(and(eq(weeklySummaries.patientId, input.patientId), eq(weeklySummaries.weekStart, n.weekStart)));
      if (stored) return { ...base, textEn: stored.textEn, textMl: stored.textMl, source: stored.source };
      return { ...base, ...weeklySummaryRules(n), source: "rules" as const };
    }),
});
