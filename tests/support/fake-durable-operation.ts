import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { ProviderOperationStatus } from '../../packages/contracts/src/index.js';
import type { Request } from './fake-weknora.js';

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
    request_json TEXT,
    correlation_id TEXT NOT NULL,
    knowledge_id TEXT NOT NULL,
    asset_revision INTEGER NOT NULL,
    status TEXT NOT NULL,
    version INTEGER NOT NULL,
    lease_token TEXT,
    lease_expires_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS fake_events (
    event_id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL UNIQUE
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
  const readRequest = (operationId: string): Request | null => {
    const row = db.prepare(`SELECT request_json, idempotency_key, fingerprint,
      correlation_id, knowledge_id, asset_revision FROM fake_operations WHERE operation_id = ?`)
      .get(operationId) as {
        request_json: string | null; idempotency_key: string; fingerprint: string;
        correlation_id: string; knowledge_id: string; asset_revision: number;
      } | undefined;
    if (!row?.request_json) return null;
    const request = JSON.parse(row.request_json) as Request;
    if (request.operationId !== operationId || request.idempotencyKey !== row.idempotency_key
      || request.correlationId !== row.correlation_id || request.asset.knowledge_id !== row.knowledge_id
      || request.asset.asset_revision !== row.asset_revision
      || `sha256:${createHash('sha256').update(row.request_json).digest('hex')}` !== row.fingerprint) {
      throw new Error('Conflicting fake durable request');
    }
    return request;
  };
  const enqueue = (metadata: Metadata, serialized: string | null = null): Operation => {
    db.prepare(`INSERT OR IGNORE INTO fake_operations
      (operation_id, idempotency_key, fingerprint, request_json, correlation_id, knowledge_id, asset_revision, status, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0)`)
      .run(metadata.operationId, metadata.idempotencyKey, metadata.fingerprint, serialized,
        metadata.correlationId, metadata.knowledgeId, metadata.assetRevision);
    const current = read(metadata.operationId);
    if (!current || Object.entries(metadata).some(([key, value]) => current[key as keyof Metadata] !== value)) {
      throw new Error('Conflicting fake durable operation');
    }
    if (serialized) {
      const stored = db.prepare('SELECT request_json FROM fake_operations WHERE operation_id = ?')
        .get(metadata.operationId) as { request_json: string | null };
      if (stored.request_json !== serialized) throw new Error('Conflicting fake durable request');
    }
    return current;
  };
  return {
    enqueue,
    recordEvent: (eventId: string, metadata: Metadata, request?: Request): Operation => {
      const serialized = request ? JSON.stringify(request) : null;
      if (request && (request.operationId !== metadata.operationId
        || request.idempotencyKey !== metadata.idempotencyKey
        || request.correlationId !== metadata.correlationId
        || request.asset.knowledge_id !== metadata.knowledgeId
        || request.asset.asset_revision !== metadata.assetRevision
        || `sha256:${createHash('sha256').update(serialized!).digest('hex')}` !== metadata.fingerprint)) {
        throw new Error('Conflicting fake durable request');
      }
      db.exec('BEGIN');
      try {
        const operation = enqueue(metadata, serialized);
        const existing = db.prepare('SELECT event_id FROM fake_events WHERE event_id = ? AND operation_id = ?')
          .get(eventId, metadata.operationId);
        if (existing) {
          const row = db.prepare('SELECT request_json FROM fake_operations WHERE operation_id = ?')
            .get(metadata.operationId) as { request_json: string | null };
          if (row.request_json !== serialized) throw new Error('Conflicting fake durable request');
        } else {
          db.prepare('INSERT INTO fake_events (event_id, operation_id) VALUES (?, ?)')
            .run(eventId, metadata.operationId);
        }
        db.exec('COMMIT');
        return operation;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    readRequest,
    readEvent: (eventId: string): string | null => {
      const row = db.prepare('SELECT operation_id FROM fake_events WHERE event_id = ?')
        .get(eventId) as { operation_id: string } | undefined;
      return row?.operation_id ?? null;
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
