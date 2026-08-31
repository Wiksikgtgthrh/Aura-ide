CREATE TABLE IF NOT EXISTS "project_files" (
	"chatId" text NOT NULL REFERENCES "chats"("id") ON DELETE CASCADE,
	"path" text NOT NULL,
	"content" text NOT NULL DEFAULT '',
	"updatedAt" timestamp NOT NULL DEFAULT now(),
	CONSTRAINT "project_files_pk" PRIMARY KEY ("chatId", "path")
);
