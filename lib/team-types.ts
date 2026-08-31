// Types and constants for teams — no 'use server' so they can be safely
// imported by both server actions and client components.

export type Permission =
  | 'view_team'
  | 'view_members'
  | 'view_api'
  | 'invite_members'
  | 'remove_members'
  | 'change_member_role'
  | 'manage_roles'
  | 'share_api_readonly'
  | 'share_api_full'
  | 'revoke_api'
  | 'grant_project_access'
  | 'revoke_project_access'
  | 'edit_team'
  | 'delete_team'

export const BUILT_IN_ROLES: { name: string; permissions: Permission[] }[] = [
  {
    name: 'Admin',
    permissions: [
      'view_team', 'view_members', 'view_api',
      'invite_members', 'remove_members', 'change_member_role',
      'manage_roles', 'share_api_readonly', 'share_api_full', 'revoke_api',
      'grant_project_access', 'revoke_project_access', 'edit_team',
    ],
  },
  {
    name: 'Editor',
    permissions: [
      'view_team', 'view_members', 'view_api',
      'invite_members', 'share_api_readonly',
    ],
  },
  {
    name: 'Viewer',
    permissions: ['view_team', 'view_members'],
  },
]

export const OWNER_PERMISSIONS: Permission[] = [
  'view_team', 'view_members', 'view_api',
  'invite_members', 'remove_members', 'change_member_role',
  'manage_roles', 'share_api_readonly', 'share_api_full', 'revoke_api',
  'grant_project_access', 'revoke_project_access', 'edit_team', 'delete_team',
]

export type TeamItem = {
  id: string
  name: string
  description: string
  icon: string | null
  ownerId: string
  memberCount: number
  myRole: 'owner' | string
  createdAt: string
}

export type TeamMemberItem = {
  id: string
  userId: string
  name: string
  email: string
  image: string | null
  username: string | null
  roleId: string | null
  roleName: string | null
  status: string
  joinedAt: string
  isOwner: boolean
}

export type TeamRoleItem = {
  id: string
  teamId: string
  name: string
  permissions: Permission[]
  isBuiltIn: boolean
}

export type TeamApiShareItem = {
  id: string
  apiKeyId: number
  keyName: string
  modelId: string
  accessLevel: string
  // Only included when accessLevel === 'full'
  maskedKey?: string
  baseUrl?: string | null
  sharedAt: string
}

export type ProjectAccessItem = {
  id: string
  projectId: number
  projectName: string
  accessLevel: string
  grantedAt: string
}

export type InviteInfo = {
  teamName: string
  teamIcon: string | null
  invitedByName: string
  expiresAt: string
  teamId: string
}
