ALTER TABLE `documents` ADD COLUMN `content_md_hash` text;--> statement-breakpoint
ALTER TABLE `chunks` ADD COLUMN `content_hash` text;--> statement-breakpoint
CREATE INDEX `idx_chunks_document_hash` ON `chunks` (`document_id`,`content_hash`);
