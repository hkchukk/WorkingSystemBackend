ALTER TABLE "gigs" ALTER COLUMN "title" SET DATA TYPE text;--> statement-breakpoint
CREATE INDEX "pgroonga_gigs_index" ON "gigs" USING pgroonga ("title") WITH (tokenizer='TokenBigramSplitSymbol');--> statement-breakpoint
CREATE INDEX "pgroonga2_gigs_index" ON "gigs" USING pgroonga ("description") WITH (tokenizer='TokenBigramSplitSymbol');