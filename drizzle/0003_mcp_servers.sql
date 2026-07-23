CREATE TABLE IF NOT EXISTS "mcp_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"authType" text NOT NULL DEFAULT 'none',
	"token" text NOT NULL DEFAULT '',
	"enabled" boolean NOT NULL DEFAULT true,
	"createdAt" timestamp NOT NULL DEFAULT now(),
	"updatedAt" timestamp NOT NULL DEFAULT now()
);
