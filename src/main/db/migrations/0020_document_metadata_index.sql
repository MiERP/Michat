CREATE TABLE `document_metadata_values` (
  `document_id` text NOT NULL REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
  `notebook_id` text NOT NULL REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE cascade,
  `field` text NOT NULL,
  `value_normalized` text NOT NULL,
  `value_display` text NOT NULL,
  `source` text NOT NULL DEFAULT 'extractor',
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_document_metadata_lookup` ON `document_metadata_values` (`notebook_id`,`field`,`value_normalized`);
--> statement-breakpoint
CREATE INDEX `idx_document_metadata_document` ON `document_metadata_values` (`document_id`);
--> statement-breakpoint
INSERT INTO `document_metadata_values`
  (`document_id`, `notebook_id`, `field`, `value_normalized`, `value_display`, `source`, `updated_at`)
SELECT id, notebook_id, 'documentNumber', upper(replace(replace(replace(json_extract(metadata, '$.documentMetadata.documentNumber'), ' ', ''), '.', ''), '-', '')), json_extract(metadata, '$.documentMetadata.documentNumber'), 'migration', CAST(strftime('%s','now') AS INTEGER) * 1000
FROM `documents`
WHERE json_extract(metadata, '$.documentMetadata.documentNumber') IS NOT NULL
  AND trim(json_extract(metadata, '$.documentMetadata.documentNumber')) <> '';
--> statement-breakpoint
INSERT INTO `document_metadata_values`
  (`document_id`, `notebook_id`, `field`, `value_normalized`, `value_display`, `source`, `updated_at`)
SELECT id, notebook_id, 'documentType', upper(replace(replace(json_extract(metadata, '$.documentMetadata.documentType'), ' ', ''), '-', '')), json_extract(metadata, '$.documentMetadata.documentType'), 'migration', CAST(strftime('%s','now') AS INTEGER) * 1000
FROM `documents`
WHERE json_extract(metadata, '$.documentMetadata.documentType') IS NOT NULL
  AND trim(json_extract(metadata, '$.documentMetadata.documentType')) <> '';
--> statement-breakpoint
INSERT INTO `document_metadata_values`
  (`document_id`, `notebook_id`, `field`, `value_normalized`, `value_display`, `source`, `updated_at`)
SELECT id, notebook_id, 'issuer', upper(replace(replace(json_extract(metadata, '$.documentMetadata.issuer'), ' ', ''), '-', '')), json_extract(metadata, '$.documentMetadata.issuer'), 'migration', CAST(strftime('%s','now') AS INTEGER) * 1000
FROM `documents`
WHERE json_extract(metadata, '$.documentMetadata.issuer') IS NOT NULL
  AND trim(json_extract(metadata, '$.documentMetadata.issuer')) <> '';
