CREATE TABLE `sections` (
	`id` text PRIMARY KEY NOT NULL,
	`notebook_id` text NOT NULL,
	`document_id` text NOT NULL REFERENCES `documents`(`id`) ON DELETE cascade,
	`heading_path` text NOT NULL,
	`title` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sections_document` ON `sections` (`document_id`);
--> statement-breakpoint
ALTER TABLE `chunks` ADD COLUMN `section_id` text;
--> statement-breakpoint
CREATE INDEX `idx_chunks_section` ON `chunks` (`section_id`);
