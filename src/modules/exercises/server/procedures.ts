import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { db } from "@/db";
import { exercises } from "@/db/schema";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";

export const exercisesRouter = createTRPCRouter({
  getMany: protectedProcedure.query(async () => db.select().from(exercises).orderBy(asc(exercises.nameEn))),

  getOne: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const [exercise] = await db.select().from(exercises).where(eq(exercises.id, input.id));
      if (!exercise) throw new TRPCError({ code: "NOT_FOUND", message: "Exercise not found" });
      return exercise;
    }),
});
