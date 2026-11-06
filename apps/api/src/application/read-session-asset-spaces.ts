import type { Pool } from 'pg';
import { digestSessionHandle, type SessionRequest } from './workbench-session.js';

type Space = Readonly<{ teamId: string; assetSpaceId: string }>;
type SpaceRow = { team_id: string; asset_space_id: string };
type BindingRow = {
  git_repository_id: string;
  git_protected_ref: string;
  weknora_space_id: string;
  config_version: number;
  status: 'pending' | 'disabled';
};
type Result =
  | Readonly<{
      ok: true;
      spaces: readonly Space[];
      selected: Space | null;
      binding: Readonly<{
        gitRepositoryId: string;
        gitProtectedRef: string;
        weknoraSpaceId: string;
        configVersion: number;
        status: 'pending' | 'disabled';
      }> | null;
      bindingBlocker: 'pending_review' | 'disabled' | 'not_configured' | null;
    }>
  | Readonly<{ ok: false; reason: 'unauthenticated' | 'unavailable' }>;

// All state used by this read is checked in a single transaction. This is not a Provider authorization.
export const readSessionAssetSpaces = async (
  database: Pick<Pool, 'connect'>,
  request: SessionRequest,
  selection?: Space,
): Promise<Result> => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const session = await client.query<{ principal_id: string }>(
      `SELECT i.principal_id FROM workbench_sessions s
       JOIN workbench_identity_bindings i ON i.principal_id = s.principal_id
         AND i.status = 'active' AND i.revocation_epoch = s.identity_epoch
       WHERE s.handle_digest = $1 AND s.host_id = $2 AND s.environment = $3
         ${request.channel ? 'AND s.channel = $4' : ''}
         AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP
       FOR SHARE OF s, i`,
      request.channel
        ? [digestSessionHandle(request.sessionHandle), request.hostId, request.environment, request.channel]
        : [digestSessionHandle(request.sessionHandle), request.hostId, request.environment],
    );
    const principalId = session.rows[0]?.principal_id;
    if (!principalId) {
      await client.query('COMMIT');
      return { ok: false, reason: 'unauthenticated' };
    }
    const result = await client.query<SpaceRow>(
      `SELECT s.team_id, s.asset_space_id FROM asset_spaces s
       JOIN team_memberships m ON m.team_id = s.team_id
         AND m.actor_id = $1 AND m.status = 'active'
       JOIN knowledge_role_bindings r ON r.actor_id = m.actor_id
         AND r.team_id = s.team_id AND r.asset_space_id = s.asset_space_id
       ORDER BY s.team_id, s.asset_space_id
       FOR SHARE OF s, m, r`,
      [principalId],
    );
    const spaces = result.rows.reduce<Space[]>((found, row) => {
      if (!found.some((space) => space.teamId === row.team_id && space.assetSpaceId === row.asset_space_id)) {
        found.push({ teamId: row.team_id, assetSpaceId: row.asset_space_id });
      }
      return found;
    }, []);
    const selected = selection
      ? spaces.find((space) => space.teamId === selection.teamId && space.assetSpaceId === selection.assetSpaceId)
      : spaces.length === 1 ? spaces[0] : undefined;
    if (selection && !selected) {
      await client.query('COMMIT');
      return { ok: false, reason: 'unavailable' };
    }
    let binding: Extract<Result, { ok: true }>['binding'] = null;
    let bindingBlocker: Extract<Result, { ok: true }>['bindingBlocker'] = selected ? 'not_configured' : null;
    if (selected) {
      const bindings = await client.query<BindingRow>(
        `SELECT git_repository_id, git_protected_ref, weknora_space_id, config_version, status
         FROM asset_space_resource_bindings
         WHERE team_id = $1 AND asset_space_id = $2
         FOR SHARE`,
        [selected.teamId, selected.assetSpaceId],
      );
      const row = bindings.rows[0];
      if (row) {
        binding = { gitRepositoryId: row.git_repository_id, gitProtectedRef: row.git_protected_ref,
          weknoraSpaceId: row.weknora_space_id, configVersion: row.config_version, status: row.status };
        bindingBlocker = row.status === 'pending' ? 'pending_review' : 'disabled';
      }
    }
    await client.query('COMMIT');
    return { ok: true, spaces, selected: selected ?? null, binding, bindingBlocker };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
