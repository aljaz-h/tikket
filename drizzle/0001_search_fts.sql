-- Full-text index over ticket titles and plain-text descriptions (external content table).
CREATE VIRTUAL TABLE `tickets_fts` USING fts5(
	title,
	description_text,
	content='tickets',
	content_rowid='id',
	tokenize='porter unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `tickets_fts_ai` AFTER INSERT ON `tickets` BEGIN
	INSERT INTO tickets_fts(rowid, title, description_text) VALUES (new.id, new.title, new.description_text);
END;
--> statement-breakpoint
CREATE TRIGGER `tickets_fts_ad` AFTER DELETE ON `tickets` BEGIN
	INSERT INTO tickets_fts(tickets_fts, rowid, title, description_text) VALUES ('delete', old.id, old.title, old.description_text);
END;
--> statement-breakpoint
CREATE TRIGGER `tickets_fts_au` AFTER UPDATE OF title, description_text ON `tickets` BEGIN
	INSERT INTO tickets_fts(tickets_fts, rowid, title, description_text) VALUES ('delete', old.id, old.title, old.description_text);
	INSERT INTO tickets_fts(rowid, title, description_text) VALUES (new.id, new.title, new.description_text);
END;
