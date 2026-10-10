import { z } from "zod";

// .refine() yields a ZodEffects (no .extend), so both schemas are built from the base object.
const patientBase = z.object({
  name: z.string().min(1, { message: "Name is required" }).max(120),
  phone: z.string().regex(/^\+?[0-9]{8,15}$/, { message: "Use 8-15 digits, optionally starting with +" }).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  preferredLanguage: z.enum(["ml", "en"]),
});

const needsContact = (v: { phone?: string; email?: string }) => !!v.phone || !!v.email;
const contactMsg = { message: "Phone or email required", path: ["phone"] };

export const patientsInsertSchema = patientBase.refine(needsContact, contactMsg);
export const patientsUpdateSchema = patientBase.extend({ id: z.string().min(1) }).refine(needsContact, contactMsg);

export const PLACEHOLDER_EMAIL_DOMAIN = "patients.physiocoach.invalid";
export const isPlaceholderEmail = (email?: string | null) => !!email && email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
