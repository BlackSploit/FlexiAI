import { nanoid } from "nanoid";
import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, text, timestamp, boolean, integer, real, jsonb, date,
  primaryKey, index, uniqueIndex, check,
} from "drizzle-orm/pg-core";

/* ---------- enums ---------- */
export const userRole = pgEnum("user_role", ["patient", "physio"]);
export const preferredLanguage = pgEnum("preferred_language", ["ml", "en"]);
export const exerciseMode = pgEnum("exercise_mode", ["flex", "direct"]);
export const cameraView = pgEnum("camera_view", ["side", "front"]);
export const prescriptionSide = pgEnum("prescription_side", ["auto", "left", "right"]);
export const bodySide = pgEnum("body_side", ["left", "right"]);
export const callSessionStatus = pgEnum("call_session_status", ["scheduled", "live", "done", "failed"]);
export const callSessionMode = pgEnum("call_session_mode", ["live", "replay"]);
export const feedbackSource = pgEnum("feedback_source", ["rules", "llm"]);
export const setStopReason = pgEnum("set_stop_reason", ["completed", "idle", "stop_pressed", "pain", "symptom", "disconnected"]);
export const safetyKind = pgEnum("safety_kind", ["stop", "pain", "symptom", "agent_down"]);
export const safetySource = pgEnum("safety_source", ["agent", "ui", "webhook"]);

/* ---------- Better Auth: user extended via additionalFields ---------- */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(), // phone-only patients: p_<id>@patients.physiocoach.invalid (DEV-7)
  emailVerified: boolean("email_verified").$defaultFn(() => false).notNull(),
  image: text("image"),
  role: userRole("role").notNull().default("physio"),
  phone: text("phone").unique(),                             // NULL when absent, never ""
  preferredLanguage: preferredLanguage("preferred_language").notNull().default("ml"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()).notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
});

/* ---------- PhysioCoach domain ---------- */
export const physioPatientLinks = pgTable("physio_patient_links", {
  physioId: text("physio_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  patientId: text("patient_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.physioId, t.patientId] }),
  index("ppl_patient_idx").on(t.patientId),
]);

export const exercises = pgTable("exercises", {
  id: text("id").primaryKey(),                         // "knee_bend" | "elbow_bend" | "shoulder_raise"
  nameEn: text("name_en").notNull(),
  nameMl: text("name_ml").notNull(),
  joints: text("joints").array().notNull().$type<[string, string, string]>(), // [a, b(vertex), c]
  mode: exerciseMode("mode").notNull(),                // flex => value = 180 - angle; direct => value = angle
  rest: real("rest").notNull(),
  start: real("start").notNull(),
  minPeak: real("min_peak").notNull(),
  defaultTarget: integer("default_target").notNull(),
  cameraView: cameraView("camera_view").notNull().default("side"),
  howToEn: text("how_to_en").notNull(),
  howToMl: text("how_to_ml").notNull(),
});

export const prescriptions = pgTable("prescriptions", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  patientId: text("patient_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  physioId: text("physio_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  exerciseId: text("exercise_id").notNull().references(() => exercises.id, { onDelete: "restrict" }),
  side: prescriptionSide("side").notNull().default("auto"),
  targetAngle: integer("target_angle").notNull(),
  reps: integer("reps").notNull(),
  sets: integer("sets").notNull().default(1),                         // DEV-11
  minSecondsPerRep: real("min_seconds_per_rep").notNull().default(2),
  sessionsPerWeek: integer("sessions_per_week").notNull().default(5), // DEV-6
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("rx_patient_active_idx").on(t.patientId, t.active),
  index("rx_physio_idx").on(t.physioId),
  check("rx_target_range", sql`${t.targetAngle} between 10 and 180`),
  check("rx_reps_range", sql`${t.reps} between 1 and 30`),
  check("rx_sets_range", sql`${t.sets} between 1 and 5`),
]);

