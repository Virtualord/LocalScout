CREATE TABLE `audits` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`metrics` text NOT NULL,
	`checks` text NOT NULL,
	`findings` text NOT NULL,
	`opportunity_score` integer NOT NULL,
	`report_path` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audits_lead_idx` ON `audits` (`lead_id`);--> statement-breakpoint
CREATE INDEX `audits_lead_created_idx` ON `audits` (`lead_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `contact_log` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`channel` text NOT NULL,
	`event` text NOT NULL,
	`note` text,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_log_lead_idx` ON `contact_log` (`lead_id`);--> statement-breakpoint
CREATE INDEX `contact_log_at_idx` ON `contact_log` (`at`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`audit_id` text,
	`language` text NOT NULL,
	`whatsapp_text` text NOT NULL,
	`email_subject` text,
	`email_body` text,
	`generated_by` text NOT NULL,
	`model` text,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`grounded` integer DEFAULT false NOT NULL,
	`validation_errors` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`approved_at` integer,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `drafts_lead_idx` ON `drafts` (`lead_id`);--> statement-breakpoint
CREATE INDEX `drafts_lead_language_idx` ON `drafts` (`lead_id`,`language`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`place_id` text NOT NULL,
	`domain_key` text,
	`name` text NOT NULL,
	`category` text,
	`address` text,
	`lat` real,
	`lng` real,
	`phone` text,
	`phone_e164` text,
	`phone_is_mobile` integer,
	`website_url` text,
	`contact_email` text,
	`rating` real,
	`review_count` integer,
	`source_run_id` text,
	`status` text DEFAULT 'discovered' NOT NULL,
	`skip_reason` text,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`source_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_place_id_idx` ON `leads` (`place_id`);--> statement-breakpoint
CREATE INDEX `leads_domain_key_idx` ON `leads` (`domain_key`);--> statement-breakpoint
CREATE INDEX `leads_status_idx` ON `leads` (`status`);--> statement-breakpoint
CREATE INDEX `leads_run_idx` ON `leads` (`source_run_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`query` text NOT NULL,
	`location` text NOT NULL,
	`limit` integer NOT NULL,
	`language` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`serpapi_calls` integer DEFAULT 0 NOT NULL,
	`leads_found` integer DEFAULT 0 NOT NULL,
	`leads_new` integer DEFAULT 0 NOT NULL,
	`audits_ok` integer DEFAULT 0 NOT NULL,
	`audits_failed` integer DEFAULT 0 NOT NULL,
	`drafts_llm` integer DEFAULT 0 NOT NULL,
	`drafts_fallback` integer DEFAULT 0 NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runs_status_idx` ON `runs` (`status`);--> statement-breakpoint
CREATE INDEX `runs_created_at_idx` ON `runs` (`created_at`);--> statement-breakpoint
CREATE TABLE `saved_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`query` text NOT NULL,
	`location` text NOT NULL,
	`limit` integer DEFAULT 20 NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`cron` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `saved_searches_cron_idx` ON `saved_searches` (`cron`);