CREATE TABLE `ticket_reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`ticket_id` integer NOT NULL,
	`remind_at` integer NOT NULL,
	`note` text,
	`sent_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ticket_reminders_due_idx` ON `ticket_reminders` (`sent_at`,`remind_at`);--> statement-breakpoint
CREATE INDEX `ticket_reminders_user_idx` ON `ticket_reminders` (`user_id`,`ticket_id`);--> statement-breakpoint
ALTER TABLE `automation_runs` ADD `protection` text;--> statement-breakpoint
ALTER TABLE `automation_runs` ADD `conditions` text;--> statement-breakpoint
CREATE INDEX `outbound_jobs_project_idx` ON `outbound_jobs` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `tickets_project_created_idx` ON `tickets` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tickets_duplicate_of_idx` ON `tickets` (`duplicate_of_id`);