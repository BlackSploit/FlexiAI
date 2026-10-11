import { afterEach, describe, expect, it, vi } from "vitest";

import {
  countSentences, malayalamRatio, validateWeeklySummary, WeeklySummaryValidationError,
} from "@/modules/analytics/lib/validate-weekly-summary";
import type { WeeklyNumbers } from "@/modules/analytics/lib/weekly-summary-rules";

const n: WeeklyNumbers = {
  sessionsDone: 4, sessionsPlanned: 5, avgPeak: 82.4, avgPeakLastWeek: 76.9, bestPeak: 91,
  maxPain: 3, fastRepPct: 25, targetAngle: 90,
};

const valid = {
  textEn: "Completed 4 of 5 planned sessions this week (80%). Average range of motion was 82° against a target of 90°, 6° more than last week. Highest pain reported was 3/10.",
  textMl: "ഈ ആഴ്ച നിശ്ചയിച്ച 5 സെഷനുകളിൽ 4 എണ്ണം പൂർത്തിയാക്കി (80%). ശരാശരി ചലനം 82 ഡിഗ്രി ആയിരുന്നു, ലക്ഷ്യം 90 ഡിഗ്രി. ഏറ്റവും കൂടിയ വേദന 3/10 ആയിരുന്നു.",
};

const bad = (o: unknown) => expect(() => validateWeeklySummary(o, n)).toThrow(WeeklySummaryValidationError);

describe("validateWeeklySummary", () => {
  it("accepts a valid object and a valid JSON string", () => {
    expect(validateWeeklySummary(valid, n)).toEqual(valid);
    expect(validateWeeklySummary(JSON.stringify(valid), n)).toEqual(valid);
  });

  it("rejects invalid JSON, missing keys and extra keys", () => {
    bad("{not json");
    bad({ textEn: valid.textEn });
    bad({ ...valid, note: "x" });
    bad({ ml: valid.textMl, en: valid.textEn });
  });

  it("rejects numbers that are not in the input", () => {
    bad({ ...valid, textEn: valid.textEn.replace("82°", "85°") });
    bad({ ...valid, textMl: valid.textMl.replace("82 ഡിഗ്രി", "87 ഡിഗ്രി") });
  });

  it("keeps decimals intact and allows the one-decimal delta", () => {
    const en = "Completed 4 of 5 planned sessions (80%). Average range of motion rose by 5.5° to 82.4°.";
    expect(validateWeeklySummary({ ...valid, textEn: en }, n).textEn).toBe(en);
  });

  it("rejects too few and too many sentences", () => {
    bad({ ...valid, textEn: "Completed 4 of 5 planned sessions this week." });
    bad({ ...valid, textEn: `${valid.textEn} 25% of reps were fast. Best peak was 91°.` });
    bad({ ...valid, textMl: "ഈ ആഴ്ച 4 സെഷനുകൾ പൂർത്തിയാക്കി." });
  });

  it("rejects deny-listed English and Malayalam words", () => {
    bad({ ...valid, textEn: `${valid.textEn.split(". ").slice(0, 2).join(". ")}. You should rest more.` });
    bad({ ...valid, textEn: "Completed 4 of 5 sessions. No sign of injury this week." });
    bad({ ...valid, textEn: "Completed 4 of 5 sessions. Arthritis seems stable." });
    bad({ ...valid, textMl: "ഈ ആഴ്ച 4 സെഷനുകൾ പൂർത്തിയാക്കി. മരുന്ന് തുടരുക." });
  });

  it("rejects English (or mixed) text in textMl and Malayalam in textEn", () => {
    bad({ ...valid, textMl: valid.textEn });
    bad({ ...valid, textMl: "Completed 4 of 5 sessions this week. ശരാശരി ചലനം 82 ഡിഗ്രി." });
    bad({ ...valid, textEn: valid.textMl });
  });

  it("helpers", () => {
    expect(countSentences("One 1.5 two. Three! Four?")).toBe(3);
    expect(malayalamRatio("ശരാശരി")).toBe(1);
    expect(malayalamRatio("abc")).toBe(0);
  });
});

