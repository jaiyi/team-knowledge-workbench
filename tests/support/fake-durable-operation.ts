import { DatabaseSync } from 'node:sqlite';
import type { ProviderOperationStatus } from '../../packages/contracts/src/index.js';

type Metadata = {
  operationId: string;
  idempotencyKey: string;
  fingerprint: string;
  correlationId: string;
  knowledgeId: string;
  assetRevision: number;
};
type Operation = Metadata & {
  status: ProviderOperationStatus;
  version: number;
  leaseToken: string | null;
  leaseExpiresAt: number | null;
};

type Row = {
  operation_id: string;
  idempotency_key: string;
  fingerprint: string;
  correlation_id: string;
  knowledge_id: string;
  asset_revision: number;
  status: ProviderOperationStatus;
  version: number;
  lease_token: string | null;
  lease_expires_at: number | null;
};

const toOperation = (row: Row): Operation => ({
  operationId: row.operation_id, idempotencyKey: row.idempotency_key,
  fingerprint: row.fingerprint, correlationId: row.correlation_id,
  knowledgeId: row.knowledge_id, assetRevision: row.asset_revision,
  status: row.status, version: row.version, leaseToken: row.lease_token,
  leaseExpiresAt: row.lease_expires_at,
});

export const createFakeDurableOperation = (path: string) => {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS fake_operations (
    operation_id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    fingerprint TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    knowledge_id TEXT NOT NULL,
    asset_revision INTEGER NOT NULL,
    status TEXT NOT NULL,
    version INTEGER NOT NULL,
    lease_token TEXT,
    lease_expires_at INTEGER
  )`);
  const read = (operationId: string): Operation | null => {
    const row = db.prepare('SELECT * FROM fake_operations WHERE operation_id = ?').get(operationId) as Row | undefined;
    return row ? toOperation(row) : null;
  };
  const advance = (
    operationId: string, token: string, version: number, now: number,
    status: ProviderOperationStatus, from: readonly ProviderOperationStatus[],
  ): Operation | null => {
    const current = read(operationId);
    if (!current || !from.includes(current.status)) return null;
    const result = db.prepare(`UPDATE fake_operations SET status = ?, version = version + 1
      WHERE operation_id = ? AND version = ? AND lease_token = ? AND lease_expires_at > ?`)
      .run(status, operationId, version, token, now);
    return result.changes === 1 ? read(operationId) : null;
  };
  return {
    enqueue: (metadata: Metadata): Operation => {
      db.prepare(`INSERT OR IGNORE INTO fake_operations
        (operation_id, idempotency_key, fingerprint, correlation_id, knowledge_id, asset_revision, status, version)
        VALUES (?, ?, ?, ?, ?, ?, 'queued', 0)`)
        .run(metadata.operationId, metadata.idempotencyKey, metadata.fingerprint,
          metadata.correlationId, metadata.knowledgeId, metadata.assetRevision);
      const current = read(metadata.operationId);
      if (!current || Object.entries(metadata).some(([key, value]) => current[key as keyof Metadata] !== value)) {
        throw new Error('Conflicting fake durable operation');
      }
      return current;
    },
    claim: (operationId: string, token: string, now: number, duration: number): Operation | null => {
      if (duration <= 0) throw new Error('Lease duration must be positive');
      const current = read(operationId);
      if (!current || ['succeeded', 'failed'].includes(current.status)) return null;
      const result = db.prepare(`UPDATE fake_operations
        SET status = CASE WHEN status = 'queued' THEN 'running' ELSE status END,
          lease_token = ?, lease_expires_at = ?, version = version + 1
        WHERE operation_id = ? AND version = ? AND (lease_token IS NULL OR lease_expires_at <= ?)
          AND status IN ('queued', 'running', 'waiting_readback', 'unknown', 'reconciling')`)
        .run(token, now + duration, operationId, current.version, now);
      return result.changes === 1 ? read(operationId) : null;
    },
    markWaiting: (operationId: string, token: string, version: number, now: number) =>
      advance(operationId, token, version, now, 'waiting_readback', ['running']),
    markUnknown: (operationId: string, token: string, version: number, now: number) =>
      advance(operationId, token, version, now, 'unknown', ['running', 'waiting_readback']),
    markReconciled: (
      operationId: string, token: string, version: number, now: number,
      status: 'succeeded' | 'reconciling',
    ) => advance(operationId, token, version, now, status, ['unknown', 'reconciling', 'waiting_readback']),
    read,
    close: () => db.close(),
  };
};
