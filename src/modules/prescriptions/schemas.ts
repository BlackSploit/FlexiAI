import { z } from "zod";

import { MAX_REPS } from "@/constants";

// Form-typing rules (§4.5): no .default() here (defaults live in the form's defaultValues and the DB);
// number inputs emit strings, hence z.coerce.number().
export const prescriptionsInsertSchema = z.object({
  patientId: z.string().min(1, { message: "Patient is required" }),
  exerciseId: z.enum(["knee_bend", "elbow_bend", "shoulder_raise"], { message: "Exercise is required" }),
  side: z.enum(["auto", "left", "right"]),
  targetAngle: z.coerce.number().int().min(10).max(180),
  reps: z.coerce.number().int().min(1).max(MAX_REPS),
  sets: z.coerce.number().int().min(1).max(5),
  minSecondsPerRep: z.coerce.number().min(0.5).max(10),
  sessionsPerWeek: z.coerce.number().int().min(1).max(14),
  active: z.boolean(),
});

export const prescriptionsUpdateSchema = prescriptionsInsertSchema.extend({
  id: z.string().min(1),
});
