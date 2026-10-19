import type { AuthenticatedPrincipal, KnowledgeTransitionCommand } from '../../packages/contracts/src/index.js';
import type { KnowledgeTransitionAuthorizer } from '../../apps/api/src/application/knowledge-transition.js';

type Role = AuthenticatedPrincipal['roles'][number];

type FakeMember = {
  actor_id: string;
  team_id: string;
  asset_space_ids: string[];
  roles: Role[];
};

type FakeSpace = {
  asset_space_id: string;
  team_id: string;
};

const requiredRoles: Partial<Record<KnowledgeTransitionCommand['to'], readonly Role[]>> = {
  candidate: ['owner', 'steward'],
  reviewing: ['reviewer'],
  approved: ['reviewer'],
  publishing: ['publisher'],
};

export const createFakeKnowledgeAuthorization = (fixture: {
  members: FakeMember[];
  spaces: FakeSpace[];
}) => {
  const authenticate = (actorId: string): AuthenticatedPrincipal | null => {
    const memberships = fixture.members.filter((member) => member.actor_id === actorId);
    if (!memberships.length) return null;
    const teamIds = memberships.map((member) => member.team_id);
    return {
      actor: { actor_id: actorId, actor_type: 'human' },
      team_ids: teamIds,
      asset_space_ids: fixture.spaces
        .filter((space) => memberships.some((member) => member.team_id === space.team_id && member.asset_space_ids.includes(space.asset_space_id)))
        .map((space) => space.asset_space_id),
      roles: [...new Set(memberships.flatMap((member) => member.roles))],
    };
  };

  const authorizer: KnowledgeTransitionAuthorizer = {
    authorize: (principal, knowledge, command) => {
      const denied = { ok: false as const, reason: 'Not authorized for Knowledge transition' };
      if (
        principal.actor.actor_type !== 'human'
        || command.asset_space_id !== knowledge.asset_space_id
      ) return denied;

      const space = fixture.spaces.find((item) => item.asset_space_id === knowledge.asset_space_id);
      const allowedRoles = requiredRoles[command.to];
      if (!space || space.team_id !== knowledge.team_id || !allowedRoles) return denied;

      const allowed = fixture.members.some((member) =>
        member.actor_id === principal.actor.actor_id
        && member.team_id === knowledge.team_id
        && member.asset_space_ids.includes(knowledge.asset_space_id)
        && member.roles.some((role) => allowedRoles.includes(role)));
      return allowed ? { ok: true, actor: principal.actor } : denied;
    },
  };

  return { authenticate, authorizer };
};
