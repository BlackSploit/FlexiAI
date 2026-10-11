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
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("returns null without ANTHROPIC_API_KEY and never constructs a client", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const ctor = vi.fn();
    vi.doMock("@anthropic-ai/sdk", () => ({ default: ctor }));
    const { generateWeeklySummary } = await import("@/modules/analytics/server/generate-weekly-summary");
    expect(await generateWeeklySummary(n)).toBeNull();
    expect(ctor).not.toHaveBeenCalled();
  });

  it("returns validated text from a mocked client, and null on refusal", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("NOTE_LLM_SERVER_FALLBACK", "false");
    let stop = "end_turn";
    const create = vi.fn(async () => ({ stop_reason: stop, content: [{ type: "text", text: JSON.stringify(valid) }] }));
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class { messages = { create }; beta = { messages: { create } }; },
    }));
    const { generateWeeklySummary } = await import("@/modules/analytics/server/generate-weekly-summary");
    expect(await generateWeeklySummary(n)).toEqual(valid);
    stop = "refusal";
    expect(await generateWeeklySummary(n)).toBeNull();
  });
});
