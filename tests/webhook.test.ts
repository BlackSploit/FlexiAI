import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeDb } from "./stubs/fake-db";

const fake = vi.hoisted(() => ({ value: null as ReturnType<typeof createFakeDb> | null }));
vi.mock("@/db", async () => {
  const { createFakeDb } = await import("./stubs/fake-db");
  fake.value = createFakeDb();
  return { db: fake.value.db };
});
const lifecycle = vi.hoisted(() => ({ markLive: vi.fn(), finalizeSession: vi.fn(), recordAgentDown: vi.fn() }));
vi.mock("@/modules/sessions/server/lifecycle", () => lifecycle);
const worker = vi.hoisted(() => ({ getAgent: vi.fn(), stopAgent: vi.fn() }));
vi.mock("@/lib/agent-worker", () => worker);
const verify = vi.hoisted(() => ({ ok: true }));
vi.mock("@/lib/stream-video", () => ({ streamVideo: { verifyWebhook: () => verify.ok } }));

const { POST } = await import("@/app/api/webhook/route");
const { AGENT_USER_ID } = await import("@/constants");

const SESSION = { id: "cs_1", patientId: "pat_1", agentPid: "w1:42", status: "live", streamCallId: "call_abc" };
const db = () => fake.value!;

const hook = (payload: object, headers: Record<string, string> = { "x-signature": "sig", "x-api-key": "key" }) =>
  POST(new NextRequest("http://localhost/api/webhook", { method: "POST", body: JSON.stringify(payload), headers }));

describe("POST /api/webhook", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_STREAM_VIDEO_API_KEY", "key");
    verify.ok = true;
    db().reset();
    db().rows = [SESSION];
    for (const f of [...Object.values(lifecycle), ...Object.values(worker)]) f.mockReset();
    worker.stopAgent.mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects missing headers, a wrong key and a bad signature", async () => {
    expect((await hook({ type: "call.ended" }, {})).status).toBe(400);
    expect((await hook({ type: "call.ended" }, { "x-signature": "s", "x-api-key": "other" })).status).toBe(401);
    verify.ok = false;
    expect((await hook({ type: "call.ended" })).status).toBe(401);
  });

  it("ignores unknown calls with 200", async () => {
    db().rows = [];
    const res = await hook({ type: "call.ended", call_cid: "default:nope" });
    expect(res.status).toBe(200);
    expect(lifecycle.finalizeSession).not.toHaveBeenCalled();
  });

  it("session_started marks live (call id read from call_cid)", async () => {
    await hook({ type: "call.session_started", call_cid: "default:call_abc" });
    expect(lifecycle.markLive).toHaveBeenCalledWith(SESSION.id);
  });

  it("call ended finalizes and stops the agent", async () => {
    await hook({ type: "call.ended", call: { id: "call_abc" } });
    expect(lifecycle.finalizeSession).toHaveBeenCalledWith(SESSION.id, "no_sets");
    expect(worker.stopAgent).toHaveBeenCalledWith(SESSION.id);
  });

  it("agent leaving a live call records agent_down only when the worker has no process", async () => {
    const left = { type: "call.session_participant_left", call_cid: "default:call_abc", participant: { user: { id: AGENT_USER_ID } } };
    worker.getAgent.mockResolvedValueOnce({ pid: 1 });
    await hook(left);
    expect(lifecycle.recordAgentDown).not.toHaveBeenCalled();
    worker.getAgent.mockResolvedValueOnce(null);
    await hook(left);
    expect(lifecycle.recordAgentDown).toHaveBeenCalledWith(SESSION.id, SESSION.patientId, SESSION.agentPid, "webhook");
  });

  it("a patient leaving never ends anything", async () => {
    await hook({ type: "call.session_participant_left", call_cid: "default:call_abc", participant: { user: { id: "pat_1" } } });
    expect(lifecycle.finalizeSession).not.toHaveBeenCalled();
    expect(lifecycle.recordAgentDown).not.toHaveBeenCalled();
  });

  it("custom Stop / pain >= 7 become safety rows; low pain does not", async () => {
    await hook({ type: "custom", call_cid: "default:call_abc", custom: { type: "pc.stop", eventId: "e1" } });
    await hook({ type: "custom", call_cid: "default:call_abc", custom: { type: "pc.pain_score", eventId: "e2", score: 8, setIndex: 1 } });
    await hook({ type: "custom", call_cid: "default:call_abc", custom: { type: "pc.pain_score", eventId: "e3", score: 3, setIndex: 1 } });
    const inserts = db().calls.filter((c) => c.op === "insert").map((c) => c.args[1][0] as { kind: string; clientEventId: string });
    expect(inserts.map((i) => [i.kind, i.clientEventId])).toEqual([["stop", "e1"], ["pain", "e2"]]);
  });
});
