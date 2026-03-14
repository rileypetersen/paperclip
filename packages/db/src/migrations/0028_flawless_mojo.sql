CREATE TABLE "discord_thread_mappings" (
	"thread_id" text PRIMARY KEY NOT NULL,
	"issue_id" uuid NOT NULL,
	"channel_message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discord_thread_mappings" ADD CONSTRAINT "discord_thread_mappings_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;