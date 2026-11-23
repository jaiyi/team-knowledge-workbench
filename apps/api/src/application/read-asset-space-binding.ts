import type { Pool } from 'pg';
import type { AuthenticatedPrincipal } from '../../../../packages/contracts/src/index.js';

type Database = Pick<Pool, 'connect'>;
type BindingRow = {
  asset_space_id: string;
  git_repository_id: string;
  git_protected_ref: string;
  weknora_space_id: string;
  config_version: number;
  status: 'pending' | 'disabled';
};

export const readAssetSpaceBinding = async (
  database: Database,
  principal: AuthenticatedPrincipal | null,
  teamId: string,
  assetSpaceId: string,
): Promise<Readonly<{
  assetSpaceId: string;
  gitRepositoryId: string;
  gitProtectedRef: string;
  weknoraSpaceId: string;
  configVersion: number;
  status: 'pending' | 'disabled';
}> | null> => {
  if (!principal || principal.actor.actor_type !== 'human'
    || !principal.team_ids.includes(teamId) || !principal.asset_space_ids.includes(assetSpaceId)) return null;
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<BindingRow>(
      `SELECT b.asset_space_id, b.git_repository_id, b.git_protected_ref, b.weknora_space_id,
              b.config_version, b.status
       FROM asset_space_resource_bindings b
       JOIN team_memberships m ON m.team_id = b.team_id AND m.actor_id = $1 AND m.status = 'active'
       JOIN knowledge_role_bindings r ON r.actor_id = m.actor_id
         AND r.team_id = b.team_id AND r.asset_space_id = b.asset_space_id
       WHERE b.team_id = $2 AND b.asset_space_id = $3
       FOR SHARE OF b, m, r`,
      [principal.actor.actor_id, teamId, assetSpaceId],
    );
    await client.query('COMMIT');
    const row = result.rows[0];
    return row ? { assetSpaceId: row.asset_space_id, gitRepositoryId: row.git_repository_id,
      gitProtectedRef: row.git_protected_ref, weknoraSpaceId: row.weknora_space_id,
      configVersion: row.config_version, status: row.status } : null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
