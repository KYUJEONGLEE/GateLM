ALTER TABLE "project_admin_invitations"
  ADD COLUMN "name" TEXT;

UPDATE "project_admin_invitations"
SET "name" = "email"
WHERE "name" IS NULL;

ALTER TABLE "project_admin_invitations"
  ALTER COLUMN "name" SET NOT NULL;
