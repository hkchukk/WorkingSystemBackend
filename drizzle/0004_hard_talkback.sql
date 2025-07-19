CREATE TABLE "notifications" (
	"notification_id" varchar(21) PRIMARY KEY NOT NULL,
	"receiver_id" varchar(21) NOT NULL,
	"receiver_type" varchar NOT NULL,
	"title" varchar(256) NOT NULL,
	"message" text NOT NULL,
	"type" varchar NOT NULL,
	"related_resource_id" varchar(21),
	"related_resource_type" varchar,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"metadata" json DEFAULT '{}'::json,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
