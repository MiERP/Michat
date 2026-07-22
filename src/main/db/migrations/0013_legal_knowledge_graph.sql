CREATE TABLE `legal_extraction_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`notebook_id` text NOT NULL,
	`document_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`extractor_version` text NOT NULL,
	`prompt_version` text NOT NULL,
	`ontology_version` text NOT NULL,
	`model` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`source_unit_count` integer DEFAULT 0 NOT NULL,
	`processed_unit_count` integer DEFAULT 0 NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`next_run_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_legal_extraction_jobs_document` ON `legal_extraction_jobs` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_legal_extraction_jobs_status_next_run` ON `legal_extraction_jobs` (`status`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `idx_legal_extraction_jobs_notebook_status` ON `legal_extraction_jobs` (`notebook_id`,`status`);--> statement-breakpoint
CREATE TABLE `legal_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`notebook_id` text NOT NULL,
	`document_id` text,
	`chunk_id` text,
	`node_type` text NOT NULL,
	`canonical_key` text NOT NULL,
	`label` text NOT NULL,
	`aliases` text NOT NULL,
	`article_number` text,
	`clause_number` text,
	`point_number` text,
	`start_offset` integer,
	`end_offset` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chunk_id`) REFERENCES `chunks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_legal_nodes_identity` ON `legal_nodes` (`notebook_id`,`node_type`,`canonical_key`);--> statement-breakpoint
CREATE INDEX `idx_legal_nodes_document_type` ON `legal_nodes` (`document_id`,`node_type`);--> statement-breakpoint
CREATE INDEX `idx_legal_nodes_chunk` ON `legal_nodes` (`chunk_id`);--> statement-breakpoint
CREATE INDEX `idx_legal_nodes_notebook_label` ON `legal_nodes` (`notebook_id`,`label`);--> statement-breakpoint
CREATE TABLE `legal_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`notebook_id` text NOT NULL,
	`source_node_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`document_id` text NOT NULL,
	`evidence_chunk_id` text NOT NULL,
	`evidence_text` text NOT NULL,
	`evidence_start_offset` integer NOT NULL,
	`evidence_end_offset` integer NOT NULL,
	`confidence` real NOT NULL,
	`qualifiers` text,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`extractor_version` text NOT NULL,
	`ontology_version` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_node_id`) REFERENCES `legal_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_node_id`) REFERENCES `legal_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidence_chunk_id`) REFERENCES `chunks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "legal_relations_confidence_check" CHECK("legal_relations"."confidence" >= 0 AND "legal_relations"."confidence" <= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_legal_relations_fingerprint` ON `legal_relations` (`notebook_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_legal_relations_source_type` ON `legal_relations` (`source_node_id`,`relation_type`);--> statement-breakpoint
CREATE INDEX `idx_legal_relations_target_type` ON `legal_relations` (`target_node_id`,`relation_type`);--> statement-breakpoint
CREATE INDEX `idx_legal_relations_document` ON `legal_relations` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_legal_relations_evidence_chunk` ON `legal_relations` (`evidence_chunk_id`);
