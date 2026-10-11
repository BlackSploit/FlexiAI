import { sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * Correlated `(select count(*) ...)` column, the same SQL as `db.$count(table, where)` but without touching the
 * lazy db client, so it is safe in module-level column maps (evaluated during `next build` with no DATABASE_URL).
 */
export const countOf = (table: PgTable, where?: SQL) =>
  sql<number>`(select count(*) from ${table}${where ? sql` where ${where}` : sql``})`.mapWith(Number);
