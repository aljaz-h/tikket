CREATE TABLE `github_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`repo_id` integer,
	`webhook_secret_enc` text NOT NULL,
	`token_enc` text,
	`merge_action` text DEFAULT 'none' NOT NULL,
	`last_event_at` integer,
	`last_event_type` text,
	`last_error_at` integer,
	`last_error` text,
	`created_by_id` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "github_connections_merge_check" CHECK("github_connections"."merge_action" in ('none','in_progress','completed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_connections_public_unique` ON `github_connections` (`public_id`);--> statement-breakpoint
CREATE INDEX `github_connections_project_idx` ON `github_connections` (`project_id`);--> statement-breakpoint
CREATE TABLE `github_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` integer NOT NULL,
	`event` text NOT NULL,
	`received_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `github_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `github_deliveries_received_idx` ON `github_deliveries` (`received_at`);--> statement-breakpoint
CREATE TABLE `hook_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hook_id` integer NOT NULL,
	`job_id` integer,
	`event` text NOT NULL,
	`event_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`status_code` integer,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`success` integer NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`hook_id`) REFERENCES `project_hooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `outbound_jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `hook_deliveries_hook_idx` ON `hook_deliveries` (`hook_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `outbound_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text NOT NULL,
	`dedupe_key` text,
	`project_id` integer,
	`hook_id` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 6 NOT NULL,
	`next_attempt_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`lease_until` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hook_id`) REFERENCES `project_hooks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "outbound_jobs_status_check" CHECK("outbound_jobs"."status" in ('pending','running','done','dead')),
	CONSTRAINT "outbound_jobs_kind_check" CHECK("outbound_jobs"."kind" in ('email','discord','webhook'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbound_jobs_dedupe_unique` ON `outbound_jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `outbound_jobs_due_idx` ON `outbound_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `outbound_jobs_kind_idx` ON `outbound_jobs` (`kind`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `project_hooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`url_enc` text NOT NULL,
	`url_hint` text NOT NULL,
	`secret_enc` text,
	`events` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_success_at` integer,
	`last_failure_at` integer,
	`last_error` text,
	`created_by_id` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "project_hooks_kind_check" CHECK("project_hooks"."kind" in ('discord','webhook'))
);
--> statement-breakpoint
CREATE INDEX `project_hooks_project_idx` ON `project_hooks` (`project_id`,`kind`);--> statement-breakpoint
CREATE TABLE `ticket_dev_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`connection_id` integer NOT NULL,
	`kind` text NOT NULL,
	`ref` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`state` text,
	`author` text,
	`external_updated_at` integer,
	`source` text DEFAULT 'auto' NOT NULL,
	`created_by_id` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `github_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ticket_dev_links_kind_check" CHECK("ticket_dev_links"."kind" in ('pull_request','commit','issue'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_dev_links_unique` ON `ticket_dev_links` (`ticket_id`,`connection_id`,`kind`,`ref`);--> statement-breakpoint
CREATE INDEX `ticket_dev_links_ref_idx` ON `ticket_dev_links` (`connection_id`,`kind`,`ref`);--> statement-breakpoint
ALTER TABLE `projects` ADD `accent_color` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `docs_url` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `roadmap_settings` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email_prefs` text;