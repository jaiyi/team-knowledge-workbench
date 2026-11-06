import type { Pool } from 'pg';
import { digestSessionHandle, type SessionRequest } from './workbench-session.js';

type Target = Readonly<{
  teamId: string;
  assetSpaceId: string;
  knowledgeId: string;
  assetRevision: number;
  stateVersion: number;
  configVersion: number | null;
}>;
type Result =
  | Readonly<{ ok: true; bindingBlocker: 'pending_review' | 'disabled' | 'not_configured' }>
  | Readonly<{ ok: false; reason: 'unauthenticated' | 'unavailable' }>;

// A scope/version preflight only: no object, source or Provider access is authorized by this result.
export const readSessionKnowledgeLocator = async (
  database: Pick<Pool, 'connect'>,
  request: SessionRequest,
  target: Target,
): Promise<Result> => {
  if (request.channel !== 'web' || request.hostId !== 'web') return { ok: false, reason: 'unauthenticated' };
  if (!target || !target.teamId || !target.assetSpaceId || !target.knowledgeId
    || !Number.isSafeInteger(target.assetRevision) || target.assetRevision <= 0
    || !Number.isSafeInteger(target.stateVersion) || target.stateVersion < 0
    || (target.configVersion !== null
      && (!Number.isSafeInteger(target.configVersion) || target.configVersion <= 0))) {
    return { ok: false, reason: 'unavailable' };
  }
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const session = await client.query<{ principal_id: string }>(
      `SELECT i.principal_id FROM workbench_sessions s
       JOIN workbench_identity_bindings i ON i.principal_id = s.principal_id
         AND i.status = 'active' AND i.revocation_epoch = s.identity_epoch
       WHERE s.handle_digest = $1 AND s.host_id = $2 AND s.environment = $3 AND s.channel = 'web'
         AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP
       FOR SHARE OF s, i`,
      [digestSessionHandle(request.sessionHandle), request.hostId, request.environment],
    );
    const principalId = session.rows[0]?.principal_id;
    if (!principalId) {
      await client.query('COMMIT');
      return { ok: false, reason: 'unauthenticated' };
    }
    const object = await client.query(
      `SELECT k.knowledge_id FROM knowledge_states k
       JOIN asset_spaces s ON s.team_id = k.team_id AND s.asset_space_id = k.asset_space_id
       JOIN team_memberships m ON m.team_id = s.team_id AND m.actor_id = $6 AND m.status = 'active'
       JOIN knowledge_role_bindings r ON r.actor_id = m.actor_id
         AND r.team_id = s.team_id AND r.asset_space_id = s.asset_space_id
       WHERE k.knowledge_id = $1 AND k.team_id = $2 AND k.asset_space_id = $3
         AND k.asset_revision = $4 AND k.state_version = $5
       FOR SHARE OF k, s, m, r`,
      [target.knowledgeId, target.teamId, target.assetSpaceId, target.assetRevision, target.stateVersion, principalId],
    );
    if (!object.rows.length) {
      await client.query('COMMIT');
      return { ok: false, reason: 'unavailable' };
    }
    const binding = await client.query<{ config_version: number; status: 'pending' | 'disabled' }>(
      `SELECT config_version, status FROM asset_space_resource_bindings
       WHERE team_id = $1 AND asset_space_id = $2 FOR SHARE`, [target.teamId, target.assetSpaceId],
    );
    const row = binding.rows[0];
    if ((row?.config_version ?? null) !== target.configVersion) {
      await client.query('COMMIT');
      return { ok: false, reason: 'unavailable' };
    }
    await client.query('COMMIT');
    return { ok: true, bindingBlocker: row ? row.status === 'pending' ? 'pending_review' : 'disabled' : 'not_configured' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