describe("generateWeeklySummary", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock("openai"); });

  type Choice = { finish_reason: string; message: { content: string | null; refusal: string | null } };
  const ok = (): Choice => ({ finish_reason: "stop", message: { content: JSON.stringify(valid), refusal: null } });

  /** Mocks the `openai` module (no network) and returns the spy on chat.completions.create. */
  function mockOpenAI(next: () => { choices: Choice[] } | Promise<never>) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed signature for mock.calls
    const create = vi.fn(async (_body: Record<string, unknown>, _opts?: unknown) => next());
    const ctor = vi.fn();
    vi.doMock("openai", () => ({
      default: class { constructor(o: unknown) { ctor(o); } chat = { completions: { create } }; },
    }));
    return { create, ctor };
  }

  const load = async () => (await import("@/modules/analytics/server/generate-weekly-summary")).generateWeeklySummary;

  it("returns null without OPENAI_API_KEY and never constructs a client", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { create, ctor } = mockOpenAI(() => ({ choices: [ok()] }));
    expect(await (await load())(n)).toBeNull();
    expect(ctor).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("returns validated text from a mocked client with a strict schema request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "");
    vi.stubEnv("OPENAI_REASONING_EFFORT", "");
    const { create } = mockOpenAI(() => ({ choices: [ok()] }));
    expect(await (await load())(n)).toEqual(valid);
    const body = create.mock.calls[0][0] as { model: string; reasoning_effort?: string; max_completion_tokens: number; response_format: { type: string; json_schema: { strict: boolean } } };
    expect(body.model).toBe("gpt-5-mini");
    expect(body.reasoning_effort).toBe("minimal");
    expect(body.max_completion_tokens).toBe(1200);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body).not.toHaveProperty("temperature");
  });

  it("omits reasoning_effort for non-reasoning models", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-4.1-mini");
    vi.stubEnv("OPENAI_REASONING_EFFORT", "low");
    const { create } = mockOpenAI(() => ({ choices: [ok()] }));
    expect(await (await load())(n)).toEqual(valid);
    const body = create.mock.calls[0][0] as Record<string, unknown>;
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("lower-cases the effort and leaves it out for \"omit\"", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-5-mini");
    vi.stubEnv("OPENAI_REASONING_EFFORT", "LOW");
    let { create } = mockOpenAI(() => ({ choices: [ok()] }));
    await (await load())(n);
    expect((create.mock.calls[0][0] as Record<string, unknown>).reasoning_effort).toBe("low");

    vi.resetModules();
    vi.stubEnv("OPENAI_REASONING_EFFORT", "omit");
    ({ create } = mockOpenAI(() => ({ choices: [ok()] })));
    expect(await (await load())(n)).toEqual(valid);
    expect(create.mock.calls[0][0]).not.toHaveProperty("reasoning_effort");
  });

  it("returns null on refusal, truncation (finish_reason length), empty content, no choice and errors", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    let next: () => { choices: Choice[] } | Promise<never> = () => ({ choices: [ok()] });
    mockOpenAI(() => next());
    const generate = await load();
    expect(await generate(n)).toEqual(valid);

    next = () => ({ choices: [{ finish_reason: "stop", message: { content: null, refusal: "I can't help with that." } }] });
    expect(await generate(n)).toBeNull();
    next = () => ({ choices: [{ ...ok(), finish_reason: "length" }] });
    expect(await generate(n)).toBeNull();
    next = () => ({ choices: [{ finish_reason: "stop", message: { content: "  ", refusal: null } }] });
    expect(await generate(n)).toBeNull();
    next = () => ({ choices: [] });
    expect(await generate(n)).toBeNull();
    next = () => Promise.reject(new Error("network down"));
    expect(await generate(n)).toBeNull();
    next = () => ({ choices: [{ ...ok(), message: { content: JSON.stringify({ ...valid, textEn: "You should rest." }), refusal: null } }] });
    expect(await generate(n)).toBeNull();
  });
});
