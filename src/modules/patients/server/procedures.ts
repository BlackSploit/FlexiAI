import { z } from "zod";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { callSessions, physioPatientLinks, prescriptions, user } from "@/db/schema";
import { createTRPCRouter, physioProcedure } from "@/trpc/init";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/constants";

import { PLACEHOLDER_EMAIL_DOMAIN, patientsInsertSchema, patientsUpdateSchema } from "../schemas";

const patientColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  image: user.image,
  preferredLanguage: user.preferredLanguage,
  createdAt: user.createdAt,
  sessionCount: db.$count(callSessions, eq(callSessions.patientId, user.id)),
  activePrescriptionCount: db.$count(prescriptions, and(eq(prescriptions.patientId, user.id), eq(prescriptions.active, true))),
  lastSessionAt: sql<Date | null>`(select max(coalesce(cs.started_at, cs.scheduled_at)) from call_sessions cs where cs.patient_id = ${user.id})`,
  latestPain: sql<number | null>`(select sr.pain from set_results sr join call_sessions cs on cs.id = sr.call_session_id
    where cs.patient_id = ${user.id} and sr.pain is not null order by sr.created_at desc limit 1)`,
};

/** Postgres unique violation (23505), however the driver wraps it. */
const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
};

const conflict = () => new TRPCError({ code: "CONFLICT", message: "A user with this email or phone already exists" });

/** The patient must be linked to this physio; NOT_FOUND otherwise (never FORBIDDEN). */
export async function assertOwnPatient(physioId: string, patientId: string) {
  const [link] = await db
    .select({ patientId: physioPatientLinks.patientId })
    .from(physioPatientLinks)
    .where(and(eq(physioPatientLinks.physioId, physioId), eq(physioPatientLinks.patientId, patientId)));
  if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "Patient not found" });
}

export const patientsRouter = createTRPCRouter({
  getMany: physioProcedure
    .input(
      z.object({
        page: z.number().default(DEFAULT_PAGE),
        pageSize: z.number().min(MIN_PAGE_SIZE).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
        search: z.string().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { search, page, pageSize } = input;
      const where = and(
        eq(physioPatientLinks.physioId, ctx.auth.user.id),
        search ? or(ilike(user.name, `%${search}%`), ilike(user.phone, `%${search}%`)) : undefined,
      );

      const data = await db
        .select(patientColumns)
        .from(user)
        .innerJoin(physioPatientLinks, eq(physioPatientLinks.patientId, user.id))
        .where(where)
        .orderBy(desc(user.createdAt), desc(user.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [total] = await db
        .select({ count: count() })
        .from(user)
        .innerJoin(physioPatientLinks, eq(physioPatientLinks.patientId, user.id))
        .where(where);

      return { items: data, total: total.count, totalPages: Math.ceil(total.count / pageSize) };
    }),

  getOne: physioProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [patient] = await db
        .select(patientColumns)
        .from(user)
        .innerJoin(physioPatientLinks, eq(physioPatientLinks.patientId, user.id))
        .where(and(eq(user.id, input.id), eq(physioPatientLinks.physioId, ctx.auth.user.id)));
      if (!patient) throw new TRPCError({ code: "NOT_FOUND", message: "Patient not found" });
      return patient;
    }),

  create: physioProcedure
    .input(patientsInsertSchema)
    .mutation(async ({ ctx, input }) => {
      // v1: every patient row belongs to exactly one physio; an existing account is never attached by email.
      const id = nanoid();
      const now = new Date();
      try {
        const [[created]] = await db.batch([
          db.insert(user).values({
            id, name: input.name, role: "patient", emailVerified: false, preferredLanguage: input.preferredLanguage,
            email: input.email || `p_${id}@${PLACEHOLDER_EMAIL_DOMAIN}`, phone: input.phone || null,
            createdAt: now, updatedAt: now,
          }).returning(),
          db.insert(physioPatientLinks).values({ physioId: ctx.auth.user.id, patientId: id }),
        ]);
        return created;
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict();
        throw e;
      }
    }),

  update: physioProcedure
    .input(patientsUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      await assertOwnPatient(ctx.auth.user.id, input.id);
      try {
        const [updated] = await db
          .update(user)
          .set({
            name: input.name,
            phone: input.phone || null,
            preferredLanguage: input.preferredLanguage,
            ...(input.email ? { email: input.email } : {}),     // keep the placeholder when cleared
            updatedAt: new Date(),
          })
          .where(eq(user.id, input.id))
          .returning();
        return updated;
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict();
        throw e;
      }
    }),

  remove: physioProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnPatient(ctx.auth.user.id, input.id);
      // Sessions, prescriptions, results and notes cascade with the patient user.
      await db.batch([
        db.delete(physioPatientLinks).where(and(
          eq(physioPatientLinks.physioId, ctx.auth.user.id), eq(physioPatientLinks.patientId, input.id))),
        db.delete(user).where(and(eq(user.id, input.id), eq(user.role, "patient"))),
      ]);
      return { id: input.id };
    }),
});
