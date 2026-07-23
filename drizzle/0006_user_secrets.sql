CREATE TABLE IF NOT EXISTS "user_secrets" (
	"userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"provider" text NOT NULL,
	"secret" text NOT NULL,
	"updatedAt" timestamp NOT NULL DEFAULT now(),
	CONSTRAINT "user_secrets_pk" PRIMARY KEY ("userId", "provider")
);
