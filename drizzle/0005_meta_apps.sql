CREATE TABLE "meta_apps" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"method" "connection_method" DEFAULT 'instagram_login' NOT NULL,
	"app_id" text NOT NULL,
	"app_secret" text NOT NULL,
	"config_id" text,
	"verified_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meta_apps" ADD CONSTRAINT "meta_apps_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_apps_org_idx" ON "meta_apps" USING btree ("org_id");