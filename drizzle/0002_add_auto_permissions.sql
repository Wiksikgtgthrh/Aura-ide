ALTER TABLE "preferences" ADD COLUMN IF NOT EXISTS "autoPermissions" text DEFAULT 'ask' NOT NULL;
