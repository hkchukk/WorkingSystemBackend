ALTER TABLE "notifications" ALTER COLUMN "type" SET DATA TYPE varchar(128);--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "receiver_type";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "related_resource_id";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "related_resource_type";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "metadata";