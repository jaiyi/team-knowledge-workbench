import type { Pool } from 'pg';
import type { AuthenticatedPrincipal } from '../../../../packages/contracts/src/index.js';

type Space = Readonly<{ teamId: string; assetSpaceId: string }>;
type SpaceRow = { team_id: string; asset_space_id: string };
type Result =
  | Readonly<{ ok: true; spaces: readonly Space[]; selected: Space | null }>
  | Readonly<{ ok: false; reason: 'unauthenticated' | 'unavailable' }>;

export const readAuthorizedAssetSpaces = async (
  database: Pick<Pool, 'connect'>,
  principal: AuthenticatedPrincipal | null,
  selection?: Space,
): Promise<Result> => {
  if (!principal || principal.actor.actor_type !== 'human') return { ok: false, reason: 'unauthenticated' };
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<SpaceRow>(
      `SELECT s.team_id, s.asset_space_id
       FROM asset_spaces s
       JOIN team_memberships m ON m.team_id = s.team_id
         AND m.actor_id = $1 AND m.status = 'active'
       WHERE s.team_id = ANY($2::text[]) AND s.asset_space_id = ANY($3::text[])
         AND EXISTS (
           SELECT 1 FROM knowledge_role_bindings r
           WHERE r.actor_id = m.actor_id AND r.team_id = s.team_id
             AND r.asset_space_id = s.asset_space_id
         )
       ORDER BY s.team_id, s.asset_space_id
       FOR SHARE OF s, m`,
      [principal.actor.actor_id, principal.team_ids, principal.asset_space_ids],
    );
    await client.query('COMMIT');
    const spaces = result.rows.map((row) => ({ teamId: row.team_id, assetSpaceId: row.asset_space_id }));
    const selected = selection
      ? spaces.find((space) => space.teamId === selection.teamId && space.assetSpaceId === selection.assetSpaceId)
      : spaces.length === 1 ? spaces[0] : undefined;
    if (selection && !selected) return { ok: false, reason: 'unavailable' };
    return { ok: true, spaces, selected: selected ?? null };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
