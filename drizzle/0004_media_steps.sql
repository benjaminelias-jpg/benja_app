ALTER TYPE "public"."automation_step_type" ADD VALUE 'send_audio' BEFORE 'reply_comment';--> statement-breakpoint
ALTER TYPE "public"."automation_step_type" ADD VALUE 'send_video' BEFORE 'reply_comment';--> statement-breakpoint
ALTER TYPE "public"."automation_step_type" ADD VALUE 'send_file' BEFORE 'reply_comment';--> statement-breakpoint
ALTER TYPE "public"."automation_step_type" ADD VALUE 'typing' BEFORE 'reply_comment';