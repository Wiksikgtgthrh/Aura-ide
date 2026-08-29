-- История проверок API-ключей: пинг/скорость (TTFT) по времени.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_key_health" (
  "id" serial PRIMARY KEY,
  "apiKeyId" integer NOT NULL REFERENCES "api_keys"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'unknown',
  "ping" integer,
  "ttft" integer,
  "failReason" text,
  "checkedAt" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_key_health_key_checkedAt_idx" ON "api_key_health" ("apiKeyId", "checkedAt");
