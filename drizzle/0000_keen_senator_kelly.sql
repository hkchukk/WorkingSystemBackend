CREATE TABLE "admins" (
	"admin_id" varchar(21) PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	CONSTRAINT "admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "employer_ratings" (
	"rating_id" varchar(21) PRIMARY KEY NOT NULL,
	"employer_id" varchar(21) NOT NULL,
	"worker_id" varchar(21) NOT NULL,
	"rating_value" integer DEFAULT 5 NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "employers" (
	"employer_id" varchar(21) PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"employer_name" text NOT NULL,
	"branch_name" text,
	"industry_type" varchar DEFAULT '其他',
	"address" text,
	"phone_number" text,
	"approval_status" varchar DEFAULT 'pending' NOT NULL,
	"identification_type" varchar DEFAULT 'businessNo' NOT NULL,
	"identification_number" varchar(50),
	"verification_documents" json,
	"employer_photo" text,
	"contact_info" json,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "employers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "gig_applications" (
	"application_id" varchar(21) PRIMARY KEY NOT NULL,
	"worker_id" varchar(21) NOT NULL,
	"gig_id" varchar(21) NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gigs" (
	"gig_id" varchar(21) PRIMARY KEY NOT NULL,
	"employer_id" varchar(21) NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" json,
	"date_start" date NOT NULL,
	"date_end" date NOT NULL,
	"time_start" varchar(20) NOT NULL,
	"time_end" varchar(20) NOT NULL,
	"requirements" json,
	"hourly_rate" integer NOT NULL,
	"city" varchar(32) NOT NULL,
	"district" varchar(32) NOT NULL,
	"address" varchar(256) NOT NULL,
	"environment_photos" json,
	"contact_person" varchar(32) NOT NULL,
	"contact_phone" varchar(32),
	"contact_email" varchar(128),
	"is_active" boolean DEFAULT true,
	"published_at" date NOT NULL,
	"unlisted_at" date,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "worker_ratings" (
	"rating_id" varchar(21) PRIMARY KEY NOT NULL,
	"worker_id" varchar(21) NOT NULL,
	"employer_id" varchar(21) NOT NULL,
	"rating_value" integer DEFAULT 5 NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"worker_id" varchar(21) PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone_number" text,
	"highest_education" varchar DEFAULT '大學',
	"school_name" text,
	"major" text,
	"study_status" varchar DEFAULT '就讀中',
	"certificates" json,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "workers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "employer_ratings" ADD CONSTRAINT "employer_ratings_employer_id_employers_employer_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("employer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employer_ratings" ADD CONSTRAINT "employer_ratings_worker_id_workers_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("worker_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gig_applications" ADD CONSTRAINT "gig_applications_worker_id_workers_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("worker_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gig_applications" ADD CONSTRAINT "gig_applications_gig_id_gigs_gig_id_fk" FOREIGN KEY ("gig_id") REFERENCES "public"."gigs"("gig_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gigs" ADD CONSTRAINT "gigs_employer_id_employers_employer_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("employer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_ratings" ADD CONSTRAINT "worker_ratings_worker_id_workers_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("worker_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_ratings" ADD CONSTRAINT "worker_ratings_employer_id_employers_employer_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("employer_id") ON DELETE cascade ON UPDATE no action;