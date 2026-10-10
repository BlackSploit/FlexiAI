import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { callSessions, exercises, prescriptions, user } from "@/db/schema";
import { createTRPCRouter, physioProcedure } from "@/trpc/init";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/constants";
import { assertOwnPatient } from "@/modules/patients/server/procedures";

import { prescriptionsInsertSchema, prescriptionsUpdateSchema } from "../schemas";

const listColumns = {
  ...getTableColumns(prescriptions),
  patient: { id: user.id, name: user.name, image: user.image },
  exercise: { id: exercises.id, nameEn: exercises.nameEn, nameMl: exercises.nameMl },
  sessionCount: db.$count(callSessions, eq(callSessions.prescriptionId, prescriptions.id)),
  lastScore: sql<number | null>`(select sr.score from set_results sr join call_sessions cs on cs.id = sr.call_session_id
    where cs.prescription_id = ${prescriptions.id} order by sr.created_at desc limit 1)`,
};

/** A prescription target below minPeak could never be reached: reps below minPeak are not counted (DEV-6). */
async function checkExerciseTarget(exerciseId: string, targetAngle: number) {
  const [ex] = await db.select().from(exercises).where(eq(exercises.id, exerciseId));
  if (!ex) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown exercise" });
  if (targetAngle < ex.minPeak) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Target must be at least ${ex.minPeak}°` });
  }
  return ex;
}

async function getOwn(physioId: string, id: string) {
  const [row] = await db
    .select({ ...listColumns, exerciseFull: getTableColumns(exercises) })
    .from(prescriptions)
    .innerJoin(user, eq(user.id, prescriptions.patientId))
    .innerJoin(exercises, eq(exercises.id, prescriptions.exerciseId))
    .where(and(eq(prescriptions.id, id), eq(prescriptions.physioId, physioId)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Prescription not found" });
  return row;
}

export const prescriptionsRouter = createTRPCRouter({
  getMany: physioProcedure
    .input(
      z.object({
        page: z.number().default(DEFAULT_PAGE),
        pageSize: z.number().min(MIN_PAGE_SIZE).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
        search: z.string().nullish(),
        patientId: z.string().nullish(),
        exerciseId: z.string().nullish(),
        active: z.boolean().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { page, pageSize, search, patientId, exerciseId, active } = input;
      const where = and(
        eq(prescriptions.physioId, ctx.auth.user.id),
        search ? or(ilike(user.name, `%${search}%`), ilike(exercises.nameEn, `%${search}%`)) : undefined,
        patientId ? eq(prescriptions.patientId, patientId) : undefined,
        exerciseId ? eq(prescriptions.exerciseId, exerciseId) : undefined,
        active === true || active === false ? eq(prescriptions.active, active) : undefined,
      );
      const data = await db
        .select(listColumns)
        .from(prescriptions)
        .innerJoin(user, eq(user.id, prescriptions.patientId))
        .innerJoin(exercises, eq(exercises.id, prescriptions.exerciseId))
        .where(where)
        .orderBy(desc(prescriptions.createdAt), desc(prescriptions.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const [total] = await db
        .select({ count: count() })
        .from(prescriptions)
        .innerJoin(user, eq(user.id, prescriptions.patientId))
        .innerJoin(exercises, eq(exercises.id, prescriptions.exerciseId))
        .where(where);
      return { items: data, total: total.count, totalPages: Math.ceil(total.count / pageSize) };
    }),

  getOne: physioProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { exerciseFull, ...row } = await getOwn(ctx.auth.user.id, input.id);
      return { ...row, exercise: exerciseFull };
    }),

  create: physioProcedure
    .input(prescriptionsInsertSchema)
    .mutation(async ({ ctx, input }) => {
      await assertOwnPatient(ctx.auth.user.id, input.patientId);
      await checkExerciseTarget(input.exerciseId, input.targetAngle);
      const [created] = await db.insert(prescriptions).values({ ...input, physioId: ctx.auth.user.id }).returning();
      return created;
    }),

  update: physioProcedure
    .input(prescriptionsUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      await getOwn(ctx.auth.user.id, input.id);
      await assertOwnPatient(ctx.auth.user.id, input.patientId);
      await checkExerciseTarget(input.exerciseId, input.targetAngle);
      const { id, ...values } = input;
      const [updated] = await db
        .update(prescriptions)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(prescriptions.id, id), eq(prescriptions.physioId, ctx.auth.user.id)))
        .returning();
      return updated;
    }),

  remove: physioProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await getOwn(ctx.auth.user.id, input.id);
      if (row.sessionCount > 0) {
        // Sessions reference it: keep the history, stop offering it.
        await db.update(prescriptions).set({ active: false, updatedAt: new Date() }).where(eq(prescriptions.id, input.id));
        return { id: input.id, deactivated: true };
      }
      await db.delete(prescriptions).where(eq(prescriptions.id, input.id));
      return { id: input.id, deactivated: false };
    }),
});
