import { describe, expect, it } from "vitest";

import { adherencePct, weeklySummaryRules, type WeeklyNumbers } from "@/modules/analytics/lib/weekly-summary-rules";

const base: WeeklyNumbers = {
  sessionsDone: 4, sessionsPlanned: 5, avgPeak: 58.4, avgPeakLastWeek: 52.1, bestPeak: 63,
  maxPain: 3, fastRepPct: 10, targetAngle: 60,
};

describe("adherencePct", () => {
  it("rounds, caps at 100 and handles zero planned", () => {
    expect(adherencePct(4, 5)).toBe(80);
    expect(adherencePct(7, 5)).toBe(100);
    expect(adherencePct(0, 0)).toBe(0);
  });
});

describe("weeklySummaryRules", () => {
  it("states numbers, the change vs last week, and both languages", () => {
    const { textEn, textMl } = weeklySummaryRules(base);
    expect(textEn).toBe(
      "Completed 4 of 5 planned sessions this week (80%). Average range of motion was 58° against a target of 60°, "
      + "6° more than last week. Highest pain reported: 3/10.",
    );
    expect(textMl).toContain("80%");
    expect(textMl).toContain("6 ഡിഗ്രി കൂടുതൽ");
  });

  it("handles a drop, no change and no sets", () => {
    expect(weeklySummaryRules({ ...base, avgPeak: 50, avgPeakLastWeek: 55 }).textEn).toContain("5° less than last week");
    expect(weeklySummaryRules({ ...base, avgPeak: 55, avgPeakLastWeek: 55 }).textEn).toContain("the same as last week");
    expect(weeklySummaryRules({ ...base, avgPeak: null, maxPain: null }).textEn)
      .toBe("Completed 4 of 5 planned sessions this week (80%). No sets were recorded this week.");
  });

  it("mentions fast reps only at 20% or more", () => {
    expect(weeklySummaryRules({ ...base, fastRepPct: 19 }).textEn).not.toContain("faster");
    expect(weeklySummaryRules({ ...base, fastRepPct: 25 }).textEn).toContain("25% of reps were faster");
  });

  it("never diagnoses or advises", () => {
    const { textEn } = weeklySummaryRules({ ...base, maxPain: 9, fastRepPct: 50 });
    expect(textEn).not.toMatch(/diagnos|should|recommend|injur|tear|arthritis/i);
  });
});
