import "dotenv/config";

/**
 * npm run db:seed                    exercises from shared/exercises.json (upsert)
 * npm run db:seed -- --demo          + "Demo Patient" with a knee_bend prescription and 5 past sessions
 *                                      (derived numbers only) linked to the oldest physio, or --physio-email x
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import exercisesJson from "../../shared/exercises.json";
import phrasesJson from "../../shared/phrases.json";
import { db } from "./index";
import {
  callSessions, exercises, physioPatientLinks, prescriptions, setResults, user,
} from "./schema";

type Phrase = { id: string; ml: string; en: string; params?: Record<string, [number, number]> };
const phraseList = phrasesJson.phrases as Phrase[];

function phrase(id: string): { ml: string; en: string } {
  const fixed = phraseList.find((p) => p.id === id);
  if (fixed) return fixed;
  const dot = id.lastIndexOf(".");
  const tpl = phraseList.find((p) => p.id === id.slice(0, dot) && p.params);
  if (!tpl) throw new Error(`unknown phrase ${id}`);
  const [name] = Object.keys(tpl.params!);
  const value = id.slice(dot + 1);
  return { ml: tpl.ml.replace(`{${name}}`, value), en: tpl.en.replace(`{${name}}`, value) };
}

const note = (ids: string[]) => ({
  ml: ids.map((i) => phrase(i).ml).join(" "),
  en: ids.map((i) => phrase(i).en).join(" "),
});

async function seedExercises() {
  for (const e of exercisesJson) {
    const row = {
      id: e.id, nameEn: e.nameEn, nameMl: e.nameMl, joints: e.joints as [string, string, string],
      mode: e.mode as "flex" | "direct", rest: e.rest, start: e.start, minPeak: e.minPeak,
      defaultTarget: e.defaultTarget, cameraView: e.cameraView as "side" | "front", howToEn: e.howToEn, howToMl: e.howToMl,
    };
    await db.insert(exercises).values(row).onConflictDoUpdate({ target: exercises.id, set: row });
  }
  console.log(`exercises: ${exercisesJson.length} upserted`);
}

async function seedDemo(physioEmail?: string) {
  const [physio] = await db
    .select()
    .from(user)
    .where(physioEmail ? and(eq(user.email, physioEmail), eq(user.role, "physio")) : eq(user.role, "physio"))
    .orderBy(asc(user.createdAt))
    .limit(1);
  if (!physio) throw new Error("no physio user yet: sign up first (or pass --physio-email)");

  const demoEmail = "demo-patient@patients.physiocoach.invalid";
  let [patient] = await db.select().from(user).where(eq(user.email, demoEmail));
  if (!patient) {
    [patient] = await db.insert(user).values({
      id: nanoid(), name: "Demo Patient", email: demoEmail, emailVerified: false, role: "patient",
      preferredLanguage: "ml", createdAt: new Date(), updatedAt: new Date(),
    }).returning();
  }
  await db.insert(physioPatientLinks).values({ physioId: physio.id, patientId: patient.id }).onConflictDoNothing();

  let [rx] = await db.select().from(prescriptions)
    .where(and(eq(prescriptions.patientId, patient.id), eq(prescriptions.exerciseId, "knee_bend")));
  if (!rx) {
    [rx] = await db.insert(prescriptions).values({
      patientId: patient.id, physioId: physio.id, exerciseId: "knee_bend", side: "auto", targetAngle: 60,
      reps: 10, sets: 1, minSecondsPerRep: 2, sessionsPerWeek: 5, active: true,
    }).returning();
  }

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(callSessions)
    .where(eq(callSessions.prescriptionId, rx.id));
  if (n > 0) {
    console.log(`demo: ${patient.name} already has ${n} sessions; nothing added`);
    return;
  }

  const history = [{ daysAgo: 13, peak: 38 }, { daysAgo: 10, peak: 41 }, { daysAgo: 7, peak: 44 },
                   { daysAgo: 4, peak: 47 }, { daysAgo: 2, peak: 50 }];
  for (const h of history) {
    const at = new Date(Date.now() - h.daysAgo * 86_400_000);
    const id = nanoid();
    await db.insert(callSessions).values({
      id, streamCallId: id, patientId: patient.id, physioId: physio.id, prescriptionId: rx.id, mode: "live",
      status: "done", scheduledAt: at, startedAt: at, endedAt: new Date(at.getTime() + 9 * 60_000),
      consentGivenAt: at, createdAt: at, updatedAt: at,
    });
    const perRep = Array.from({ length: 10 }, (_, i) => ({
      peak: h.peak + ((i * 7) % 5) - 2, seconds: 2.4 + ((i * 3) % 4) / 10, tooFast: false,
    }));
    const text = note(["note.good_effort", `note.achieved_bend.${h.peak}`, "note.target.60", "note.more_reps.3"]);
    const score = Math.round(1000 * (0.6 * Math.min(1, h.peak / 60) + 0.25 + 0.15)) / 10;
    await db.insert(setResults).values({
      callSessionId: id, eventId: `demo-${id}`, setIndex: 1, repsDone: 10, repsPlanned: 10, targetAngle: 60,
      side: "left", avgPeak: h.peak, bestPeak: h.peak + 2, lowestPeak: h.peak - 2, avgRepSeconds: 2.6, fastReps: 0,
      score, pain: h.daysAgo > 8 ? 3 : 2, feedbackMl: text.ml, feedbackEn: text.en, feedbackSource: "rules",
      perRep, stopReason: "completed", createdAt: at,
    });
  }
  console.log(`demo: "${patient.name}" linked to ${physio.email}; prescription ${rx.id}; ${history.length} past sessions`);
}

async function main() {
  const args = process.argv.slice(2);
  await seedExercises();
  if (args.includes("--demo")) {
    const i = args.indexOf("--physio-email");
    await seedDemo(i >= 0 ? args[i + 1] : undefined);
  }
}

// No process.exit(): on Windows it can trip a libuv assertion while handles close; let Node exit naturally.
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
