import type { Pool } from 'pg';
import type { AuthenticatedPrincipal } from '../../packages/contracts/src/index.js';
import { readAuthorizedAssetSpaces } from '../../apps/api/src/application/read-authorized-asset-spaces.js';
import type { createSyntheticOidcLogin } from './synthetic-oidc-login.js';

type SessionRequest = Parameters<ReturnType<typeof createSyntheticOidcLogin>['session']>[0];
type Selection = Parameters<typeof readAuthorizedAssetSpaces>[2];
const denied = { ok: false as const, reason: 'unavailable' };

// Test-only bridge. A real Backend needs an independently verified session and an atomic authorization boundary.
export async function readSyntheticSessionAssetSpaces(
  database: Pick<Pool, 'connect'>,
  login: ReturnType<typeof createSyntheticOidcLogin>,
  request: SessionRequest,
  selection?: Selection,
) {
  const identity = login.session(request);
  if (!identity.ok) return denied;
  const client = await database.connect();
  let spaces: { team_id: string; asset_space_id: string }[];
  try {
    const result = await client.query<{ team_id: string; asset_space_id: string }>(
      `SELECT s.team_id, s.asset_space_id FROM asset_spaces s
       JOIN team_memberships m ON m.team_id = s.team_id
         AND m.actor_id = $1 AND m.status = 'active'
       WHERE EXISTS (
         SELECT 1 FROM knowledge_role_bindings r
         WHERE r.actor_id = m.actor_id AND r.team_id = s.team_id
           AND r.asset_space_id = s.asset_space_id
       )
       ORDER BY s.team_id, s.asset_space_id`,
      [identity.principalId],
    );
    spaces = result.rows;
  } finally {
    client.release();
  }
  const principal: AuthenticatedPrincipal = {
    actor: { actor_id: identity.principalId, actor_type: 'human' },
    team_ids: [...new Set(spaces.map((space) => space.team_id))],
    asset_space_ids: spaces.map((space) => space.asset_space_id),
    roles: [],
  };
  const current = await readAuthorizedAssetSpaces(database, principal, selection);
  const checked = login.session(request);
  return checked.ok && checked.principalId === identity.principalId ? current : denied;
}
