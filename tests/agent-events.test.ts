import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signRequest } from "@/lib/signing";

import { createFakeDb } from "./stubs/fake-db";

const fake = vi.hoisted(() => ({ value: null as ReturnType<typeof createFakeDb> | null }));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("./stubs/fake-db");
  fake.value = createFakeDb();
  return { db: fake.value.db };
});
const lifecycle = vi.hoisted(() => ({ markLive: vi.fn(), applyAgentExit: vi.fn() }));
vi.mock("@/modules/sessions/server/lifecycle", () => lifecycle);

const { POST } = await import("@/app/api/agent/events/route");

const SECRET = "c".repeat(40);
const PATH = "/api/agent/events";
const DIR = join(process.cwd(), "shared", "fixtures", "agent-callbacks");
const fixture = (kind: "valid" | "invalid", name: string) => readFileSync(join(DIR, kind, name), "utf8");
const SESSION = { id: "sess_demo01", patientId: "pat_1", agentPid: "w1:42", status: "live" };

const post = (body: string, header?: string | null) =>
  POST(new NextRequest(`http://localhost${PATH}`, {
    method: "POST",
    body,
    headers: header === null ? {} : { "x-pc-signature": header ?? signRequest(SECRET, "POST", PATH, body) },
  }));

const db = () => fake.value!;

describe("POST /api/agent/events", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_CALLBACK_SECRET", SECRET);
    db().reset();
    db().rows = [SESSION];
    lifecycle.markLive.mockReset();
    lifecycle.applyAgentExit.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("401 without or with a wrong signature", async () => {
    const body = fixture("valid", "heartbeat.json");
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, signRequest("x".repeat(40), "POST", PATH, body))).status).toBe(401);
    expect((await post(body, signRequest(SECRET, "POST", "/api/other", body))).status).toBe(401);
    expect(db().calls).toHaveLength(0);
  });

  it("400 for invalid JSON and every invalid fixture (dead-lettered, not retried)", async () => {
    expect((await post("{nope")).status).toBe(400);
    for (const f of readdirSync(join(DIR, "invalid"))) {
      expect((await post(fixture("invalid", f))).status, f).toBe(400);
    }
    expect(db().calls).toHaveLength(0);
  });

  it.each(readdirSync(join(DIR, "valid")))("200 for valid/%s", async (f) => {
    expect((await post(fixture("valid", f))).status).toBe(200);
  });

  it("200 and no writes for an unknown session", async () => {
    db().rows = [];
    expect((await post(fixture("valid", "set_result.json"))).status).toBe(200);
    expect(db().calls.map((c) => c.op)).toEqual(["select"]);
  });

  it("agent_joined marks the session live with host:pid", async () => {
    await post(fixture("valid", "agent_joined.json"));
    expect(lifecycle.markLive).toHaveBeenCalledWith(SESSION.id, expect.stringMatching(/.+:\d+/));
  });

  it("set_result upserts on (session, set)", async () => {
    await post(fixture("valid", "set_result.json"));
    const insert = db().calls.find((c) => c.op === "insert");
    expect(insert?.chain).toEqual(["values", "onConflictDoUpdate"]);
  });

  it("safety_alert inserts idempotently", async () => {
    await post(fixture("valid", "safety_alert.json"));
    const insert = db().calls.find((c) => c.op === "insert");
    expect(insert?.chain).toEqual(["values", "onConflictDoNothing"]);
    expect(insert?.args[1][0]).toMatchObject({ callSessionId: SESSION.id, patientId: SESSION.patientId, source: "agent" });
  });

  it("agent_exited maps through applyAgentExit", async () => {
    await post(fixture("valid", "agent_exited.json"));
    expect(lifecycle.applyAgentExit).toHaveBeenCalledWith(SESSION.id, expect.any(Number));
  });
});
