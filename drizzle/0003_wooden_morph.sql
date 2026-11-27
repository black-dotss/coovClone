CREATE TABLE "bounties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recruiter_user_id" text NOT NULL,
	"recruiter_wallet" text NOT NULL,
	"job_description_id" uuid NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"usdc_mint" text NOT NULL,
	"escrow_pda_address" text NOT NULL,
	"vault_address" text NOT NULL,
	"create_tx_signature" text,
	"refund_tx_signature" text,
	"min_score" integer NOT NULL,
	"reward_per_winner_micros" text NOT NULL,
	"max_winners" integer NOT NULL,
	"claims_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bounties_escrow_pda_address_unique" UNIQUE("escrow_pda_address")
);
--> statement-breakpoint
CREATE TABLE "bounty_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bounty_id" uuid NOT NULL,
	"candidate_user_id" text NOT NULL,
	"candidate_wallet" text NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"claim_receipt_pda" text NOT NULL,
	"claim_tx_signature" text NOT NULL,
	"amount_micros" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" text NOT NULL,
	"referred_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "model_version" text;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "model_version" text;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "canonical_report_hash" text;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "candidate_wallet" text;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "eval_pda_address" text;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "eval_tx_signature" text;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "sbt_mint_address" text;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "sbt_tx_signature" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "canonical_report_hash" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "redacted_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "wallet_address" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "wallet_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "profile_pda_address" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "profile_tx_signature" text;--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_recruiter_user_id_users_id_fk" FOREIGN KEY ("recruiter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounties" ADD CONSTRAINT "bounties_job_description_id_job_descriptions_id_fk" FOREIGN KEY ("job_description_id") REFERENCES "public"."job_descriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_claims" ADD CONSTRAINT "bounty_claims_bounty_id_bounties_id_fk" FOREIGN KEY ("bounty_id") REFERENCES "public"."bounties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_claims" ADD CONSTRAINT "bounty_claims_candidate_user_id_users_id_fk" FOREIGN KEY ("candidate_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_claims" ADD CONSTRAINT "bounty_claims_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bounties_escrow_pda_idx" ON "bounties" USING btree ("escrow_pda_address");--> statement-breakpoint
CREATE UNIQUE INDEX "bounties_job_description_idx" ON "bounties" USING btree ("job_description_id");--> statement-breakpoint
CREATE INDEX "bounties_recruiter_idx" ON "bounties" USING btree ("recruiter_user_id");--> statement-breakpoint
CREATE INDEX "bounties_status_idx" ON "bounties" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "bounty_claims_bounty_user_idx" ON "bounty_claims" USING btree ("bounty_id","candidate_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bounty_claims_bounty_wallet_idx" ON "bounty_claims" USING btree ("bounty_id","candidate_wallet");--> statement-breakpoint
CREATE INDEX "bounty_claims_candidate_idx" ON "bounty_claims" USING btree ("candidate_user_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_id_idx" ON "referrals" USING btree ("referrer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referred_user_id_idx" ON "referrals" USING btree ("referred_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_profiles_wallet_address_idx" ON "user_profiles" USING btree ("wallet_address");