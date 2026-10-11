import { drizzle } from "drizzle-orm/neon-http";

import { lazy } from "@/lib/lazy";
import * as schema from "./schema";

// Lazy so `next build` does not need DATABASE_URL. neon-http has no interactive
// transactions: use `db.batch([...])` for multi-statement writes.
// Tolerate a value pasted with surrounding quotes (e.g. in a deploy dashboard).
const databaseUrl = () => (process.env.DATABASE_URL ?? "").trim().replace(/^["']|["']$/g, "");
export const db = lazy(() => drizzle(databaseUrl(), { schema }));
