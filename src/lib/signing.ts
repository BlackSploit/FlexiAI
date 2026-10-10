import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC request signing between web and agent-worker (§4.3, §7.6, §7.9). Mirrors
 * agent/physiocoach/core/signing.py exactly; shared/fixtures/signing/vectors.json checks both.
 *
 * x-pc-signature: t=<unix s>,v1=<hex HMAC-SHA256(secret, "<t>.<METHOD>.<pathWithQuery>.<sha256hex(body)>")>
 * Binding method and path stops a captured signed `GET /sessions/A` being replayed as `DELETE /sessions/B`.
 */
export const SIGNATURE_HEADER = "x-pc-signature";

const sha256hex = (body: string | Uint8Array) => createHash("sha256").update(body).digest("hex");

const mac = (secret: string, t: number, method: string, pathWithQuery: string, body: string | Uint8Array) =>
  createHmac("sha256", secret)
    .update(`${t}.${method.toUpperCase()}.${pathWithQuery}.${sha256hex(body)}`)
    .digest("hex");

export function signRequest(
  secret: string,
  method: string,
  pathWithQuery: string,
  body: string | Uint8Array,
  t: number = Math.floor(Date.now() / 1000),
): string {
  return `t=${t},v1=${mac(secret, t, method, pathWithQuery, body)}`;
}

export function verifySignedRequest(
  secret: string,
  method: string,
  pathWithQuery: string,
  body: string | Uint8Array,
  header: string | null | undefined,
  maxAgeSec = 300,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)];
    }),
  );
  const t = Number(parts.t);
  const given = parts.v1;
  if (!Number.isInteger(t) || !given || Math.abs(now - t) > maxAgeSec) return false;
  const expected = Buffer.from(mac(secret, t, method, pathWithQuery, body), "hex");
  const got = Buffer.from(given, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
