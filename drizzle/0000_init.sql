CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`uploader_id` integer NOT NULL,
	`project_id` integer,
	`ticket_id` integer,
	`comment_id` integer,
	`kind` text,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`extension` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`has_thumbnail` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`attached_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`comment_id`) REFERENCES `ticket_comments`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `attachments_ticket_idx` ON `attachments` (`ticket_id`);--> statement-breakpoint
CREATE INDEX `attachments_comment_idx` ON `attachments` (`comment_id`);--> statement-breakpoint
CREATE INDEX `attachments_pending_idx` ON `attachments` (`attached_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` integer,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`data` text DEFAULT '{}' NOT NULL,
	`ip_address` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_action_idx` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE TABLE `changelog_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`version` text NOT NULL,
	`release_date` text NOT NULL,
	`summary_html` text DEFAULT '' NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`created_by_id` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `changelog_entries_project_idx` ON `changelog_entries` (`project_id`,`release_date`);--> statement-breakpoint
CREATE TABLE `changelog_ticket_links` (
	`entry_id` integer NOT NULL,
	`ticket_id` integer NOT NULL,
	PRIMARY KEY(`entry_id`, `ticket_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `changelog_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`email` text,
	`role` text DEFAULT 'user' NOT NULL,
	`project_id` integer,
	`project_role` text,
	`created_by_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`used_by_id` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`used_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`project_id` integer,
	`ticket_id` integer,
	`actor_id` integer,
	`data` text DEFAULT '{}' NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` integer NOT NULL,
	`created_by_id` integer,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_token_unique` ON `password_resets` (`token_hash`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_members_role_check" CHECK("project_members"."role" in ('owner','moderator','member'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_unique` ON `project_members` (`project_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `project_members_user_idx` ON `project_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon` text,
	`color` text DEFAULT 'indigo' NOT NULL,
	`url` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`allow_anonymous_read` integer DEFAULT false NOT NULL,
	`submission_policy` text DEFAULT 'any_user' NOT NULL,
	`voting_enabled` integer DEFAULT true NOT NULL,
	`attachments_enabled` integer DEFAULT true NOT NULL,
	`comments_enabled` integer DEFAULT true NOT NULL,
	`edit_policy` text DEFAULT 'while_open' NOT NULL,
	`ticket_counter` integer DEFAULT 0 NOT NULL,
	`created_by_id` integer,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "projects_visibility_check" CHECK("projects"."visibility" in ('public','private'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_key_unique` ON `projects` (`key`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `ticket_activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`actor_id` integer,
	`type` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ticket_activity_ticket_idx` ON `ticket_activity` (`ticket_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ticket_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`author_id` integer NOT NULL,
	`body_html` text NOT NULL,
	`body_text` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	`deleted_by_id` integer,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`deleted_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ticket_comments_ticket_idx` ON `ticket_comments` (`ticket_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ticket_followers` (
	`ticket_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`ticket_id`, `user_id`),
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ticket_followers_user_idx` ON `ticket_followers` (`user_id`);--> statement-breakpoint
CREATE TABLE `ticket_label_assignments` (
	`ticket_id` integer NOT NULL,
	`label_id` integer NOT NULL,
	PRIMARY KEY(`ticket_id`, `label_id`),
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `ticket_labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ticket_label_assignments_label_idx` ON `ticket_label_assignments` (`label_id`);--> statement-breakpoint
CREATE TABLE `ticket_labels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'slate' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_labels_project_name_unique` ON `ticket_labels` (`project_id`,lower("name"));--> statement-breakpoint
CREATE TABLE `ticket_votes` (
	`ticket_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`ticket_id`, `user_id`),
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ticket_votes_user_idx` ON `ticket_votes` (`user_id`);--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`number` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description_html` text NOT NULL,
	`description_text` text NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`reporter_id` integer NOT NULL,
	`assignee_id` integer,
	`duplicate_of_id` integer,
	`resolution_note` text,
	`vote_count` integer DEFAULT 0 NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`completed_at` integer,
	`closed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`duplicate_of_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tickets_status_check" CHECK("tickets"."status" in ('open','planned','in_progress','completed','on_hold','declined','duplicate')),
	CONSTRAINT "tickets_priority_check" CHECK("tickets"."priority" in ('low','medium','high','critical')),
	CONSTRAINT "tickets_type_check" CHECK("tickets"."type" in ('bug','feature','improvement','feedback')),
	CONSTRAINT "tickets_vote_count_check" CHECK("tickets"."vote_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_project_number_unique` ON `tickets` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `tickets_project_status_updated_idx` ON `tickets` (`project_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `tickets_project_updated_idx` ON `tickets` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `tickets_reporter_idx` ON `tickets` (`reporter_id`);--> statement-breakpoint
CREATE INDEX `tickets_assignee_idx` ON `tickets` (`assignee_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`avatar_id` text,
	`bio` text,
	`theme` text,
	`notification_prefs` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_login_at` integer,
	`password_changed_at` integer,
	CONSTRAINT "users_role_check" CHECK("users"."role" in ('admin','user')),
	CONSTRAINT "users_status_check" CHECK("users"."status" in ('active','disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (lower("email"));