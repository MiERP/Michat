ALTER TABLE `documents` ADD COLUMN `memory_of_session_id` text;--> statement-breakpoint
CREATE INDEX `idx_documents_memory_session` ON `documents` (`memory_of_session_id`);
