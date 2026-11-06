import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

export type SessionRequest = Readonly<{
  sessionHandle: string;
  hostId: string;
  environment: string;
  channel?: 'web' | 'host';
}>;

type PrincipalRow = { principal_id: string };

// This only reads an existing internal session; it does not attest a Host or issue handles.
export const digestSessionHandle = (handle: string): string =>
  `sha256:${createHash('sha256').update(handle).digest('hex')}`;

export const resolveWorkbenchSession = async (
  database: Pick<Pool, 'connect'>,
  request: SessionRequest,
): Promise<Readonly<{ principalId: string }> | null> => {
  const client = await database.connect();
  try {
    const result = await client.query<PrincipalRow>(
      `SELECT i.principal_id FROM workbench_sessions s
       JOIN workbench_identity_bindings i ON i.principal_id = s.principal_id
         AND i.status = 'active' AND i.revocation_epoch = s.identity_epoch
       WHERE s.handle_digest = $1 AND s.host_id = $2 AND s.environment = $3
         ${request.channel ? 'AND s.channel = $4' : ''}
         AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP`,
      request.channel
        ? [digestSessionHandle(request.sessionHandle), request.hostId, request.environment, request.channel]
        : [digestSessionHandle(request.sessionHandle), request.hostId, request.environment],
    );
    return result.rows[0] ? { principalId: result.rows[0].principal_id } : null;
  } finally {
    client.release();
  }
};

export const revokeWorkbenchSession = async (
  database: Pick<Pool, 'connect'>,
  handleDigest: string,
): Promise<boolean> => {
  const client = await database.connect();
  try {
    const result = await client.query(
      'UPDATE workbench_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE handle_digest = $1 AND revoked_at IS NULL',
      [handleDigest],
    );
    return result.rowCount === 1;
  } finally {
    client.release();
  }
};
