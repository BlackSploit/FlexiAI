import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { adherencePct, type WeeklyNumbers } from "../lib/weekly-summary-rules";
import { validateWeeklySummary, WEEKLY_SUMMARY_JSON_SCHEMA, type WeeklySummaryLlm } from "../lib/validate-weekly-summary";

/**
 * Optional LLM weekly summary (§8.9). Returns null on ANY failure (no key, timeout, network, refusal,
 * invalid JSON, validation) so the caller uses `weeklySummaryRules`. Input is derived numbers only (no PII).
 */
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const TIMEOUT_MS = 8000;
const SERVER_FALLBACK = (process.env.NOTE_LLM_SERVER_FALLBACK ?? "true") === "true";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

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

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 }));

async function callLlm(n: WeeklyNumbers, signal: AbortSignal): Promise<string> {
  const req = {
    model: MODEL,
    max_tokens: 800,
    system: SYSTEM,
    thinking: { type: "between_tools" as const },
    output_config: { effort: "low" as const, format: { type: "json_schema" as const, schema: WEEKLY_SUMMARY_JSON_SCHEMA } },
    messages: [{ role: "user" as const, content: JSON.stringify(summaryInput(n)) }],
  };
  const resp = SERVER_FALLBACK
    // Server-side fallbacks (Claude API only; Sonnet 5.5 accepts only "default"). The fallback model can refuse too,
    // so the stop_reason check below still applies.
    ? await getClient().beta.messages.create({ ...req, betas: [FALLBACK_BETA], fallbacks: "default" }, { signal })
    : await getClient().messages.create(req, { signal });
  if (resp.stop_reason !== "end_turn") throw new Error(`stop_reason=${resp.stop_reason}`);
  const block = resp.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("no text block");
  return block.text;
}

export async function generateWeeklySummary(n: WeeklyNumbers): Promise<WeeklySummaryLlm | null> {
  if (!process.env.ANTHROPIC_API_KEY || process.env.WEEKLY_SUMMARY_LLM_ENABLED === "false") return null;
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
