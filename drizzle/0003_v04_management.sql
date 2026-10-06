CREATE TABLE `milestones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`target_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`completed_at` integer,
	`created_by_id` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "milestones_status_check" CHECK("milestones"."status" in ('open','completed','archived'))
);
--> statement-breakpoint
CREATE INDEX `milestones_project_status_idx` ON `milestones` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `project_activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`actor_id` integer,
	`subject_type` text NOT NULL,
	`subject_id` integer NOT NULL,
	`type` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_activity_subject_idx` ON `project_activity` (`project_id`,`subject_type`,`subject_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `saved_views` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`owner_id` integer,
	`created_by_id` integer,
	`name` text NOT NULL,
	`definition` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `saved_views_project_owner_idx` ON `saved_views` (`project_id`,`owner_id`,`position`);--> statement-breakpoint
ALTER TABLE `changelog_entries` ADD `status` text DEFAULT 'planned' NOT NULL;--> statement-breakpoint
ALTER TABLE `changelog_entries` ADD `target_date` text;--> statement-breakpoint
ALTER TABLE `changelog_entries` ADD `released_at` integer;--> statement-breakpoint
CREATE INDEX `changelog_entries_project_status_idx` ON `changelog_entries` (`project_id`,`status`);--> statement-breakpoint
ALTER TABLE `tickets` ADD `release_id` integer REFERENCES changelog_entries(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `tickets` ADD `milestone_id` integer REFERENCES milestones(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `tickets_release_idx` ON `tickets` (`release_id`,`status`);--> statement-breakpoint
CREATE INDEX `tickets_milestone_idx` ON `tickets` (`milestone_id`,`status`);--> statement-breakpoint
-- v0.4 data migration (hand-written; additive, preserves all existing entries) -----------------
-- Existing changelog entries become releases: published ones are "released", drafts "planned".
UPDATE `changelog_entries` SET `status` = CASE WHEN `published` = 1 THEN 'released' ELSE 'planned' END,
	`released_at` = CASE WHEN `published` = 1 THEN `updated_at` ELSE NULL END,
	`target_date` = CASE WHEN `published` = 1 THEN NULL ELSE `release_date` END;--> statement-breakpoint
-- Version names must be unique per project (case-insensitive); rename older duplicates.
UPDATE `changelog_entries` SET `version` = `version` || ' (' || `id` || ')'
	WHERE `id` NOT IN (SELECT max(`id`) FROM `changelog_entries` GROUP BY `project_id`, lower(`version`));--> statement-breakpoint
CREATE UNIQUE INDEX `changelog_entries_project_version_unique` ON `changelog_entries` (`project_id`, lower(`version`));--> statement-breakpoint
CREATE UNIQUE INDEX `milestones_project_name_unique` ON `milestones` (`project_id`, lower(`name`));--> statement-breakpoint
-- Ticket links of changelog entries become each ticket's (single) release: the most recent entry
-- of the ticket's own project wins when a ticket was listed in several entries.
UPDATE `tickets` SET `release_id` = (
	SELECT l.`entry_id` FROM `changelog_ticket_links` l
	JOIN `changelog_entries` e ON e.`id` = l.`entry_id`
	WHERE l.`ticket_id` = `tickets`.`id` AND e.`project_id` = `tickets`.`project_id`
	ORDER BY e.`release_date` DESC, e.`id` DESC LIMIT 1
) WHERE `id` IN (SELECT `ticket_id` FROM `changelog_ticket_links`);--> statement-breakpoint
DROP TABLE `changelog_ticket_links`;--> statement-breakpoint
-- A ticket's release and milestone must belong to the ticket's own project.
CREATE TRIGGER `tickets_release_project_insert` BEFORE INSERT ON `tickets`
	WHEN NEW.`release_id` IS NOT NULL AND (SELECT `project_id` FROM `changelog_entries` WHERE `id` = NEW.`release_id`) IS NOT NEW.`project_id`
	BEGIN SELECT RAISE(ABORT, 'release belongs to another project'); END;--> statement-breakpoint
CREATE TRIGGER `tickets_release_project_update` BEFORE UPDATE OF `release_id`, `project_id` ON `tickets`
	WHEN NEW.`release_id` IS NOT NULL AND (SELECT `project_id` FROM `changelog_entries` WHERE `id` = NEW.`release_id`) IS NOT NEW.`project_id`
	BEGIN SELECT RAISE(ABORT, 'release belongs to another project'); END;--> statement-breakpoint
CREATE TRIGGER `tickets_milestone_project_insert` BEFORE INSERT ON `tickets`
	WHEN NEW.`milestone_id` IS NOT NULL AND (SELECT `project_id` FROM `milestones` WHERE `id` = NEW.`milestone_id`) IS NOT NEW.`project_id`
	BEGIN SELECT RAISE(ABORT, 'milestone belongs to another project'); END;--> statement-breakpoint
CREATE TRIGGER `tickets_milestone_project_update` BEFORE UPDATE OF `milestone_id`, `project_id` ON `tickets`
	WHEN NEW.`milestone_id` IS NOT NULL AND (SELECT `project_id` FROM `milestones` WHERE `id` = NEW.`milestone_id`) IS NOT NEW.`project_id`
	BEGIN SELECT RAISE(ABORT, 'milestone belongs to another project'); END;
