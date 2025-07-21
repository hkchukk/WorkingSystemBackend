ALTER TABLE "employer_ratings" ADD COLUMN "gig_id" varchar(21) NOT NULL;--> statement-breakpoint
ALTER TABLE "worker_ratings" ADD COLUMN "gig_id" varchar(21) NOT NULL;--> statement-breakpoint
ALTER TABLE "employer_ratings" ADD CONSTRAINT "employer_ratings_gig_id_gigs_gig_id_fk" FOREIGN KEY ("gig_id") REFERENCES "public"."gigs"("gig_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_ratings" ADD CONSTRAINT "worker_ratings_gig_id_gigs_gig_id_fk" FOREIGN KEY ("gig_id") REFERENCES "public"."gigs"("gig_id") ON DELETE cascade ON UPDATE no action;