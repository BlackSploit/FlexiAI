CREATE TYPE "public"."body_side" AS ENUM('left', 'right');--> statement-breakpoint
CREATE TYPE "public"."call_session_mode" AS ENUM('live', 'replay');--> statement-breakpoint
CREATE TYPE "public"."call_session_status" AS ENUM('scheduled', 'live', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."camera_view" AS ENUM('side', 'front');--> statement-breakpoint
CREATE TYPE "public"."exercise_mode" AS ENUM('flex', 'direct');--> statement-breakpoint
CREATE TYPE "public"."feedback_source" AS ENUM('rules', 'llm');--> statement-breakpoint
CREATE TYPE "public"."preferred_language" AS ENUM('ml', 'en');--> statement-breakpoint
CREATE TYPE "public"."prescription_side" AS ENUM('auto', 'left', 'right');--> statement-breakpoint
CREATE TYPE "public"."safety_kind" AS ENUM('stop', 'pain', 'symptom', 'agent_down');--> statement-breakpoint
CREATE TYPE "public"."safety_source" AS ENUM('agent', 'ui', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."set_stop_reason" AS ENUM('completed', 'idle', 'stop_pressed', 'pain', 'symptom', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('patient', 'physio');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"physio_id" text NOT NULL,
	"prescription_id" text NOT NULL,
	"stream_call_id" text NOT NULL,
	"stream_call_type" text DEFAULT 'default' NOT NULL,
	"mode" "call_session_mode" DEFAULT 'live' NOT NULL,
	"scheduled_at" timestamp DEFAULT now() NOT NULL,
	"status" "call_session_status" DEFAULT 'scheduled' NOT NULL,
	"consent_given_at" timestamp,
	"agent_pid" text,
	"started_at" timestamp,
	"ended_at" timestamp,
	"failure_reason" text,
	"join_token_hash" text,
	"join_token_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "call_sessions_stream_call_id_unique" UNIQUE("stream_call_id")
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ml" text NOT NULL,
	"joints" text[] NOT NULL,
	"mode" "exercise_mode" NOT NULL,
	"rest" real NOT NULL,
	"start" real NOT NULL,
	"min_peak" real NOT NULL,
	"default_target" integer NOT NULL,
	"camera_view" "camera_view" DEFAULT 'side' NOT NULL,
	"how_to_en" text NOT NULL,
	"how_to_ml" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "physio_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"physio_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "physio_patient_links" (
	"physio_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "physio_patient_links_physio_id_patient_id_pk" PRIMARY KEY("physio_id","patient_id")
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"physio_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"side" "prescription_side" DEFAULT 'auto' NOT NULL,
	"target_angle" integer NOT NULL,
	"reps" integer NOT NULL,
	"sets" integer DEFAULT 1 NOT NULL,
	"min_seconds_per_rep" real DEFAULT 2 NOT NULL,
	"sessions_per_week" integer DEFAULT 5 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rx_target_range" CHECK ("prescriptions"."target_angle" between 10 and 180),
	CONSTRAINT "rx_reps_range" CHECK ("prescriptions"."reps" between 1 and 30),
	CONSTRAINT "rx_sets_range" CHECK ("prescriptions"."sets" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "safety_events" (
	"id" text PRIMARY KEY NOT NULL,
	"call_session_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"kind" "safety_kind" NOT NULL,
	"symptom" text,
	"pain_score" integer,
	"set_index" integer,
	"source" "safety_source" NOT NULL,
	"client_event_id" text NOT NULL,
	"acknowledged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "safety_events_client_event_id_unique" UNIQUE("client_event_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "set_results" (
	"id" text PRIMARY KEY NOT NULL,
	"call_session_id" text NOT NULL,
	"event_id" text NOT NULL,
	"set_index" integer NOT NULL,
	"reps_done" integer NOT NULL,
	"reps_planned" integer NOT NULL,
	"target_angle" integer NOT NULL,
	"side" "body_side",
	"avg_peak" real NOT NULL,
	"best_peak" real NOT NULL,
	"lowest_peak" real NOT NULL,
	"avg_rep_seconds" real NOT NULL,
	"fast_reps" integer DEFAULT 0 NOT NULL,
	"score" real NOT NULL,
	"pain" integer,
	"feedback_ml" text NOT NULL,
	"feedback_en" text NOT NULL,
	"feedback_source" "feedback_source" DEFAULT 'rules' NOT NULL,
	"per_rep" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stop_reason" "set_stop_reason" DEFAULT 'completed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "set_results_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "sr_pain_range" CHECK ("set_results"."pain" is null or "set_results"."pain" between 0 and 10),
	CONSTRAINT "sr_score_range" CHECK ("set_results"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'physio' NOT NULL,
	"phone" text,
	"preferred_language" "preferred_language" DEFAULT 'ml' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "weekly_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"week_start" date NOT NULL,
	"sessions_done" integer NOT NULL,
	"sessions_planned" integer NOT NULL,
	"adherence_pct" real NOT NULL,
	"avg_peak" real,
	"best_peak" real,
	"max_pain" integer,
	"text_en" text NOT NULL,
	"text_ml" text NOT NULL,
	"source" "feedback_source" DEFAULT 'rules' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_patient_id_user_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_physio_id_user_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_notes" ADD CONSTRAINT "physio_notes_patient_id_user_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_notes" ADD CONSTRAINT "physio_notes_physio_id_user_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_patient_links" ADD CONSTRAINT "physio_patient_links_physio_id_user_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_patient_links" ADD CONSTRAINT "physio_patient_links_patient_id_user_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_user_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_physio_id_user_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_call_session_id_call_sessions_id_fk" FOREIGN KEY ("call_session_id") REFERENCES "public"."call_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_patient_id_user_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_results" ADD CONSTRAINT "set_results_call_session_id_call_sessions_id_fk" FOREIGN KEY ("call_session_id") REFERENCES "public"."call_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_summaries" ADD CONSTRAINT "weekly_summaries_patient_id_user_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cs_patient_idx" ON "call_sessions" USING btree ("patient_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "cs_physio_status_idx" ON "call_sessions" USING btree ("physio_id","status");--> statement-breakpoint
CREATE INDEX "cs_prescription_idx" ON "call_sessions" USING btree ("prescription_id");--> statement-breakpoint
CREATE INDEX "pn_patient_idx" ON "physio_notes" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "ppl_patient_idx" ON "physio_patient_links" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "rx_patient_active_idx" ON "prescriptions" USING btree ("patient_id","active");--> statement-breakpoint
CREATE INDEX "rx_physio_idx" ON "prescriptions" USING btree ("physio_id");--> statement-breakpoint
CREATE INDEX "se_session_idx" ON "safety_events" USING btree ("call_session_id");--> statement-breakpoint
CREATE INDEX "se_patient_idx" ON "safety_events" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sr_session_set_idx" ON "set_results" USING btree ("call_session_id","set_index");--> statement-breakpoint
CREATE UNIQUE INDEX "ws_patient_week_idx" ON "weekly_summaries" USING btree ("patient_id","week_start");