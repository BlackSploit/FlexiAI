/**
 * Deterministic bilingual weekly summary (§8.9, DEV-5): always available, no LLM, no network.
 * States numbers only: adherence, average ROM vs target and the change vs last week, max pain, fast reps.
 * Never diagnoses or advises. Malayalam wording is a DRAFT: native-speaker review required.
 */
export type WeeklyNumbers = {
  sessionsDone: number;
  sessionsPlanned: number;
  avgPeak: number | null;
  avgPeakLastWeek: number | null;
  bestPeak: number | null;
  maxPain: number | null;
  fastRepPct: number | null;
  targetAngle: number | null;
};

export const adherencePct = (done: number, planned: number) =>
  planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : 0;

export function weeklySummaryRules(n: WeeklyNumbers): { textEn: string; textMl: string } {
  const pct = adherencePct(n.sessionsDone, n.sessionsPlanned);
  const en: string[] = [`Completed ${n.sessionsDone} of ${n.sessionsPlanned} planned sessions this week (${pct}%).`];
  const ml: string[] = [`ഈ ആഴ്ച നിശ്ചയിച്ച ${n.sessionsPlanned} സെഷനുകളിൽ ${n.sessionsDone} എണ്ണം പൂർത്തിയാക്കി (${pct}%).`];

  if (n.avgPeak !== null) {
    const avg = Math.round(n.avgPeak);
    const target = n.targetAngle !== null ? Math.round(n.targetAngle) : null;
    let sEn = target !== null ? `Average range of motion was ${avg}° against a target of ${target}°` : `Average range of motion was ${avg}°`;
    let sMl = target !== null ? `ശരാശരി ചലനം ${avg} ഡിഗ്രി ആയിരുന്നു, ലക്ഷ്യം ${target} ഡിഗ്രി` : `ശരാശരി ചലനം ${avg} ഡിഗ്രി ആയിരുന്നു`;
    if (n.avgPeakLastWeek !== null) {
      const delta = Math.round(n.avgPeak - n.avgPeakLastWeek);
      if (delta > 0) {
        sEn += `, ${delta}° more than last week`;
        sMl += `, കഴിഞ്ഞ ആഴ്ചയേക്കാൾ ${delta} ഡിഗ്രി കൂടുതൽ`;
      } else if (delta < 0) {
        sEn += `, ${-delta}° less than last week`;
        sMl += `, കഴിഞ്ഞ ആഴ്ചയേക്കാൾ ${-delta} ഡിഗ്രി കുറവ്`;
      } else {
        sEn += `, the same as last week`;
        sMl += `, കഴിഞ്ഞ ആഴ്ചയിലേതുപോലെ`;
      }
    }
    en.push(`${sEn}.`);
    ml.push(`${sMl}.`);
  } else {
    en.push("No sets were recorded this week.");
    ml.push("ഈ ആഴ്ച സെറ്റുകൾ ഒന്നും രേഖപ്പെടുത്തിയില്ല.");
  }

  if (n.maxPain !== null) {
    en.push(`Highest pain reported: ${n.maxPain}/10.`);
    ml.push(`രേഖപ്പെടുത്തിയ ഏറ്റവും കൂടിയ വേദന: ${n.maxPain}/10.`);
  }
  if (n.fastRepPct !== null && n.fastRepPct >= 20) {
    const f = Math.round(n.fastRepPct);
    en.push(`${f}% of reps were faster than the prescribed tempo.`);
    ml.push(`${f}% ആവർത്തനങ്ങൾ നിർദ്ദേശിച്ച വേഗതയേക്കാൾ വേഗത്തിലായിരുന്നു.`);
  }
  return { textEn: en.join(" "), textMl: ml.join(" ") };
}
