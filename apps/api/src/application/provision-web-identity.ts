import type { Pool } from 'pg';

type Identity = Readonly<{ issuer: string; subject: string; principalId: string }>;
type Grant = Readonly<{ teamId: string; assetSpaceId: string; role: 'owner' | 'steward' | 'reviewer' | 'publisher' }>;
type Request = Identity & (Readonly<{ action: 'provision'; grants: readonly Grant[] }> | Readonly<{ action: 'disable' }>);
type Result = Readonly<{ action: Request['action']; outcome: 'would_apply' | 'applied' | 'unchanged' }>;

export async function provisionWebIdentity(database: Pick<Pool, 'connect'>, request: Request, apply = false): Promise<Result> {
  const { issuer, subject, principalId } = request;
  const address = new URL(issuer);
  if (address.protocol !== 'https:' || issuer !== address.href || address.username || address.password
    || address.search || address.hash || !subject.trim() || !principalId.trim()) {
    throw new Error('Invalid identity request');
  }
  if (request.action === 'provision' && (!request.grants.length
    || new Set(request.grants.map((grant) => `${grant.teamId}\0${grant.assetSpaceId}\0${grant.role}`)).size !== request.grants.length
    || request.grants.some((grant) => !grant.teamId.trim() || !grant.assetSpaceId.trim()
      || !['owner', 'steward', 'reviewer', 'publisher'].includes(grant.role)))) {
    throw new Error('Invalid grants');
  }
  const connection = await database.connect();
  try {
    await connection.query('BEGIN');
    const bound = await connection.query<{ issuer: string; subject: string; principal_id: string; status: string }>(
      `SELECT issuer, subject, principal_id, status FROM workbench_identity_bindings
       WHERE (issuer = $1 AND subject = $2) OR principal_id = $3 FOR UPDATE`, [issuer, subject, principalId]);
    const existing = bound.rows[0];
    if (bound.rows.length > 1 || (existing && (existing.issuer !== issuer || existing.subject !== subject
      || existing.principal_id !== principalId))) throw new Error('Conflicting identity binding');
    if (request.action === 'disable') {
      if (!existing) throw new Error('Missing identity binding');
      const outcome = existing.status === 'disabled' ? 'unchanged' : apply ? 'applied' : 'would_apply';
      if (outcome === 'applied') {
        await connection.query(`UPDATE workbench_identity_bindings SET status = 'disabled'
          WHERE issuer = $1 AND subject = $2 AND principal_id = $3`, [issuer, subject, principalId]);
        await connection.query(`UPDATE team_memberships SET status = 'disabled'
          WHERE actor_id = $1`, [principalId]);
      }
      await connection.query('COMMIT');
      return { action: request.action, outcome };
    }
    if (existing?.status === 'disabled') throw new Error('Disabled identity cannot be provisioned');
    const spaces = await connection.query<{ team_id: string; asset_space_id: string }>(
      `SELECT team_id, asset_space_id FROM asset_spaces WHERE (team_id, asset_space_id) IN
       (SELECT * FROM UNNEST($1::text[], $2::text[])) FOR SHARE`,
      [request.grants.map((grant) => grant.teamId), request.grants.map((grant) => grant.assetSpaceId)]);
    if (spaces.rows.length !== new Set(request.grants.map((grant) => `${grant.teamId}\0${grant.assetSpaceId}`)).size) {
      throw new Error('Unapproved asset space');
    }
    const memberships = await connection.query<{ team_id: string; status: string }>(
      'SELECT team_id, status FROM team_memberships WHERE actor_id = $1 FOR UPDATE', [principalId]);
    const roles = await connection.query<{ team_id: string; asset_space_id: string; role: Grant['role'] }>(
      'SELECT team_id, asset_space_id, role FROM knowledge_role_bindings WHERE actor_id = $1 FOR UPDATE', [principalId]);
    const teams = [...new Set(request.grants.map((grant) => grant.teamId))];
    const grantKeys = request.grants.map((grant) => `${grant.teamId}\0${grant.assetSpaceId}\0${grant.role}`);
    if (memberships.rows.some((row) => !teams.includes(row.team_id) || row.status !== 'active')
      || roles.rows.some((row) => !grantKeys.includes(`${row.team_id}\0${row.asset_space_id}\0${row.role}`))) {
      throw new Error('Conflicting identity grants');
    }
    const unchanged = !!existing && memberships.rows.length === teams.length
      && roles.rows.length === request.grants.length;
    if (existing && !unchanged) throw new Error('Existing grants require separate review');
    if (apply && !unchanged) {
      await connection.query(`INSERT INTO workbench_identity_bindings (issuer, subject, principal_id)
        VALUES ($1, $2, $3)`, [issuer, subject, principalId]);
      for (const teamId of teams) if (!memberships.rows.some((row) => row.team_id === teamId)) {
        await connection.query(`INSERT INTO team_memberships
          (actor_id, team_id, status) VALUES ($1, $2, 'active')`, [principalId, teamId]);
      }
      for (const grant of request.grants) if (!roles.rows.some((row) => row.team_id === grant.teamId
        && row.asset_space_id === grant.assetSpaceId && row.role === grant.role)) {
        await connection.query(`INSERT INTO knowledge_role_bindings
          (actor_id, team_id, asset_space_id, role) VALUES ($1, $2, $3, $4)`,
        [principalId, grant.teamId, grant.assetSpaceId, grant.role]);
      }
    }
    await connection.query('COMMIT');
    return { action: request.action, outcome: unchanged ? 'unchanged' : apply ? 'applied' : 'would_apply' };
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}
