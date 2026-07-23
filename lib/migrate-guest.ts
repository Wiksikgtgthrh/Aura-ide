import 'server-only'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

/**
 * Migrate EVERYTHING a guest created onto their freshly registered account.
 *
 * Runs inside the anonymous plugin's onLinkAccount hook — i.e. right before
 * better-auth deletes the anonymous user. Without this, the delete would
 * cascade through chats → messages/project_files and silently destroy the
 * guest's projects, own API keys, memories and settings.
 *
 * Raw SQL keeps the statements identical across both drizzle drivers
 * (neon-http and node-postgres). Each statement is defensive:
 * unique-constrained rows are moved only when the target has no conflict.
 */
export async function migrateGuestData(
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  if (!fromUserId || !toUserId || fromUserId === toUserId) return

  const statements = [
    // Chats (messages + project_files reference chatId → follow automatically)
    sql`UPDATE "chats" SET "userId" = ${toUserId} WHERE "userId" = ${fromUserId}`,
    // Projects
    sql`UPDATE "projects" SET "userId" = ${toUserId} WHERE "userId" = ${fromUserId}`,
    // The guest's own API keys
    sql`UPDATE "api_keys" SET "userId" = ${toUserId} WHERE "userId" = ${fromUserId}`,
    sql`UPDATE "api_key_groups" SET "userId" = ${toUserId} WHERE "userId" = ${fromUserId}`,
    // Memories
    sql`UPDATE "memories" SET "userId" = ${toUserId} WHERE "userId" = ${fromUserId}`,
    // MCP servers
    sql`UPDATE "mcp_servers" SET "userId" = ${toUserId} WHERE "userId" = ${fromUserId}`,
    // Token usage history (keeps limits/stats honest)
    sql`UPDATE "token_usage" SET "userId" = ${toUserId} WHERE "userId" = ${fromUserId}`,
    // Installed plugins — skip ones the new account already has
    sql`UPDATE "user_plugins" SET "userId" = ${toUserId}
        WHERE "userId" = ${fromUserId}
          AND NOT EXISTS (
            SELECT 1 FROM "user_plugins" t
            WHERE t."userId" = ${toUserId} AND t."pluginId" = "user_plugins"."pluginId"
          )`,
    // Preferences — move only when the new account has none yet (PK userId)
    sql`UPDATE "preferences" SET "userId" = ${toUserId}
        WHERE "userId" = ${fromUserId}
          AND NOT EXISTS (SELECT 1 FROM "preferences" WHERE "userId" = ${toUserId})`,
    // Balance — same single-row semantics
    sql`UPDATE "user_balance" SET "userId" = ${toUserId}
        WHERE "userId" = ${fromUserId}
          AND NOT EXISTS (SELECT 1 FROM "user_balance" WHERE "userId" = ${toUserId})`,
    // Team memberships — skip teams the new account already joined
    sql`UPDATE "team_members" SET "userId" = ${toUserId}
        WHERE "userId" = ${fromUserId}
          AND NOT EXISTS (
            SELECT 1 FROM "team_members" t
            WHERE t."userId" = ${toUserId} AND t."teamId" = "team_members"."teamId"
          )`,
    // Teams the guest OWNS
    sql`UPDATE "teams" SET "ownerId" = ${toUserId} WHERE "ownerId" = ${fromUserId}`,
  ]

  for (const statement of statements) {
    try {
      await db.execute(statement)
    } catch {
      // A single failed transfer (e.g. an optional table that doesn't exist
      // in an older DB) must not abort the whole migration — nor the sign-up.
    }
  }
}
