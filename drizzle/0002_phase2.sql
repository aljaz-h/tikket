CREATE TABLE `ticket_relationships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_ticket_id` integer NOT NULL,
	`target_ticket_id` integer NOT NULL,
	`kind` text NOT NULL,
	`created_by_id` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`source_ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ticket_relationships_kind_check" CHECK("ticket_relationships"."kind" in ('relates','blocks')),
	CONSTRAINT "ticket_relationships_no_self" CHECK("ticket_relationships"."source_ticket_id" <> "ticket_relationships"."target_ticket_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_relationships_unique` ON `ticket_relationships` (`source_ticket_id`,`target_ticket_id`,`kind`);--> statement-breakpoint
CREATE INDEX `ticket_relationships_target_idx` ON `ticket_relationships` (`target_ticket_id`);--> statement-breakpoint
CREATE TABLE `ticket_template_fields` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`help` text,
	`placeholder` text,
	`required` integer DEFAULT false NOT NULL,
	`options` text DEFAULT '[]' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `ticket_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ticket_template_fields_kind_check" CHECK("ticket_template_fields"."kind" in ('short_text','long_text','select','checkbox','url'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_template_fields_key_unique` ON `ticket_template_fields` (`template_id`,`key`);--> statement-breakpoint
CREATE TABLE `ticket_template_responses` (
	`ticket_id` integer PRIMARY KEY NOT NULL,
	`template_id` integer,
	`template_name` text NOT NULL,
	`template_version` integer NOT NULL,
	`answers` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `ticket_templates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `ticket_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ticket_templates_type_check" CHECK("ticket_templates"."type" in ('bug','feature','improvement','feedback'))
);
--> statement-breakpoint
CREATE INDEX `ticket_templates_project_idx` ON `ticket_templates` (`project_id`,`type`);--> statement-breakpoint
CREATE TABLE `widget_allowed_origins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `widget_allowed_origins_unique` ON `widget_allowed_origins` (`project_id`,`origin`);--> statement-breakpoint
CREATE TABLE `widget_settings` (
	`project_id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`button_label` text DEFAULT 'Feedback' NOT NULL,
	`position` text DEFAULT 'bottom-right' NOT NULL,
	`accent_color` text DEFAULT '#6c68ee' NOT NULL,
	`default_type` text DEFAULT 'bug' NOT NULL,
	`screenshots_enabled` integer DEFAULT true NOT NULL,
	`collect_context` integer DEFAULT true NOT NULL,
	`last_seen_origin` text,
	`last_seen_at` integer,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `widget_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`origin` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `widget_tokens_user_idx` ON `widget_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `widget_tokens_expires_idx` ON `widget_tokens` (`expires_at`);--> statement-breakpoint
ALTER TABLE `ticket_comments` ADD `internal` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD `source` text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD `environment` text;