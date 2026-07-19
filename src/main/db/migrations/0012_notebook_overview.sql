CREATE TABLE `notebook_overviews` (
  `id` text PRIMARY KEY NOT NULL,
  `notebook_id` text NOT NULL,
  `content` text NOT NULL,
  `citations` text NOT NULL,
  `source_fingerprint` text NOT NULL,
  `status` text DEFAULT 'fresh' NOT NULL,
  `model` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_notebook_overviews_notebook` ON `notebook_overviews` (`notebook_id`);
