-- Create the notebooks table
CREATE TABLE `notebooks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
-- Create the index
CREATE INDEX `idx_notebooks_updated` ON `notebooks` (`updated_at`);
--> statement-breakpoint
-- Create notebooks for existing chat_sessions
-- Create notebook rows from existing notebook_id values
INSERT INTO `notebooks` (`id`, `title`, `description`, `created_at`, `updated_at`)
SELECT DISTINCT
	cs.notebook_id as id,
	'Notebook ' || substr(cs.notebook_id, -6) as title,
	NULL as description,
	MIN(cs.created_at) as created_at,
	MAX(cs.updated_at) as updated_at
FROM chat_sessions cs
GROUP BY cs.notebook_id;