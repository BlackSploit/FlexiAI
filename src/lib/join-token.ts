import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed patient join link (§7.2): `${NEXT_PUBLIC_APP_URL}/join/<token>`.
 * token = base64url(JSON{sub: patientId, csid: callSessionId, exp, v: 1}) + "." + base64url(HMAC-SHA256(body))
 * Only sha256(token) is stored (call_sessions.join_token_hash): regenerating revokes the old link.
 * The token is a bearer credential: never log it.
 */
const SECRET = () => {
  const s = process.env.JOIN_LINK_SECRET;
  if (!s || s.length < 32) throw new Error("JOIN_LINK_SECRET missing or too short");
  return s;
};

export type JoinClaims = { sub: string; csid: string; exp: number; v: 1 };

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (body: string) => createHmac("sha256", SECRET()).update(body).digest();

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createJoinToken(patientId: string, callSessionId: string, ttlSec: number) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = b64u(JSON.stringify({ sub: patientId, csid: callSessionId, exp, v: 1 } satisfies JoinClaims));
  const token = `${body}.${b64u(sign(body))}`;
  return { token, hash: hashToken(token), expiresAt: new Date(exp * 1000) };
}

export function verifyJoinToken(token: string): JoinClaims | null {
  if (token.length > 1024) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString()) as JoinClaims;
    if (c.v !== 1 || typeof c.exp !== "number" || c.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof c.sub !== "string" || typeof c.csid !== "string") return null;
    return c;
  } catch {
    return null;
  }
}
