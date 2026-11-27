CREATE TABLE "bounty_restrictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"job_description_id" uuid NOT NULL,
	"user_id" text,
	"wallet_address" text,
	"resume_hash" text,
	"reason" text NOT NULL,
	"details" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bounty_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"job_description_id" uuid NOT NULL,
	"candidate_user_id" text NOT NULL,
	"candidate_wallet" text,
	"evaluation_id" uuid NOT NULL,
	"cv_version_id" uuid NOT NULL,
	"resume_hash" text NOT NULL,
	"resume_fingerprint" jsonb NOT NULL,
	"fake_detector_status" text DEFAULT 'pending' NOT NULL,
	"fake_detector_score" integer,
	"fake_detector_report" jsonb,
	"review_status" text DEFAULT 'evaluating' NOT NULL,
	"slot_reserved_at" timestamp with time zone,
	"review_deadline_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" text,
	"recruiter_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bounty_restrictions" ADD CONSTRAINT "bounty_restrictions_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_restrictions" ADD CONSTRAINT "bounty_restrictions_job_description_id_job_descriptions_id_fk" FOREIGN KEY ("job_description_id") REFERENCES "public"."job_descriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_restrictions" ADD CONSTRAINT "bounty_restrictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_submissions" ADD CONSTRAINT "bounty_submissions_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_submissions" ADD CONSTRAINT "bounty_submissions_job_description_id_job_descriptions_id_fk" FOREIGN KEY ("job_description_id") REFERENCES "public"."job_descriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_submissions" ADD CONSTRAINT "bounty_submissions_candidate_user_id_users_id_fk" FOREIGN KEY ("candidate_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_submissions" ADD CONSTRAINT "bounty_submissions_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_submissions" ADD CONSTRAINT "bounty_submissions_cv_version_id_cv_versions_id_fk" FOREIGN KEY ("cv_version_id") REFERENCES "public"."cv_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_submissions" ADD CONSTRAINT "bounty_submissions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bounty_restrictions_bounty_user_idx" ON "bounty_restrictions" USING btree ("bounty_id","user_id");--> statement-breakpoint
CREATE INDEX "bounty_restrictions_bounty_wallet_idx" ON "bounty_restrictions" USING btree ("bounty_id","wallet_address");--> statement-breakpoint
CREATE INDEX "bounty_restrictions_bounty_hash_idx" ON "bounty_restrictions" USING btree ("bounty_id","resume_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "bounty_submissions_bounty_eval_idx" ON "bounty_submissions" USING btree ("bounty_id","evaluation_id");--> statement-breakpoint
CREATE INDEX "bounty_submissions_bounty_hash_idx" ON "bounty_submissions" USING btree ("bounty_id","resume_hash");--> statement-breakpoint
CREATE INDEX "bounty_submissions_bounty_status_idx" ON "bounty_submissions" USING btree ("bounty_id","review_status");--> statement-breakpoint
CREATE INDEX "bounty_submissions_candidate_idx" ON "bounty_submissions" USING btree ("candidate_user_id");--> statement-breakpoint
CREATE INDEX "bounty_submissions_jd_idx" ON "bounty_submissions" USING btree ("job_description_id");