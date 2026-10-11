import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "@/db";
import * as schema from "@/db/schema";

export const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.ALLOW_SIGNUP === "false",
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      ...schema,
    },
  }),
  trustedOrigins: [
    ...new Set([process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000", "http://localhost:3000"]),
    ...(process.env.NGROK_DOMAIN ? [`https://${process.env.NGROK_DOMAIN}`] : []),
  ],
  user: {
    additionalFields: {
      // Sign-up can never set the role: physios sign up; patients are created only by patients.create.
      role: { type: "string", required: false, defaultValue: "physio", input: false },
      phone: { type: "string", required: false },
      preferredLanguage: { type: "string", required: false, defaultValue: "ml", input: false },
    },
  },
});
