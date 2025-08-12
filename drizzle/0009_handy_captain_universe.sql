ALTER TABLE "gigs" ALTER COLUMN "description" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "gigs" ALTER COLUMN "description" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gigs" ALTER COLUMN "requirements" SET DEFAULT '[]'::json;--> statement-breakpoint
ALTER TABLE "gigs" ALTER COLUMN "environment_photos" SET DEFAULT '[]'::json;