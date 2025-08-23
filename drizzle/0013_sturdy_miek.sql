ALTER TABLE "gigs" ALTER COLUMN "contact_email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gigs" DROP COLUMN "supervisor_id";--> statement-breakpoint
ALTER TABLE "gigs" DROP COLUMN "supervisor_password_hash";