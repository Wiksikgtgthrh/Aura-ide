CREATE TABLE "project_team_access" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" integer NOT NULL,
	"teamId" text NOT NULL,
	"accessLevel" text DEFAULT 'read' NOT NULL,
	"grantedByUserId" text NOT NULL,
	"grantedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_api_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"teamId" text NOT NULL,
	"apiKeyId" integer NOT NULL,
	"accessLevel" text DEFAULT 'readonly' NOT NULL,
	"sharedByUserId" text NOT NULL,
	"sharedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"teamId" text NOT NULL,
	"invitedUserId" text,
	"invitedByUserId" text NOT NULL,
	"token" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" text PRIMARY KEY NOT NULL,
	"teamId" text NOT NULL,
	"userId" text NOT NULL,
	"roleId" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"joinedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"teamId" text NOT NULL,
	"name" text NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"isBuiltIn" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_team_access" ADD CONSTRAINT "project_team_access_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_team_access" ADD CONSTRAINT "project_team_access_teamId_teams_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_team_access" ADD CONSTRAINT "project_team_access_grantedByUserId_user_id_fk" FOREIGN KEY ("grantedByUserId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_api_shares" ADD CONSTRAINT "team_api_shares_teamId_teams_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_api_shares" ADD CONSTRAINT "team_api_shares_apiKeyId_api_keys_id_fk" FOREIGN KEY ("apiKeyId") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_api_shares" ADD CONSTRAINT "team_api_shares_sharedByUserId_user_id_fk" FOREIGN KEY ("sharedByUserId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_teamId_teams_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_invitedUserId_user_id_fk" FOREIGN KEY ("invitedUserId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_invitedByUserId_user_id_fk" FOREIGN KEY ("invitedByUserId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_teams_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_roleId_team_roles_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."team_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_roles" ADD CONSTRAINT "team_roles_teamId_teams_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;