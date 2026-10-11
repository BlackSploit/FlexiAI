import { describe, expect, it, vi } from "vitest";

import type { AgentToClientEvent } from "@/modules/agent-bridge/schemas";

// The hook module imports the Stream React SDK; the reducer under test never touches it.
vi.mock("@stream-io/video-react-sdk", () => ({ useCall: () => null }));

const { feedReducer, initialFeed } = await import("@/modules/call/hooks/use-agent-events");

let seq = 0;
const env = () => ({ v: 1 as const, eventId: `evt_${String(++seq).padStart(8, "0")}`, ts: 1791700000000 + seq });
const run = (events: AgentToClientEvent[], state = initialFeed) => events.reduce(feedReducer, state);
const transcript = (role: "user" | "coach", turnId: string, text: string, final = true, lang?: "ml" | "en" | "other"): AgentToClientEvent =>
  ({ type: "pc.transcript", ...env(), role, turnId, text, final, ...(lang ? { lang } : {}) });

describe("feedReducer: initial state", () => {
  it("starts with an empty transcript, voice off and no live coach", () => {
    expect(initialFeed.transcript).toEqual([]);
    expect(initialFeed.voice).toBe("off");
    expect(initialFeed.liveCoach).toBe(false);
  });
});

describe("feedReducer: pc.transcript", () => {
  it("appends new turns in order", () => {
    const s = run([transcript("user", "t1", "hello"), transcript("coach", "r1", "നമസ്കാരം", true, "ml")]);
    expect(s.transcript).toEqual([
      { role: "user", turnId: "t1", text: "hello", final: true, lang: undefined },
      { role: "coach", turnId: "r1", text: "നമസ്കാരം", final: true, lang: "ml" },
    ]);
  });

  it("replaces a partial with its final in place (same role + turnId)", () => {
    const s = run([
      transcript("coach", "r1", "Good", false),
      transcript("user", "t1", "ok"),
      transcript("coach", "r1", "Good work, rest now", true, "en"),
    ]);
    expect(s.transcript).toHaveLength(2);
    expect(s.transcript[0]).toEqual({ role: "coach", turnId: "r1", text: "Good work, rest now", final: true, lang: "en" });
    expect(s.transcript[1].turnId).toBe("t1");
  });

  it("keys by role AND turnId: the same turnId under another role is a separate item", () => {
    const s = run([transcript("user", "x", "user text"), transcript("coach", "x", "coach text")]);
    expect(s.transcript.map((t) => `${t.role}:${t.text}`)).toEqual(["user:user text", "coach:coach text"]);
  });

  it("keeps only the last 20 items", () => {
    const s = run(Array.from({ length: 25 }, (_, i) => transcript("user", `t${i}`, `line ${i}`)));
    expect(s.transcript).toHaveLength(20);
    expect(s.transcript[0].turnId).toBe("t5");
    expect(s.transcript[19].turnId).toBe("t24");
  });

  it("updating an existing item at the cap does not grow or drop the list", () => {
    const full = run(Array.from({ length: 20 }, (_, i) => transcript("coach", `r${i}`, `line ${i}`, false)));
    const s = run([transcript("coach", "r0", "line 0 final", true)], full);
    expect(s.transcript).toHaveLength(20);
    expect(s.transcript[0]).toMatchObject({ turnId: "r0", text: "line 0 final", final: true });
  });

  it("does not disturb the other feed fields", () => {
    const before = run([{ type: "pc.state", ...env(), phase: "rest", setIndex: 1, setsPlanned: 2 }]);
    const s = run([transcript("coach", "r1", "rest")], before);
    expect({ ...s, transcript: before.transcript }).toEqual(before);
  });
});

describe("feedReducer: pc.voice", () => {
  it("sets voice and liveCoach from state and live", () => {
    let s = run([{ type: "pc.voice", ...env(), state: "off", live: true }]);
    expect(s.voice).toBe("off");
    expect(s.liveCoach).toBe(true);
    s = run([{ type: "pc.voice", ...env(), state: "listening", live: true }], s);
    expect(s).toMatchObject({ voice: "listening", liveCoach: true });
    s = run([{ type: "pc.voice", ...env(), state: "speaking", live: true }], s);
    expect(s.voice).toBe("speaking");
    s = run([{ type: "pc.voice", ...env(), state: "off", live: false }], s);
    expect(s).toMatchObject({ voice: "off", liveCoach: false });
  });

  it("keeps the transcript when the coach goes down", () => {
    const s = run([transcript("coach", "r1", "hi"), { type: "pc.voice", ...env(), state: "off", live: false }]);
    expect(s.transcript).toHaveLength(1);
  });
});

describe("feedReducer: existing events still work", () => {
  it("pc.ready and pc.state", () => {
    let s = run([{ type: "pc.ready", ...env(), agentVersion: "1.0" }]);
    expect(s.ready).toBe(true);
    s = run([{ type: "pc.state", ...env(), phase: "countdown", setIndex: 1, setsPlanned: 3 }], s);
    expect(s).toMatchObject({ phase: "countdown", setIndex: 1, setsPlanned: 3, reps: [], lastRep: null });
  });

  it("pc.rep accumulates and countdown resets", () => {
    const rep = { setIndex: 1, peak: 88, seconds: 2.5, tooFast: false, target: 90, repsPlanned: 10 };
    let s = run([{ type: "pc.rep", ...env(), n: 1, ...rep }, { type: "pc.rep", ...env(), n: 2, ...rep }]);
    expect(s.reps).toHaveLength(2);
    expect(s.lastRep?.n).toBe(2);
    s = run([{ type: "pc.state", ...env(), phase: "countdown", setIndex: 2, setsPlanned: 3 }], s);
    expect(s.reps).toEqual([]);
  });

  it("pc.caption dedupes and caps at 30", () => {
    const cap = (id: string, ml: string): AgentToClientEvent => ({ type: "pc.caption", ...env(), id, ml, en: id, kind: "count" });
    let s = run([cap("count.01", "ഒന്ന്"), cap("count.01", "ഒന്ന്")]);
    expect(s.captions).toHaveLength(1);
    s = run(Array.from({ length: 35 }, (_, i) => cap(`c${i}`, `m${i}`)), s);
    expect(s.captions).toHaveLength(30);
  });

  it("pc.request_pain, pc.safety_alert and local.dismiss_alert", () => {
    let s = run([{ type: "pc.request_pain", ...env(), setIndex: 2 }]);
    expect(s).toMatchObject({ awaitingPain: true, setIndex: 2 });
    s = run([{ type: "pc.safety_alert", ...env(), reason: "pain", score: 8, setIndex: 2 }], s);
    expect(s.alert).toEqual({ reason: "pain", score: 8, symptom: undefined });
    expect(s.awaitingPain).toBe(false);
    s = feedReducer(s, { type: "local.dismiss_alert" });
    expect(s.alert).toBeNull();
  });

  it("pc.set_summary leaves state unchanged", () => {
    const s = feedReducer(initialFeed, {
      type: "pc.set_summary", ...env(), setIndex: 1, repsDone: 10, repsPlanned: 10, avgPeak: 85, bestPeak: 92,
      target: 90, fastReps: 0, score: 90, feedbackSource: "rules",
    });
    expect(s).toBe(initialFeed);
  });
});
