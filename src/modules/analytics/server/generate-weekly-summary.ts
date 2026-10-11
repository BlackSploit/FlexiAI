import "server-only";

import OpenAI from "openai";

import { adherencePct, type WeeklyNumbers } from "../lib/weekly-summary-rules";
import { validateWeeklySummary, WEEKLY_SUMMARY_JSON_SCHEMA, type WeeklySummaryLlm } from "../lib/validate-weekly-summary";

/**
 * Optional LLM weekly summary (§8.9). Returns null on ANY failure (no key, timeout, network, refusal, truncation,
 * invalid JSON, validation) so the caller uses `weeklySummaryRules`. Input is derived numbers only (no PII).
 * Env: an empty value means "use the default" (OPENAI_MODEL, OPENAI_REASONING_EFFORT).
 */
const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
/** Empty/unset -> "minimal"; "omit" -> parameter left out; anything else is sent lower-cased (same rule as the agent note). */
const REASONING_EFFORT = (process.env.OPENAI_REASONING_EFFORT || "").trim().toLowerCase() || "minimal";
const TIMEOUT_MS = 8000;

/** `reasoning_effort` is only accepted by reasoning models (gpt-5 family, o-series); never sent to others. */
export const supportsReasoningEffort = (model: string) => /^(gpt-5|o\d)/.test(model);

const SYSTEM =
  "You write a short weekly progress summary for a patient doing home exercises prescribed by their " +
  "physiotherapist, supervised by an AI exercise coach. The input is JSON with this week's numbers. " +
  "Return JSON with exactly two fields that say the same thing: 'textMl' in natural, simple Malayalam " +
  "(Malayalam script; write numbers as digits) and 'textEn' in plain English for the physiotherapist. " +
  "Each is 2-3 short sentences. Cover: sessions done versus planned and the adherence percentage; average " +
  "range of motion versus the target and the change versus last week when present; the highest pain score " +
  "out of 10 when present; the fast-rep percentage only if it is 20 or more. State facts only. Use only " +
  "numbers that appear in the input. Never diagnose, never name a condition, injury, cause of pain or " +
  "medication, never give advice or recommendations, and never use words like 'should' or 'must'.";

/** Derived numbers only; nulls dropped so the model never invents them. */
export function summaryInput(n: WeeklyNumbers) {
  const r = (v: number | null) => (v === null ? undefined : Math.round(v));
  const delta = n.avgPeak !== null && n.avgPeakLastWeek !== null ? Math.round(n.avgPeak) - Math.round(n.avgPeakLastWeek) : undefined;
  return {
    sessionsDone: n.sessionsDone,
    sessionsPlanned: n.sessionsPlanned,
    adherencePct: adherencePct(n.sessionsDone, n.sessionsPlanned),
    avgPeakDegrees: r(n.avgPeak),
    avgPeakLastWeekDegrees: r(n.avgPeakLastWeek),
    avgPeakChangeVsLastWeek: delta,
    bestPeakDegrees: r(n.bestPeak),
    targetAngleDegrees: r(n.targetAngle),
    maxPainOutOf10: n.maxPain ?? undefined,
    fastRepPct: r(n.fastRepPct),
  };
}

let client: OpenAI | null = null;
const getClient = () => (client ??= new OpenAI({ timeout: TIMEOUT_MS, maxRetries: 0 }));

async function callLlm(n: WeeklyNumbers, signal: AbortSignal): Promise<string> {
  const resp = await getClient().chat.completions.create(
    {
      model: MODEL,
      max_completion_tokens: 1200,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(summaryInput(n)) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "weekly_summary", strict: true, schema: WEEKLY_SUMMARY_JSON_SCHEMA },
      },
      ...(supportsReasoningEffort(MODEL) && REASONING_EFFORT !== "omit"
        ? { reasoning_effort: REASONING_EFFORT as OpenAI.ReasoningEffort }
        : {}),
    },
    { signal },
  );
  const choice = resp.choices?.[0];
  if (!choice) throw new Error("no choice");
  if (choice.message?.refusal) throw new Error("refusal");
  if (choice.finish_reason !== "stop") throw new Error(`finish_reason=${choice.finish_reason}`);
  const text = choice.message?.content;
  if (!text || !text.trim()) throw new Error("empty content");
  return text;
}

export async function generateWeeklySummary(n: WeeklyNumbers): Promise<WeeklySummaryLlm | null> {
  if (!process.env.OPENAI_API_KEY || process.env.WEEKLY_SUMMARY_LLM_ENABLED === "false") return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const text = await callLlm(n, ctrl.signal);
    return validateWeeklySummary(text, n);
  } catch (err) {
    console.warn("[weekly-summary] LLM path failed, using rules:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
