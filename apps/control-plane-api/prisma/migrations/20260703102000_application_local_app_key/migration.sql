-- Existing applications map to the only current local application surface.
ALTER TABLE "applications"
  ADD COLUMN IF NOT EXISTS "localApplicationKey" TEXT NOT NULL DEFAULT 'chat';

UPDATE "applications"
SET "localApplicationKey" = 'chat'
WHERE "localApplicationKey" IS NULL OR "localApplicationKey" = '';
