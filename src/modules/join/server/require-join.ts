import "server-only";

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";

import { db } from "@/db";
import { callSessions } from "@/db/schema";
import { hashToken, verifyJoinToken } from "@/lib/join-token";
import { rateLimit } from "@/lib/rate-limit";

const denied = () => new TRPCError({ code: "UNAUTHORIZED", message: "This link has expired or is invalid." });

/**
 * Patient access by signed link (§7.2). Checks, in order: shape -> HMAC -> v -> not expired -> session exists
 * -> sha256(token) === joinTokenHash (regenerating revokes the old link) -> patientId === sub -> status
 * scheduled|live. Any failure: UNAUTHORIZED with one generic message. Rate-limited per ip + token hash.
 */
export async function requireJoin(token: string) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  const tokenHash = hashToken(token);
  if (!rateLimit(`${ip}:${tokenHash}`)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests, slow down." });
  }
  const claims = verifyJoinToken(token);
  if (!claims) throw denied();
  const [session] = await db.select().from(callSessions).where(eq(callSessions.id, claims.csid));
  if (!session || session.joinTokenHash !== tokenHash || session.patientId !== claims.sub) throw denied();
  if (session.status !== "scheduled" && session.status !== "live") throw denied();
  return session;
}
