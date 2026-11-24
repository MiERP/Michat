-- Add local_file_path to the documents table
-- Stores the path of the copy in the app data directory
ALTER TABLE documents ADD COLUMN local_file_path TEXT;
