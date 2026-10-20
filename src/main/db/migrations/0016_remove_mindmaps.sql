-- Remove the mind map feature: drop its table and its items rows.
-- Historical migration 0008/0009 created them; this migration reverses that.
DELETE FROM items WHERE type = 'mindmap';--> statement-breakpoint
DROP TABLE IF EXISTS mind_maps;
