import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createJoinToken, hashToken, verifyJoinToken } from "@/lib/join-token";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";
import { signRequest, verifySignedRequest } from "@/lib/signing";

type Vector = { secret: string; t: number; method: string; path: string; body: string; header: string };
const vectors: Vector[] = JSON.parse(
  readFileSync(join(process.cwd(), "shared", "fixtures", "signing", "vectors.json"), "utf8"),
);

describe("signing (same vectors as agent/physiocoach/core/signing.py)", () => {
  it.each(vectors)("$method $path", (v) => {
    expect(signRequest(v.secret, v.method, v.path, v.body, v.t)).toBe(v.header);
    expect(verifySignedRequest(v.secret, v.method, v.path, v.body, v.header, 300, v.t)).toBe(true);
  });

  it("binds method, path, body and age", () => {
    const h = signRequest("k".repeat(40), "GET", "/sessions/A", "", 1000);
    expect(verifySignedRequest("k".repeat(40), "DELETE", "/sessions/A", "", h, 300, 1000)).toBe(false);
    expect(verifySignedRequest("k".repeat(40), "GET", "/sessions/B", "", h, 300, 1000)).toBe(false);
    expect(verifySignedRequest("k".repeat(40), "GET", "/sessions/A", "x", h, 300, 1000)).toBe(false);
    expect(verifySignedRequest("k".repeat(40), "GET", "/sessions/A", "", h, 300, 1301)).toBe(false);
    expect(verifySignedRequest("k".repeat(40), "GET", "/sessions/A", "", "garbage", 300, 1000)).toBe(false);
    expect(verifySignedRequest("", "GET", "/sessions/A", "", h, 300, 1000)).toBe(false);
  });
});

describe("join token", () => {
  beforeEach(() => vi.stubEnv("JOIN_LINK_SECRET", "j".repeat(40)));
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips and hashes", () => {
    const { token, hash, expiresAt } = createJoinToken("pat1", "cs1", 3600);
    expect(verifyJoinToken(token)).toMatchObject({ sub: "pat1", csid: "cs1", v: 1 });
    expect(hash).toBe(hashToken(token));
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects tampering, expiry, junk and a different secret", () => {
    const { token } = createJoinToken("pat1", "cs1", 3600);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "pat2", csid: "cs1", exp: 9e9, v: 1 })).toString("base64url");
    expect(verifyJoinToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyJoinToken(`${body}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(verifyJoinToken(createJoinToken("p", "c", -10).token)).toBeNull();
    expect(verifyJoinToken("not-a-token")).toBeNull();
    expect(verifyJoinToken("x".repeat(2000))).toBeNull();
    vi.stubEnv("JOIN_LINK_SECRET", "z".repeat(40));
    expect(verifyJoinToken(token)).toBeNull();
  });

  it("refuses a short secret", () => {
    vi.stubEnv("JOIN_LINK_SECRET", "short");
    expect(() => createJoinToken("p", "c", 60)).toThrow();
  });
});

describe("rate limit", () => {
  beforeEach(() => resetRateLimits());

  it("allows 10 per 10 s per key, then refills", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) expect(rateLimit("a", 10, 10_000, t0)).toBe(true);
    expect(rateLimit("a", 10, 10_000, t0)).toBe(false);
    expect(rateLimit("b", 10, 10_000, t0)).toBe(true);
    expect(rateLimit("a", 10, 10_000, t0 + 1_000)).toBe(true);
  });
});
