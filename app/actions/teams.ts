/**
 * Barrel re-export — all team actions.
 * Internals are split across app/actions/teams/ for maintainability.
 */
export type {
  Permission,
  TeamItem,
  TeamMemberItem,
  TeamRoleItem,
  TeamApiShareItem,
  ProjectAccessItem,
  InviteInfo,
} from '@/lib/team-types'

export {
  getTeams,
  getTeamsForUser,
  createTeam,
  updateTeam,
  deleteTeam,
  getTeamDetail,
} from './teams/crud'

export {
  getTeamMembers,
  removeMember,
  updateMemberRole,
  inviteByUsername,
  acceptInvite,
  declineInvite,
  getInviteInfo,
  getTeamRoles,
  createCustomRole,
  updateRole,
  deleteRole,
} from './teams/members'

export {
  getSharedApis,
  shareApiWithTeam,
  updateApiShareLevel,
  revokeApiShare,
  grantProjectAccess,
  revokeProjectAccess,
  getProjectTeamAccess,
} from './teams/api-share'
