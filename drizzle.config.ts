import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    // Tolerate a value pasted with surrounding quotes.
    url: (process.env.DATABASE_URL ?? "").trim().replace(/^["']|["']$/g, ""),
  },
});
