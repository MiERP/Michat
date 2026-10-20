CREATE TABLE `knowledge_links` (
	`id` text PRIMARY KEY NOT NULL,
	`notebook_id` text NOT NULL,
	`source_document_id` text NOT NULL,
	`target_document_id` text NOT NULL,
	`source_chunk_id` text,
	`target_chunk_id` text,
	`relation_type` text DEFAULT 'related' NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`evidence` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_chunk_id`) REFERENCES `chunks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_chunk_id`) REFERENCES `chunks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_links_notebook` ON `knowledge_links` (`notebook_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_links_source` ON `knowledge_links` (`source_document_id`);--> statement-breakpoint
CREATE INDEX `idx_links_target` ON `knowledge_links` (`target_document_id`);--> statement-breakpoint
CREATE TABLE `chunk_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`chunk_id` text NOT NULL,
	`notebook_id` text NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chunk_id`) REFERENCES `chunks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_feedback_chunk` ON `chunk_feedback` (`chunk_id`);--> statement-breakpoint
CREATE INDEX `idx_feedback_notebook` ON `chunk_feedback` (`notebook_id`);
