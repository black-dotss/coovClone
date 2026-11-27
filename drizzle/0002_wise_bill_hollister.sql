CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"target_id" text,
	"target_type" text,
	"ip_address" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"fingerprint_hash" text,
	"original_owner_user_id" text,
	"reason" text DEFAULT 'account_deleted' NOT NULL,
	"trial_consumed" boolean DEFAULT true NOT NULL,
	"tombstoned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tombstones_device_id_unique" UNIQUE("device_id")
);
--> statement-breakpoint
CREATE TABLE "device_trial_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"user_id" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"risk_score" integer DEFAULT 0 NOT NULL,
	"risk_outcome" text DEFAULT 'allowed' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "trial_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "device_trial_claims" ADD CONSTRAINT "device_trial_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_user_id_idx" ON "audit_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_tombstones_device_id_idx" ON "device_tombstones" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "device_tombstones_token_hash_idx" ON "device_tombstones" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "device_tombstones_fingerprint_hash_idx" ON "device_tombstones" USING btree ("fingerprint_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "device_trial_claims_device_id_idx" ON "device_trial_claims" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "device_trial_claims_user_id_idx" ON "device_trial_claims" USING btree ("user_id");