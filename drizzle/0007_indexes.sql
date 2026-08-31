-- Hot foreign-key / filter indexes (created concurrently is not possible in a
-- single migration txn here; these are cheap on an empty/small DB and IF NOT
-- EXISTS keeps re-runs safe).
CREATE INDEX IF NOT EXISTS "chats_userId_idx" ON "chats" ("userId");
CREATE INDEX IF NOT EXISTS "chats_projectId_idx" ON "chats" ("projectId");
CREATE INDEX IF NOT EXISTS "messages_chatId_createdAt_idx" ON "messages" ("chatId", "createdAt");
-- token_usage: the daily built-in limit runs COUNT(*) WHERE userId=? AND
-- apiKeyId IS NULL AND createdAt>=? on every chat message.
CREATE INDEX IF NOT EXISTS "token_usage_userId_createdAt_idx" ON "token_usage" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "token_usage_userId_apiKeyId_createdAt_idx" ON "token_usage" ("userId", "apiKeyId", "createdAt");
CREATE INDEX IF NOT EXISTS "memories_userId_idx" ON "memories" ("userId");
CREATE INDEX IF NOT EXISTS "api_keys_userId_idx" ON "api_keys" ("userId");
CREATE INDEX IF NOT EXISTS "team_members_userId_idx" ON "team_members" ("userId");
CREATE INDEX IF NOT EXISTS "team_members_teamId_idx" ON "team_members" ("teamId");
CREATE INDEX IF NOT EXISTS "project_team_access_projectId_idx" ON "project_team_access" ("projectId");
CREATE INDEX IF NOT EXISTS "project_team_access_teamId_idx" ON "project_team_access" ("teamId");
CREATE INDEX IF NOT EXISTS "projects_userId_idx" ON "projects" ("userId");
-- project_files.chatId is already the leading column of its composite PK
-- (chatId, path), so a standalone index is redundant.
