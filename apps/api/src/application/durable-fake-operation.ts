import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

type Database = Pick<Pool, 'connect'>;
type Command = {
  operationId: string; idempotencyKey: string; assetSpaceId: string;
  knowledgeId: string; assetRevision: number; expectedDigest: string; target: 'synthetic-readback';
};
type Evidence = { operationId: string; assetSpaceId: string; knowledgeId: string;
  assetRevision: number; digest: string };
type Status = 'queued' | 'running' | 'waiting_readback' | 'unknown' | 'reconciling' | 'succeeded';
type Row = {
  operation_id: string; idempotency_key: string; asset_space_id: string;
  knowledge_id: string; asset_revision: number; expected_digest: string; target: Command['target'];
  request_digest: string; status: Status; version: number; lease_token: string | null;
  lease_expires_at: number | null; callback_sequence: number;
};
const keys = ['operationId', 'idempotencyKey', 'assetSpaceId', 'knowledgeId',
  'assetRevision', 'expectedDigest', 'target'];
const fixtureId = /^[a-z0-9-]{1,80}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const validCommand = (input: Command) => !!input && typeof input === 'object'
  && Object.keys(input).length === keys.length && keys.every((key) => key in input)
  && fixtureId.test(input.operationId) && fixtureId.test(input.idempotencyKey)
  && /^space-[a-z0-9-]{1,72}$/.test(input.assetSpaceId)
  && /^fixture-[a-z0-9-]{1,72}$/.test(input.knowledgeId)
  && Number.isSafeInteger(input.assetRevision) && input.assetRevision > 0
  && digestPattern.test(input.expectedDigest) && input.target === 'synthetic-readback';
const toOperation = (row: Row) => ({
  operationId: row.operation_id, idempotencyKey: row.idempotency_key,
  assetSpaceId: row.asset_space_id, knowledgeId: row.knowledge_id,
  assetRevision: row.asset_revision, expectedDigest: row.expected_digest,
  target: row.target, status: row.status, version: row.version,
  leaseToken: row.lease_token, leaseExpiresAt: row.lease_expires_at === null
    ? null : Number(row.lease_expires_at), callbackSequence: row.callback_sequence,
});
const matches = (row: Row, evidence: Evidence | null) => !!evidence
  && evidence.operationId === row.operation_id && evidence.assetSpaceId === row.asset_space_id
  && evidence.knowledgeId === row.knowledge_id && evidence.assetRevision === row.asset_revision
  && evidence.digest === row.expected_digest;
const readRow = async (client: PoolClient, space: string, id: string) => {
  const result = await client.query<Row>(
    'SELECT * FROM synthetic_operations WHERE operation_id = $1 AND asset_space_id = $2', [id, space],
  );
  return result.rows[0] ?? null;
};

