import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { db } from "@/db";
import { physioNotes } from "@/db/schema";
import { createTRPCRouter, physioProcedure } from "@/trpc/init";
import { assertOwnPatient } from "@/modules/patients/server/procedures";

export const notesRouter = createTRPCRouter({
  getMany: physioProcedure
    .input(z.object({ patientId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertOwnPatient(ctx.auth.user.id, input.patientId);
      return db.select().from(physioNotes)
        .where(and(eq(physioNotes.patientId, input.patientId), eq(physioNotes.physioId, ctx.auth.user.id)))
        .orderBy(desc(physioNotes.createdAt));
    }),

  create: physioProcedure
    .input(z.object({ patientId: z.string(), text: z.string().trim().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnPatient(ctx.auth.user.id, input.patientId);
      const [note] = await db.insert(physioNotes)
        .values({ patientId: input.patientId, physioId: ctx.auth.user.id, text: input.text }).returning();
      return note;
    }),

  remove: physioProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [removed] = await db.delete(physioNotes)
        .where(and(eq(physioNotes.id, input.id), eq(physioNotes.physioId, ctx.auth.user.id))).returning();
      if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
      return { id: removed.id };
    }),
});
