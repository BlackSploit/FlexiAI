/**
 * Pure validation for the LLM weekly summary (§8.9, TS port of `validate_note`).
 * No `server-only` import so it can be unit-tested. Any violation -> throws; the caller falls back to rules.
 */
import { z } from "zod";

import { adherencePct, type WeeklyNumbers } from "./weekly-summary-rules";

/** Exact output shape: ONLY these two keys (extra keys -> rules). */
export const weeklySummaryLlmSchema = z.object({
  textEn: z.string().trim().min(1).max(600),
  textMl: z.string().trim().min(1).max(600),
}).strict();

export type WeeklySummaryLlm = z.infer<typeof weeklySummaryLlmSchema>;

/** JSON schema sent as `output_config.format` so the model returns exactly this shape. */
export const WEEKLY_SUMMARY_JSON_SCHEMA = {
  type: "object",
  properties: { textEn: { type: "string" }, textMl: { type: "string" } },
  required: ["textEn", "textMl"],
  additionalProperties: false,
} as const;

/** Case-insensitive substrings never allowed in the English text (spec §8.9 list + advice words). */
export const EN_DENY = [
  "diagnos", "injur", "tear", "arthritis", "fracture", "surgery", "medicat", "medicine", "painkiller",
  "ibuprofen", "paracetamol", "inflamm", "condition", "prescription", "increase your target", "change your",
  "dose", "ice pack", "heat pack", "see a doctor", "doctor", "should", "must", "recommend", "advise",
];

/** Malayalam deny-list: disease, medicine, surgery, injury, doctor, "recommend". DRAFT: native-speaker review required. */
export const ML_DENY = ["രോഗ", "മരുന്ന്", "ശസ്ത്രക്രിയ", "പരിക്ക്", "ഡോക്ടർ", "നിർദ്ദേശിക്കുന്നു", "ചികിത്സ"];

export const SENTENCES_MIN = 2;
export const SENTENCES_MAX = 3;

/** Split on sentence punctuation followed by whitespace/end, so decimals like 12.5 stay intact. */
export const countSentences = (s: string) =>
  s.split(/[.!?।]+(?=\s|$)/u).map((x) => x.trim()).filter(Boolean).length;

/** Share of letters (incl. combining marks) that are Malayalam script U+0D00–U+0D7F. */
export const malayalamRatio = (s: string) => {
  const letters = s.match(/[\p{L}\p{M}]/gu) ?? [];
  if (letters.length === 0) return 0;
  const ml = letters.filter((c) => /[ഀ-ൿ]/u.test(c)).length;
  return ml / letters.length;
};

/** Every number the summary may mention, derived from the input numbers only. */
export function allowedNumbers(n: WeeklyNumbers): Set<number> {
  const out = new Set<number>([0, 1, 10, 100]); // "out of 10" pain scale, percentages
  const add = (v: number | null | undefined) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return;
    out.add(v);
    out.add(Math.round(v));
    out.add(Math.round(v * 10) / 10);
    out.add(Math.abs(Math.round(v)));
    out.add(Math.abs(Math.round(v * 10) / 10));
  };
  add(n.sessionsDone);
  add(n.sessionsPlanned);
  add(adherencePct(n.sessionsDone, n.sessionsPlanned));
  add(n.avgPeak);
  add(n.avgPeakLastWeek);
  add(n.bestPeak);
  add(n.maxPain);
  add(n.fastRepPct);
  add(n.targetAngle);
  if (n.avgPeak !== null && n.avgPeakLastWeek !== null) {
    add(n.avgPeak - n.avgPeakLastWeek);
    add(Math.round(n.avgPeak) - Math.round(n.avgPeakLastWeek));
  }
  if (n.avgPeak !== null && n.targetAngle !== null) add(n.targetAngle - n.avgPeak);
  return out;
}

export class WeeklySummaryValidationError extends Error {}

const fail = (msg: string): never => { throw new WeeklySummaryValidationError(msg); };

/** Parse + validate raw model output (string or object). Returns the clean summary or throws. */
export function validateWeeklySummary(raw: unknown, n: WeeklyNumbers): WeeklySummaryLlm {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { fail("invalid JSON"); }
  }
  const parsed = weeklySummaryLlmSchema.safeParse(value);
  if (!parsed.success) fail(`shape: ${parsed.error?.issues.map((i) => i.message).join("; ")}`);
  const out = parsed.data as WeeklySummaryLlm;
  const textEn = out.textEn.normalize("NFC");
  const textMl = out.textMl.normalize("NFC");

  if (malayalamRatio(textMl) < 0.6) fail("textMl is not mostly Malayalam script");
  if (/[ഀ-ൿ]/u.test(textEn)) fail("textEn contains Malayalam script");

  for (const [k, t] of [["textEn", textEn], ["textMl", textMl]] as const) {
    const c = countSentences(t);
    if (c < SENTENCES_MIN || c > SENTENCES_MAX) fail(`${k} has ${c} sentences`);
  }

  const allowed = allowedNumbers(n);
  for (const t of [textEn, textMl]) {
    for (const m of t.match(/\d+(?:\.\d+)?/g) ?? []) {
      if (!allowed.has(Number(m))) fail(`number ${m} not in input`);
    }
  }

  const en = textEn.toLowerCase();
  const badEn = EN_DENY.find((w) => en.includes(w));
  if (badEn) fail(`deny-listed word: ${badEn}`);
  const badMl = ML_DENY.find((w) => textMl.includes(w));
  if (badMl) fail(`deny-listed Malayalam word: ${badMl}`);

  return { textEn, textMl };
}
