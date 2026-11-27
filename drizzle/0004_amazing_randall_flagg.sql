ALTER TABLE "device_trial_claims" DROP CONSTRAINT "device_trial_claims_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "device_trial_claims" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "device_tombstones" ADD COLUMN "hardware_id" text;--> statement-breakpoint
ALTER TABLE "device_tombstones" ADD COLUMN "trials_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "device_trial_claims" ADD COLUMN "hardware_id" text;--> statement-breakpoint
ALTER TABLE "device_trial_claims" ADD COLUMN "evaluations_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "device_trial_claims" ADD COLUMN "evaluations_reserved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "hardware_id" text;--> statement-breakpoint
ALTER TABLE "device_trial_claims" ADD CONSTRAINT "device_trial_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_tombstones_hardware_id_idx" ON "device_tombstones" USING btree ("hardware_id");--> statement-breakpoint
CREATE INDEX "device_trial_claims_hardware_id_idx" ON "device_trial_claims" USING btree ("hardware_id");--> statement-breakpoint
CREATE INDEX "devices_hardware_id_idx" ON "devices" USING btree ("hardware_id");