ALTER TABLE "workers" ALTER COLUMN "highest_education" SET DEFAULT '其他';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "resource_id" varchar(21);