// This store is only called by isolated synthetic tests, never by an unauthenticated HTTP route.
export const createDurableFakeOperation = (database: Database) => ({
  async enqueue(command: Command) {
    if (!validCommand(command)) throw new Error('Invalid synthetic operation');
    const fingerprint = `sha256:${createHash('sha256').update(JSON.stringify(keys.map((key) =>
      command[key as keyof Command]))).digest('hex')}`;
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<Row>(`INSERT INTO synthetic_operations
        (operation_id, asset_space_id, idempotency_key, knowledge_id, asset_revision,
         expected_digest, target, request_digest) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING RETURNING *`,
      [command.operationId, command.assetSpaceId, command.idempotencyKey, command.knowledgeId,
        command.assetRevision, command.expectedDigest, command.target, fingerprint]);
      if (inserted.rows.length) {
        await client.query(`INSERT INTO synthetic_operation_outbox (operation_id, asset_space_id)
          VALUES ($1, $2)`, [command.operationId, command.assetSpaceId]);
        await client.query('COMMIT');
        return { ...toOperation(inserted.rows[0]!), replayed: false };
      }
      const prior = await client.query<Row>(`SELECT * FROM synthetic_operations
        WHERE operation_id = $1 OR (asset_space_id = $2 AND idempotency_key = $3) FOR UPDATE`,
      [command.operationId, command.assetSpaceId, command.idempotencyKey]);
      const row = prior.rows[0];
      if (prior.rows.length !== 1 || !row || row.operation_id !== command.operationId
        || row.asset_space_id !== command.assetSpaceId || row.idempotency_key !== command.idempotencyKey
        || row.request_digest !== fingerprint) throw new Error('Conflicting synthetic operation');
      const intent = await client.query(`SELECT 1 FROM synthetic_operation_outbox
        WHERE operation_id = $1 AND asset_space_id = $2`, [row.operation_id, row.asset_space_id]);
      if (intent.rows.length !== 1) throw new Error('Missing synthetic delivery intent');
      await client.query('COMMIT');
      return { ...toOperation(row), replayed: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  },
  async read(space: string, id: string) {
    const client = await database.connect();
    try {
      const row = await readRow(client, space, id);
      return row ? toOperation(row) : null;
    } finally { client.release(); }
  },
  async claim(space: string, token: string, now: number, duration: number) {
    if (!fixtureId.test(token) || !Number.isSafeInteger(now) || !Number.isSafeInteger(duration)
      || !Number.isSafeInteger(now + duration) || duration <= 0) throw new Error('Invalid synthetic lease');
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const available = await client.query<Row>(`SELECT o.* FROM synthetic_operations o
        JOIN synthetic_operation_outbox b ON b.operation_id = o.operation_id
          AND b.asset_space_id = o.asset_space_id
        WHERE o.asset_space_id = $1 AND o.status <> 'succeeded'
          AND (o.lease_token IS NULL OR o.lease_expires_at <= $2)
        ORDER BY o.operation_id LIMIT 1 FOR UPDATE OF o SKIP LOCKED`, [space, now]);
      const row = available.rows[0];
      if (!row) { await client.query('COMMIT'); return null; }
      const updated = await client.query<Row>(`UPDATE synthetic_operations
        SET status = CASE WHEN status = 'queued' THEN 'running' ELSE status END,
          version = version + 1, lease_token = $3, lease_expires_at = $4
        WHERE operation_id = $1 AND asset_space_id = $2 AND version = $5
          AND (lease_token IS NULL OR lease_expires_at <= $6) RETURNING *`,
      [row.operation_id, space, token, now + duration, row.version, now]);
      await client.query('COMMIT');
      return updated.rows[0] ? toOperation(updated.rows[0]) : null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  },
  async settle(space: string, id: string, token: string, version: number, now: number,
    sequence: number, outcome: 'waiting_readback' | 'unknown' | 'succeeded', evidence: Evidence | null) {
    if (!Number.isSafeInteger(sequence) || sequence <= 0
      || !Number.isSafeInteger(version) || !Number.isSafeInteger(now)) return null;
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const row = await readRow(client, space, id);
      if (!row || row.lease_token !== token || row.version !== version
        || row.lease_expires_at === null || row.lease_expires_at <= now
        || row.callback_sequence >= sequence || row.status === 'succeeded') {
        await client.query('ROLLBACK');
        return null;
      }
      const status: Status = outcome === 'succeeded'
        ? (matches(row, evidence) ? 'succeeded' : 'reconciling') : outcome;
      const updated = await client.query<Row>(`UPDATE synthetic_operations SET status = $1,
        version = version + 1, callback_sequence = $2,
        lease_token = CASE WHEN $1 = 'succeeded' THEN NULL ELSE lease_token END,
        lease_expires_at = CASE WHEN $1 = 'succeeded' THEN NULL ELSE lease_expires_at END
        WHERE operation_id = $3 AND asset_space_id = $4 AND version = $5
          AND lease_token = $6 AND lease_expires_at > $7 AND callback_sequence < $2
          AND status <> 'succeeded' RETURNING *`,
      [status, sequence, id, space, version, token, now]);
      if (status === 'succeeded' && updated.rows.length) {
        await client.query(`UPDATE synthetic_operation_outbox SET delivery_status = 'delivered'
          WHERE operation_id = $1 AND asset_space_id = $2`, [id, space]);
      }
      await client.query('COMMIT');
      return updated.rows[0] ? toOperation(updated.rows[0]) : null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  },
});

type Store = ReturnType<typeof createDurableFakeOperation>;
type Target = { inspect: (id: string) => Promise<Command | null>;
  submit: (command: Command) => Promise<void>; readback: (id: string) => Promise<Evidence | null> };

export const runFakeOperationStep = async (store: Store, space: string, token: string,
  now: number, duration: number, target: Target) => {
  const claimed = await store.claim(space, token, now, duration);
  if (!claimed) return null;
  const command: Command = { operationId: claimed.operationId, idempotencyKey: claimed.idempotencyKey,
    assetSpaceId: claimed.assetSpaceId, knowledgeId: claimed.knowledgeId,
    assetRevision: claimed.assetRevision, expectedDigest: claimed.expectedDigest, target: claimed.target };
  const sequence = claimed.callbackSequence + 1;
  try {
    const existing = await target.inspect(command.operationId);
    if (existing && (!validCommand(existing) || keys.some((key) =>
      existing[key as keyof Command] !== command[key as keyof Command]))) {
      return store.settle(space, command.operationId, token, claimed.version, now, sequence,
        'succeeded', null);
    }
    if (!existing) await target.submit(command);
    const evidence = await target.readback(command.operationId);
    return store.settle(space, command.operationId, token, claimed.version, now, sequence,
      evidence ? 'succeeded' : 'waiting_readback', evidence);
  } catch {
    return store.settle(space, command.operationId, token, claimed.version, now, sequence,
      'unknown', null);
  }
};
