CREATE TABLE "attendance_codes" (
	"code_id" varchar(21) PRIMARY KEY NOT NULL,
	"gig_id" varchar(21) NOT NULL,
	"attendance_code" varchar(4) NOT NULL,
	"valid_date" date NOT NULL,
	"is_active" boolean DEFAULT true,
	"generated_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"record_id" varchar(21) PRIMARY KEY NOT NULL,
	"gig_id" varchar(21) NOT NULL,
	"worker_id" varchar(21) NOT NULL,
	"attendance_code_id" varchar(21) NOT NULL,
	"check_type" varchar NOT NULL,
	"check_time" timestamp DEFAULT now() NOT NULL,
	"work_date" date NOT NULL,
	"status" varchar DEFAULT 'on_time',
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "gigs" ALTER COLUMN "contact_email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gigs" ADD COLUMN "supervisor_password_hash" text;--> statement-breakpoint
ALTER TABLE "attendance_codes" ADD CONSTRAINT "attendance_codes_gig_id_gigs_gig_id_fk" FOREIGN KEY ("gig_id") REFERENCES "public"."gigs"("gig_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_gig_id_gigs_gig_id_fk" FOREIGN KEY ("gig_id") REFERENCES "public"."gigs"("gig_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_worker_id_workers_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("worker_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_attendance_code_id_attendance_codes_code_id_fk" FOREIGN KEY ("attendance_code_id") REFERENCES "public"."attendance_codes"("code_id") ON DELETE cascade ON UPDATE no action;