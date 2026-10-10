import { drizzle } from "drizzle-orm/neon-http";

import { lazy } from "@/lib/lazy";
import * as schema from "./schema";

// Lazy so `next build` does not need DATABASE_URL. neon-http has no interactive
// transactions: use `db.batch([...])` for multi-statement writes.
export const db = lazy(() => drizzle(process.env.DATABASE_URL!, { schema }));
