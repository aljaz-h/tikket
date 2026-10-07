CREATE TABLE `api_idempotency` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`status_code` integer NOT NULL,
	`response` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `api_idempotency_created_idx` ON `api_idempotency` (`created_at`);--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`user_id` integer NOT NULL,
	`project_id` integer,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`expires_at` integer,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "api_tokens_kind_check" CHECK("api_tokens"."kind" in ('personal','project'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_tokens_user_idx` ON `api_tokens` (`user_id`,`kind`);--> statement-breakpoint
CREATE INDEX `api_tokens_project_idx` ON `api_tokens` (`project_id`);--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`automation_id` integer,
	`automation_name` text NOT NULL,
	`project_id` integer NOT NULL,
	`ticket_id` integer,
	`trigger` text NOT NULL,
	`event_id` text NOT NULL,
	`status` text NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`actions` text DEFAULT '[]' NOT NULL,
	`error` text,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_runs_status_check" CHECK("automation_runs"."status" in ('success','failed','skipped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_runs_event_unique` ON `automation_runs` (`event_id`,`automation_id`);--> statement-breakpoint
CREATE INDEX `automation_runs_project_idx` ON `automation_runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `automation_runs_automation_idx` ON `automation_runs` (`automation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `automation_runs_ticket_idx` ON `automation_runs` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `automations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT false NOT NULL,
	`trigger` text NOT NULL,
	`trigger_config` text DEFAULT '{}' NOT NULL,
	`conditions` text DEFAULT '{"any":[]}' NOT NULL,
	`actions` text DEFAULT '[]' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`last_run_at` integer,
	`run_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `automations_lookup_idx` ON `automations` (`project_id`,`trigger`,`enabled`,`position`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` integer NOT NULL,
	`created_by_id` integer,
	`format` text NOT NULL,
	`status` text NOT NULL,
	`file_name` text NOT NULL,
	`payload` text,
	`options` text DEFAULT '{}' NOT NULL,
	`summary` text DEFAULT '{}' NOT NULL,
	`result` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "imports_status_check" CHECK("imports"."status" in ('review','running','completed','failed'))
);
--> statement-breakpoint
CREATE INDEX `imports_project_idx` ON `imports` (`project_id`,`created_at`);--> statement-breakpoint
-- outbound_jobs is rebuilt to allow the 'automation' job kind. Migrations run in a transaction,
-- where PRAGMA foreign_keys has no effect, so dropping the old table would clear
-- hook_deliveries.job_id (ON DELETE SET NULL): keep those links and restore them afterwards.
CREATE TEMP TABLE `__hook_delivery_jobs` AS SELECT `id`, `job_id` FROM `hook_deliveries` WHERE `job_id` IS NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_outbound_jobs` (
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
	CONSTRAINT "outbound_jobs_status_check" CHECK("__new_outbound_jobs"."status" in ('pending','running','done','dead')),
	CONSTRAINT "outbound_jobs_kind_check" CHECK("__new_outbound_jobs"."kind" in ('email','discord','webhook','automation'))
);
--> statement-breakpoint
INSERT INTO `__new_outbound_jobs`("id", "kind", "status", "payload", "dedupe_key", "project_id", "hook_id", "attempts", "max_attempts", "next_attempt_at", "lease_until", "last_error", "created_at", "updated_at", "finished_at") SELECT "id", "kind", "status", "payload", "dedupe_key", "project_id", "hook_id", "attempts", "max_attempts", "next_attempt_at", "lease_until", "last_error", "created_at", "updated_at", "finished_at" FROM `outbound_jobs`;--> statement-breakpoint
DROP TABLE `outbound_jobs`;--> statement-breakpoint
ALTER TABLE `__new_outbound_jobs` RENAME TO `outbound_jobs`;--> statement-breakpoint
UPDATE `hook_deliveries` SET `job_id` = (SELECT `job_id` FROM `__hook_delivery_jobs` j WHERE j.`id` = `hook_deliveries`.`id`) WHERE `id` IN (SELECT `id` FROM `__hook_delivery_jobs`);--> statement-breakpoint
DROP TABLE `__hook_delivery_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `outbound_jobs_dedupe_unique` ON `outbound_jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `outbound_jobs_due_idx` ON `outbound_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `outbound_jobs_kind_idx` ON `outbound_jobs` (`kind`,`status`,`updated_at`);--> statement-breakpoint
ALTER TABLE `projects` ADD `workflow_settings` text;--> statement-breakpoint
ALTER TABLE `ticket_comments` ADD `meta` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `external_ref` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `import_meta` text;