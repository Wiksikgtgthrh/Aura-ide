import {
  pgTable,
  text,
  timestamp,
  boolean,
  serial,
  integer,
  jsonb,
  primaryKey,
} from 'drizzle-orm/pg-core'

// --- Better Auth required tables -------------------------------------------
// Column names are camelCase to match Better Auth's defaults. Do not rename.

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  username: text('username').unique(),
  displayUsername: text('displayUsername'),
  isAnonymous: boolean('isAnonymous').default(false),
  bio: text('bio').notNull().default(''),
  tagChanged: boolean('tagChanged').notNull().default(false),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
})

// --- App tables ------------------------------------------------------------

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

export const apiKeyGroups = pgTable('api_key_groups', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  key: text('key').notNull(),
  baseUrl: text('baseUrl').notNull().default('https://api.openai.com/v1'),
  modelId: text('modelId').notNull().default('gpt-4o-mini'),
  // 'unknown' | 'active' | 'error' | 'timeout'
  status: text('status').notNull().default('unknown'),
  // ping in ms, null = never checked
  ping: integer('ping'),
  // reason for error/timeout
  failReason: text('failReason'),
  // nullable group id
  groupId: text('groupId'),
  // order within group / root
  position: integer('position').notNull().default(0),
  lastCheckedAt: timestamp('lastCheckedAt'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

export const tokenUsage = pgTable('token_usage', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  chatId: text('chatId'),
  apiKeyId: integer('apiKeyId'),
  modelId: text('modelId').notNull().default(''),
  promptTokens: integer('promptTokens').notNull().default(0),
  completionTokens: integer('completionTokens').notNull().default(0),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

export const chats = pgTable('chats', {
  id: text('id').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  projectId: integer('projectId'),
  title: text('title').notNull().default('New chat'),
  favorite: boolean('favorite').notNull().default(false),
  // 'html' = classic single-file HTML preview, 'ide' = TSX multi-file IDE
  mode: text('mode').notNull().default('html'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  chatId: text('chatId')
    .notNull()
    .references(() => chats.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  parts: jsonb('parts').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

// Persistent virtual file system of an IDE chat/project.
// Source of truth for the editor: survives reloads and lets the model see
// the user's manual edits. Composite PK — one row per (chat, path).
export const projectFiles = pgTable(
  'project_files',
  {
    chatId: text('chatId')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    content: text('content').notNull().default(''),
    updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chatId, t.path] })],
)

// Version checkpoints: full snapshot of the project FS after each AI reply.
// Powers "history / rollback / diff" in the IDE. Pruned to the last 20 per chat.
export const projectCheckpoints = pgTable('project_checkpoints', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  chatId: text('chatId')
    .notNull()
    .references(() => chats.id, { onDelete: 'cascade' }),
  label: text('label').notNull().default(''),
  files: jsonb('files').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

// Encrypted per-user secrets for integrations (e.g. GitHub PAT).
// One row per (user, provider); secret encrypted with AES-256-GCM.
export const userSecrets = pgTable(
  'user_secrets',
  {
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    secret: text('secret').notNull(),
    updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider] })],
)

export const preferences = pgTable('preferences', {
  userId: text('userId').primaryKey(),
  suggestions: boolean('suggestions').notNull().default(true),
  soundNotifications: boolean('soundNotifications').notNull().default(true),
  chatPosition: text('chatPosition').notNull().default('left'),
  customInstructions: text('customInstructions').notNull().default(''),
  theme: text('theme').notNull().default('system'),
  // 'ask' | 'allow-all'
  autoPermissions: text('autoPermissions').notNull().default('ask'),
  // IDE settings
  // 'html' | 'ide'
  defaultMode: text('defaultMode').notNull().default('html'),
  editorFontSize: integer('editorFontSize').notNull().default(14),
  editorTabSize: integer('editorTabSize').notNull().default(2),
  editorWordWrap: boolean('editorWordWrap').notNull().default(false),
  autoPreview: boolean('autoPreview').notNull().default(false),
  // Memory settings
  memoriesEnabled: boolean('memoriesEnabled').notNull().default(true),
  memoriesAutoExtract: boolean('memoriesAutoExtract').notNull().default(false),
  memoriesMaxCount: integer('memoriesMaxCount').notNull().default(25),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

// --- Memory tables ---------------------------------------------------------

// 'coding-style' | 'project-context' | 'preference' | 'fact'
export const memories = pgTable('memories', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  type: text('type').notNull().default('fact'),
  content: text('content').notNull(),
  // 'user-added' | 'auto-extracted'
  source: text('source').notNull().default('user-added'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

// --- Team tables -----------------------------------------------------------

export const teams = pgTable('teams', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text('ownerId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  icon: text('icon'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const teamRoles = pgTable('team_roles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text('teamId')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // JSON array of Permission strings
  permissions: jsonb('permissions').notNull().default([]),
  isBuiltIn: boolean('isBuiltIn').notNull().default(false),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

export const teamMembers = pgTable('team_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text('teamId')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  roleId: text('roleId').references(() => teamRoles.id, { onDelete: 'set null' }),
  // 'pending' = invited but not yet accepted, 'active' = accepted
  status: text('status').notNull().default('pending'),
  joinedAt: timestamp('joinedAt').notNull().defaultNow(),
})

export const teamInvites = pgTable('team_invites', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text('teamId')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  // The user who was invited (resolved at invite time by username search)
  invitedUserId: text('invitedUserId').references(() => user.id, { onDelete: 'cascade' }),
  invitedByUserId: text('invitedByUserId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique().$defaultFn(() => crypto.randomUUID()),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

export const teamApiShares = pgTable('team_api_shares', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text('teamId')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  apiKeyId: integer('apiKeyId')
    .notNull()
    .references(() => apiKeys.id, { onDelete: 'cascade' }),
  // 'readonly' = only model names visible, 'full' = key + baseUrl visible
  accessLevel: text('accessLevel').notNull().default('readonly'),
  sharedByUserId: text('sharedByUserId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  sharedAt: timestamp('sharedAt').notNull().defaultNow(),
})

// --- Plugin tables ---------------------------------------------------------

export const plugins = pgTable('plugins', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  author: text('author').notNull().default('Aura Team'),
  version: text('version').notNull().default('1.0.0'),
  type: text('type').notNull().default('utility'), // 'utility' | 'skill' | 'system-mod'
  scope: text('scope').notNull().default('ide-component'), // 'ide-component' | 'ai-skill' | 'system-ui'
  icon: text('icon').notNull().default('Puzzle'),
  manifest: jsonb('manifest').notNull().default({}),
  publishedAt: timestamp('publishedAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const userPlugins = pgTable('user_plugins', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  pluginId: text('pluginId')
    .notNull()
    .references(() => plugins.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(true),
  installedAt: timestamp('installedAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const mcpServers = pgTable('mcp_servers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  // 'none' | 'bearer' | 'oauth'
  authType: text('authType').notNull().default('none'),
  token: text('token').notNull().default(''),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

// --- Billing tables --------------------------------------------------------

export const userBalance = pgTable('user_balance', {
  userId: text('userId').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  // token balance (credits)
  balance: integer('balance').notNull().default(0),
  // 'free' | 'pro' | 'team'
  plan: text('plan').notNull().default('free'),
  planExpiresAt: timestamp('planExpiresAt'),
  referralCode: text('referralCode').notNull().unique().$defaultFn(() => Math.random().toString(36).slice(2, 8).toUpperCase()),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const referrals = pgTable('referrals', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  referrerId: text('referrerId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  referredId: text('referredId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  bonusAmount: integer('bonusAmount').notNull().default(100),
  bonusCredited: boolean('bonusCredited').notNull().default(false),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

// 'topup' | 'usage' | 'referral_bonus' | 'plan_purchase'
export const transactions = pgTable('transactions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  amount: integer('amount').notNull(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

export const projectTeamAccess = pgTable('project_team_access', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: integer('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  teamId: text('teamId')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  // 'read' | 'edit' | 'admin'
  accessLevel: text('accessLevel').notNull().default('read'),
  grantedByUserId: text('grantedByUserId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  grantedAt: timestamp('grantedAt').notNull().defaultNow(),
})