export const callSessions = pgTable("call_sessions", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),      // == streamCallId (pattern kept from meetings)
  patientId: text("patient_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  physioId: text("physio_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  prescriptionId: text("prescription_id").notNull().references(() => prescriptions.id, { onDelete: "cascade" }),
  streamCallId: text("stream_call_id").notNull().unique(),
  streamCallType: text("stream_call_type").notNull().default("default"),
  mode: callSessionMode("mode").notNull().default("live"),
  scheduledAt: timestamp("scheduled_at").notNull().defaultNow(),
  status: callSessionStatus("status").notNull().default("scheduled"),
  consentGivenAt: timestamp("consent_given_at"),
  agentPid: text("agent_pid"),                                 // "<worker-host>:<pid>"
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  failureReason: text("failure_reason"),                       // FailureReason union, agent-bridge/schemas.ts
  joinTokenHash: text("join_token_hash"),
  joinTokenExpiresAt: timestamp("join_token_expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("cs_patient_idx").on(t.patientId, t.scheduledAt),
  index("cs_physio_status_idx").on(t.physioId, t.status),
  index("cs_prescription_idx").on(t.prescriptionId),
]);

export type PerRep = { peak: number; seconds: number; tooFast: boolean };

export const setResults = pgTable("set_results", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  callSessionId: text("call_session_id").notNull().references(() => callSessions.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull().unique(),              // idempotency key from the agent
  setIndex: integer("set_index").notNull(),                  // 1-based
  repsDone: integer("reps_done").notNull(),
  repsPlanned: integer("reps_planned").notNull(),
  targetAngle: integer("target_angle").notNull(),            // snapshot of the prescription
  side: bodySide("side"),
  avgPeak: real("avg_peak").notNull(),
  bestPeak: real("best_peak").notNull(),
  lowestPeak: real("lowest_peak").notNull(),
  avgRepSeconds: real("avg_rep_seconds").notNull(),
  fastReps: integer("fast_reps").notNull().default(0),
  score: real("score").notNull(),                            // 0..100
  pain: integer("pain"),                                     // 0..10, null until entered
  feedbackMl: text("feedback_ml").notNull(),
  feedbackEn: text("feedback_en").notNull(),
  feedbackSource: feedbackSource("feedback_source").notNull().default("rules"),
  perRep: jsonb("per_rep").$type<PerRep[]>().notNull().default(sql`'[]'::jsonb`),
  stopReason: setStopReason("stop_reason").notNull().default("completed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("sr_session_set_idx").on(t.callSessionId, t.setIndex),
  check("sr_pain_range", sql`${t.pain} is null or ${t.pain} between 0 and 10`),
  check("sr_score_range", sql`${t.score} between 0 and 100`),
]);

export const safetyEvents = pgTable("safety_events", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  callSessionId: text("call_session_id").notNull().references(() => callSessions.id, { onDelete: "cascade" }),
  patientId: text("patient_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: safetyKind("kind").notNull(),
  symptom: text("symptom"),                                  // dizziness | chest_pain | sharp_pain
  painScore: integer("pain_score"),
  setIndex: integer("set_index"),
  source: safetySource("source").notNull(),
  clientEventId: text("client_event_id").notNull().unique(), // dedupes UI / agent / webhook copies
  acknowledgedAt: timestamp("acknowledged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("se_session_idx").on(t.callSessionId), index("se_patient_idx").on(t.patientId, t.createdAt)]);

export const physioNotes = pgTable("physio_notes", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  patientId: text("patient_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  physioId: text("physio_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("pn_patient_idx").on(t.patientId, t.createdAt)]);

export const weeklySummaries = pgTable("weekly_summaries", {
  id: text("id").primaryKey().$defaultFn(() => nanoid()),
  patientId: text("patient_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  weekStart: date("week_start").notNull(),                   // Monday, Asia/Kolkata
  sessionsDone: integer("sessions_done").notNull(),
  sessionsPlanned: integer("sessions_planned").notNull(),
  adherencePct: real("adherence_pct").notNull(),
  avgPeak: real("avg_peak"),
  bestPeak: real("best_peak"),
  maxPain: integer("max_pain"),
  textEn: text("text_en").notNull(),
  textMl: text("text_ml").notNull(),
  source: feedbackSource("source").notNull().default("rules"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("ws_patient_week_idx").on(t.patientId, t.weekStart)]);
