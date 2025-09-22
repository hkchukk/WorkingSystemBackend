ALTER TABLE "admins" ADD COLUMN "fcm_tokens" json DEFAULT '[]'::json;--> statement-breakpoint
ALTER TABLE "employers" ADD COLUMN "fcm_tokens" json DEFAULT '[]'::json;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "fcm_tokens" json DEFAULT '[]'::json;