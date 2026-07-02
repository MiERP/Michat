CREATE TABLE `podcast_scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`notebook_id` text NOT NULL,
	`title` text NOT NULL,
	`script` text NOT NULL,
	`audio_path` text,
	`status` text DEFAULT 'script_ready' NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_podcast_scripts_notebook` ON `podcast_scripts` (`notebook_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_podcast_scripts_status` ON `podcast_scripts` (`status`);
