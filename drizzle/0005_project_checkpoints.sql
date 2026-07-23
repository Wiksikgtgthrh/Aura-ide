CREATE TABLE IF NOT EXISTS "project_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"chatId" text NOT NULL REFERENCES "chats"("id") ON DELETE CASCADE,
	"label" text NOT NULL DEFAULT '',
	"files" jsonb NOT NULL,
	"createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "project_checkpoints_chat_idx" ON "project_checkpoints" ("chatId", "createdAt");
