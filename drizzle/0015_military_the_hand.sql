ALTER TABLE "attendance_records" RENAME COLUMN "check_time" TO "updated_at";--> statement-breakpoint
ALTER TABLE "attendance_records" ALTER COLUMN "created_at" SET NOT NULL;