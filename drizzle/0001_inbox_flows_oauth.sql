CREATE TYPE "public"."connection_method" AS ENUM('instagram_login', 'unified_login', 'manual');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'snoozed', 'closed');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('pending', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
ALTER TYPE "public"."automation_step_type" ADD VALUE 'send_image' BEFORE 'reply_comment';--> statement-breakpoint
ALTER TYPE "public"."automation_step_type" ADD VALUE 'ask_question' BEFORE 'add_tag';--> statement-breakpoint
ALTER TYPE "public"."automation_step_type" ADD VALUE 'condition' BEFORE 'add_tag';--> statement-breakpoint
CREATE TABLE "automation_waits" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"automation_id" text NOT NULL,
	"run_id" text,
	"node_id" text NOT NULL,
	"save_as" text,
	"content_id" text,
	"keyword_id" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"ig_account_id" text,
	"ig_thread_id" text,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"assigned_to" text,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_preview" text,
	"last_message_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"redirect_to" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_steps" ADD COLUMN "node_id" text;--> statement-breakpoint
ALTER TABLE "automation_steps" ADD COLUMN "next_node_id" text;--> statement-breakpoint
ALTER TABLE "automation_steps" ADD COLUMN "branches" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_steps" ADD COLUMN "canvas_x" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_steps" ADD COLUMN "canvas_y" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "connection_method" "connection_method" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "account_type" text;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "follows_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "media_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "last_inbox_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reply_to_mid" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "status" "message_status" DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "automation_waits" ADD CONSTRAINT "automation_waits_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_waits" ADD CONSTRAINT "automation_waits_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_waits" ADD CONSTRAINT "automation_waits_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_waits" ADD CONSTRAINT "automation_waits_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."contents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_waits" ADD CONSTRAINT "automation_waits_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_ig_account_id_instagram_accounts_id_fk" FOREIGN KEY ("ig_account_id") REFERENCES "public"."instagram_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "waits_lead_idx" ON "automation_waits" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_lead_idx" ON "conversations" USING btree ("org_id","lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_thread_idx" ON "conversations" USING btree ("org_id","ig_thread_id");--> statement-breakpoint
CREATE INDEX "conversations_recent_idx" ON "conversations" USING btree ("org_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "steps_node_idx" ON "automation_steps" USING btree ("automation_id","node_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","sent_at");