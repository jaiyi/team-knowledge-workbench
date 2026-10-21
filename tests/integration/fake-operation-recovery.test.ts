import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { transitionKnowledge } from '../../packages/domain/src/index.js';
import type { KnowledgeAsset } from '../../packages/contracts/src/index.js';
import { createFakeDurableOperation } from '../support/fake-durable-operation.js';
import { createFakeWeKnora } from '../support/fake-weknora.js';

const digest = 'sha256:' + 'a'.repeat(64);
const commit = '0123456789abcdef0123456789abcdef01234567';
const asset: KnowledgeAsset = {
  knowledge_id: 'knowledge.fixture', version: '1.0.0', status: 'publishing',
  team_id: 'team-a', asset_space_id: 'space-a', asset_repository_id: 'repo-a',
  repo_path: 'knowledge/quality/fixture/', taxonomy_version: 'v1',
  source_commit: commit, expected_acl_digest: digest, claims_confirmed: true,
  owner_id: 'owner-a', steward_id: 'steward-a', evidence_level: 'E1', sensitivity: 'internal',
  sources: [{ source_ref_id: 'src_1', kind: 'document', locator: 'fixture://source', content_digest: digest }],
  content: { conclusion: 'Fixture only', claims: [{ claim_id: 'claim_1', kind: 'rule', statement: 'Fixture rule', source_refs: ['src_1'], confirmation: 'confirmed' }], applies_to: [], not_applies_to: [], inferences: [], unknowns: [] },
  asset_revision: 1, state_version: 1, created_at: '2026-10-15T09:00:00Z', updated_at: '2026-10-15T09:00:00Z',
};
const request = { idempotencyKey: 'key-1', operationId: 'op-1', correlationId: 'correlation-1', asset };
const metadata = {
  operationId: request.operationId, idempotencyKey: request.idempotencyKey,
  fingerprint: `sha256:${createHash('sha256').update(JSON.stringify(request)).digest('hex')}`,
  correlationId: request.correlationId,
  knowledgeId: asset.knowledge_id, assetRevision: asset.asset_revision,
};
const readback = {
  operation_id: 'op-1', knowledge_id: asset.knowledge_id, version: asset.version,
  asset_revision: asset.asset_revision, asset_space_id: asset.asset_space_id,
  repo_path: asset.repo_path, source_commit: commit, acl_digest: digest,
};
const retrieval = {
  operation_id: 'op-1', knowledge_id: asset.knowledge_id, version: asset.version,
  asset_revision: asset.asset_revision,
};
const folders: string[] = [];
const databasePath = () => {
  const folder = mkdtempSync(join(tmpdir(), 'fake-operation-'));
  folders.push(folder);
  return join(folder, 'operations.sqlite');
};
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('isolated durable fake operation recovery', () => {
  it('commits fake event and operation together across a process boundary', () => {
    const path = databasePath();
    const first = spawnSync(process.execPath, [
      '--import', 'tsx', '--input-type=module', '-e', `
        import { createFakeDurableOperation } from './tests/support/fake-durable-operation.ts';
        const store = createFakeDurableOperation(process.argv[1]);
        store.recordEvent('event-1', JSON.parse(process.argv[2]));
        process.exit(0);
      `, path, JSON.stringify(metadata),
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(first.status).toBe(0);

    const recovered = createFakeDurableOperation(path);
    expect(recovered.readEvent('event-1')).toBe('op-1');
    expect(recovered.read('op-1')).toMatchObject({ status: 'queued', ...metadata });
    recovered.close();
  });

  it('reopens a committed synthetic ingest request in a new process for fake recovery', () => {
    const path = databasePath();
    const first = spawnSync(process.execPath, [
      '--import', 'tsx', '--input-type=module', '-e', `
        import { createFakeDurableOperation } from './tests/support/fake-durable-operation.ts';
        const store = createFakeDurableOperation(process.argv[1]);
        store.recordEvent('event-1', JSON.parse(process.argv[2]), JSON.parse(process.argv[3]));
        process.exit(0);
      `, path, JSON.stringify(metadata), JSON.stringify(request),
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(first.status).toBe(0);

    const recovered = createFakeDurableOperation(path);
    expect(recovered.readEvent('event-1')).toBe('op-1');
    expect(recovered.readRequest('op-1')).toEqual(request);
    const lease = recovered.claim('op-1', 'lease-b', 100, 10)!;
    const provider = createFakeWeKnora();
    const persisted = recovered.readRequest(lease.operationId)!;
    expect(provider.inspect(lease.operationId)).toBeNull();
    expect(provider.ingest(persisted).status).toBe('waiting_readback');
    expect(recovered.markWaiting(lease.operationId, 'lease-b', lease.version, 101)?.status)
      .toBe('waiting_readback');
    expect(provider.operationCount()).toBe(1);
    recovered.close();
  });

  it.each(['verified', 'mismatch'] as const)(
    'recovers a claimed fake request after process exit with %s read-back', (outcome) => {
      const path = databasePath();
      const first = spawnSync(process.execPath, [
        '--import', 'tsx', '--input-type=module', '-e', `
          import { createFakeDurableOperation } from './tests/support/fake-durable-operation.ts';
          const store = createFakeDurableOperation(process.argv[1]);
          store.recordEvent('event-1', JSON.parse(process.argv[2]), JSON.parse(process.argv[3]));
          if (!store.claim('op-1', 'lease-a', 100, 10)) process.exit(1);
          process.exit(0);
        `, path, JSON.stringify(metadata), JSON.stringify(request),
      ], { cwd: process.cwd(), encoding: 'utf8' });
      expect(first.status).toBe(0);

      const recovered = createFakeDurableOperation(path);
      expect(recovered.readEvent('event-1')).toBe('op-1');
      expect(recovered.read('op-1')).toMatchObject({ status: 'running', version: 1 });
      expect(recovered.claim('op-1', 'lease-b', 109, 10)).toBeNull();
      const lease = recovered.claim('op-1', 'lease-b', 110, 10)!;
      expect(lease).toMatchObject({ status: 'running', version: 2 });
      expect(recovered.markWaiting('op-1', 'lease-a', 1, 111)).toBeNull();

      const provider = createFakeWeKnora();
      expect(provider.inspect(lease.operationId)).toBeNull();
      expect(provider.ingest(recovered.readRequest(lease.operationId)!).status).toBe('waiting_readback');
      const waiting = recovered.markWaiting(lease.operationId, 'lease-b', lease.version, 111)!;
      const observed = outcome === 'verified' ? readback : { ...readback, asset_space_id: 'space-other' };
      const status = outcome === 'verified' ? 'succeeded' : 'reconciling';
      expect(provider.complete(lease.operationId, observed, retrieval).status).toBe(status);
      expect(provider.readEvidence(lease.operationId).map((item) => item.kind))
        .toEqual(outcome === 'verified' ? ['weknora_readback', 'retrieval_smoke'] : []);
      expect(recovered.markReconciled(lease.operationId, 'lease-b', waiting.version, 112, status)?.status)
        .toBe(status);
      expect(provider.operationCount()).toBe(1);
      recovered.close();

      const reopened = createFakeDurableOperation(path);
      expect(reopened.read('op-1')?.status).toBe(status);
      expect(reopened.readRequest('op-1')).toEqual(request);
      if (outcome === 'verified') expect(reopened.claim('op-1', 'lease-c', 120, 10)).toBeNull();
      reopened.close();
    },
  );

  it.each(['verified', 'mismatch'] as const)(
    'inspects an accepted fake ingest before retrying after process exit with %s read-back', (outcome) => {
      const path = databasePath();
      const provider = createFakeWeKnora();
      const first = createFakeDurableOperation(path);
      first.recordEvent('event-1', metadata, request);
      first.close();

      const claimed = spawnSync(process.execPath, [
        '--import', 'tsx', '--input-type=module', '-e', `
          import { createFakeDurableOperation } from './tests/support/fake-durable-operation.ts';
          const store = createFakeDurableOperation(process.argv[1]);
          if (!store.claim('op-1', 'lease-a', 100, 10)) process.exit(1);
          process.exit(0);
        `, path,
      ], { cwd: process.cwd(), encoding: 'utf8' });
      expect(claimed.status).toBe(0);

      // The in-memory fake represents an already-accepted external operation, not a restarted provider.
      expect(provider.ingest(request).status).toBe('waiting_readback');
      const recovered = createFakeDurableOperation(path);
      expect(recovered.readRequest('op-1')).toEqual(request);
      const lease = recovered.claim('op-1', 'lease-b', 110, 10)!;
      expect(lease).toMatchObject({ status: 'running', version: 2 });
      expect(recovered.markWaiting('op-1', 'lease-a', 1, 111)).toBeNull();
      expect(provider.inspect(lease.operationId)?.status).toBe('waiting_readback');
      const waiting = recovered.markWaiting(lease.operationId, 'lease-b', lease.version, 111)!;
      expect(provider.operationCount()).toBe(1);

      provider.timeout(lease.operationId);
      const unknown = recovered.markUnknown(lease.operationId, 'lease-b', waiting.version, 112)!;
      expect(unknown.status).toBe('unknown');
      expect(provider.inspect(lease.operationId)?.status).toBe('unknown');
      expect(provider.readEvidence(lease.operationId).some((item) => item.kind === 'weknora_readback'))
        .toBe(false);
      const observed = outcome === 'verified' ? readback : { ...readback, asset_space_id: 'space-other' };
      const status = outcome === 'verified' ? 'succeeded' : 'reconciling';
      expect(provider.reconcile(lease.operationId, observed, retrieval).status).toBe(status);
      expect(provider.readEvidence(lease.operationId).map((item) => item.kind))
        .toEqual(outcome === 'verified' ? ['weknora_readback', 'retrieval_smoke'] : []);
      expect(recovered.markReconciled(lease.operationId, 'lease-b', unknown.version, 113, status)?.status)
        .toBe(status);
      expect(provider.operationCount()).toBe(1);
      recovered.close();

      const reopened = createFakeDurableOperation(path);
      expect(reopened.read('op-1')?.status).toBe(status);
      reopened.close();
    },
  );

  it('replays the same fake event without resetting its lease or re-sending ingest', () => {
    const path = databasePath();
    const provider = createFakeWeKnora();
    const first = createFakeDurableOperation(path);
    first.recordEvent('event-1', metadata, request);
    const lease = first.claim('op-1', 'lease-a', 100, 10)!;
    provider.ingest(first.readRequest('op-1')!);
    first.close();

    const recovered = createFakeDurableOperation(path);
    expect(recovered.recordEvent('event-1', metadata, request)).toMatchObject({
      status: 'running', version: lease.version, leaseToken: 'lease-a',
    });
    expect(recovered.readEvent('event-1')).toBe('op-1');
    expect(recovered.claim('op-1', 'lease-b', 109, 10)).toBeNull();
    expect(provider.inspect('op-1')?.status).toBe('waiting_readback');
    expect(provider.operationCount()).toBe(1);
    expect(() => recovered.recordEvent('event-1', metadata)).toThrow('Conflicting fake durable request');
    expect(recovered.readRequest('op-1')).toEqual(request);
    recovered.close();
  });

  it('rejects a persisted synthetic request whose content no longer matches its operation fingerprint', () => {
    const path = databasePath();
    const store = createFakeDurableOperation(path);
    store.recordEvent('event-1', metadata, request);
    store.close();

    const db = new DatabaseSync(path);
    db.prepare('UPDATE fake_operations SET request_json = ? WHERE operation_id = ?')
      .run(JSON.stringify({ ...request, correlationId: 'correlation-other' }), 'op-1');
    db.close();

    const recovered = createFakeDurableOperation(path);
    expect(() => recovered.readRequest('op-1')).toThrow('Conflicting fake durable request');
    recovered.close();
  });

  it('rejects a mismatched synthetic request before recording an event or operation', () => {
    const path = databasePath();
    const store = createFakeDurableOperation(path);
    expect(() => store.recordEvent('event-1', metadata, {
      ...request, asset: { ...asset, asset_revision: 2 },
    })).toThrow('Conflicting fake durable request');
    expect(store.readEvent('event-1')).toBeNull();
    expect(store.read('op-1')).toBeNull();
    expect(store.readRequest('op-1')).toBeNull();
    store.close();
  });

  it('does not retrofit a synthetic request onto an existing metadata-only operation', () => {
    const path = databasePath();
    const store = createFakeDurableOperation(path);
    store.enqueue(metadata);
    expect(() => store.recordEvent('event-1', metadata, request))
      .toThrow('Conflicting fake durable request');
    expect(store.readEvent('event-1')).toBeNull();
    expect(store.readRequest('op-1')).toBeNull();
    expect(store.read('op-1')).toMatchObject(metadata);
    store.close();
  });

  it('does not retain either fake record when a process exits before commit', () => {
    const path = databasePath();
    const first = spawnSync(process.execPath, [
      '--import', 'tsx', '--input-type=module', '-e', `
        import { DatabaseSync } from 'node:sqlite';
        import { createFakeDurableOperation } from './tests/support/fake-durable-operation.ts';
        createFakeDurableOperation(process.argv[1]).close();
        const db = new DatabaseSync(process.argv[1]);
        const metadata = JSON.parse(process.argv[2]);
        db.exec('BEGIN');
        db.prepare(\`INSERT INTO fake_operations
          (operation_id, idempotency_key, fingerprint, request_json, correlation_id, knowledge_id, asset_revision, status, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0)\`)
          .run(metadata.operationId, metadata.idempotencyKey, metadata.fingerprint, process.argv[3],
            metadata.correlationId, metadata.knowledgeId, metadata.assetRevision);
        db.prepare('INSERT INTO fake_events (event_id, operation_id) VALUES (?, ?)')
          .run('event-1', metadata.operationId);
        process.exit(0);
      `, path, JSON.stringify(metadata), JSON.stringify(request),
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(first.status).toBe(0);

    const recovered = createFakeDurableOperation(path);
    expect(recovered.readEvent('event-1')).toBeNull();
    expect(recovered.read('op-1')).toBeNull();
    expect(recovered.readRequest('op-1')).toBeNull();
    recovered.close();
  });

  it('rejects a conflicting operation identity without recording a new fake event', () => {
    const path = databasePath();
    const store = createFakeDurableOperation(path);
    store.recordEvent('event-1', metadata);
    expect(() => store.recordEvent('event-2', { ...metadata, fingerprint: 'different' })).toThrow();
    expect(store.readEvent('event-2')).toBeNull();
    expect(store.readEvent('event-1')).toBe('op-1');
    expect(store.read('op-1')).toMatchObject(metadata);
    store.close();

    const recovered = createFakeDurableOperation(path);
    expect(recovered.readEvent('event-2')).toBeNull();
    expect(recovered.readEvent('event-1')).toBe('op-1');
    expect(recovered.read('op-1')).toMatchObject(metadata);
    recovered.close();
  });

  it('rolls back a new fake operation when the event ID already exists', () => {
    const path = databasePath();
    const store = createFakeDurableOperation(path);
    store.recordEvent('event-1', metadata, request);
    const otherRequest = { ...request, operationId: 'op-2', idempotencyKey: 'key-2' };
    const other = {
      ...metadata, operationId: 'op-2', idempotencyKey: 'key-2',
      fingerprint: `sha256:${createHash('sha256').update(JSON.stringify(otherRequest)).digest('hex')}`,
    };
    expect(() => store.recordEvent('event-1', other, otherRequest)).toThrow();
    expect(store.read('op-2')).toBeNull();
    expect(store.readRequest('op-2')).toBeNull();
    expect(store.readEvent('event-1')).toBe('op-1');
    store.close();

    const recovered = createFakeDurableOperation(path);
    expect(recovered.read('op-2')).toBeNull();
    expect(recovered.readRequest('op-2')).toBeNull();
    expect(recovered.readEvent('event-1')).toBe('op-1');
    recovered.close();
  });

  it('recovers a claimed lease after a separate worker process exits without closing its store', () => {
    const path = databasePath();
    const first = spawnSync(process.execPath, [
      '--import', 'tsx', '--input-type=module', '-e', `
        import { createFakeDurableOperation } from './tests/support/fake-durable-operation.ts';
        const store = createFakeDurableOperation(process.argv[1]);
        store.enqueue(JSON.parse(process.argv[2]));
        if (!store.claim('op-1', 'lease-a', 100, 10)) process.exit(1);
        process.exit(0);
      `, path, JSON.stringify(metadata),
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect(first.status).toBe(0);

    const recovered = createFakeDurableOperation(path);
    expect(recovered.read('op-1')).toMatchObject({ status: 'running', version: 1 });
    expect(recovered.claim('op-1', 'lease-b', 109, 10)).toBeNull();
    const lease = recovered.claim('op-1', 'lease-b', 110, 10);
    expect(lease).toMatchObject({ status: 'running', version: 2 });
    expect(recovered.markWaiting('op-1', 'lease-a', 1, 111)).toBeNull();
    expect(recovered.markWaiting('op-1', 'lease-b', lease!.version, 111))
      .toMatchObject({ status: 'waiting_readback', version: 3 });
    recovered.close();
  });

  it('reopens a queued operation and rejects conflicting idempotency or operation identity', () => {
    const path = databasePath();
    const first = createFakeDurableOperation(path);
    expect(first.enqueue(metadata)).toMatchObject({ status: 'queued', version: 0 });
    first.close();
    const recovered = createFakeDurableOperation(path);
    expect(recovered.read('op-1')).toMatchObject(metadata);
    expect(recovered.enqueue(metadata)).toEqual(recovered.read('op-1'));
    expect(() => recovered.enqueue({ ...metadata, fingerprint: 'different' })).toThrow();
    expect(() => recovered.enqueue({ ...metadata, operationId: 'op-other' })).toThrow();
    expect(() => recovered.enqueue({ ...metadata, idempotencyKey: 'key-other' })).toThrow();
    recovered.close();
  });

  it('allows one claimant and fences expired owners and late callbacks using lease and version', () => {
    const path = databasePath();
    const first = createFakeDurableOperation(path);
    const second = createFakeDurableOperation(path);
    first.enqueue(metadata);
    const claimed = first.claim('op-1', 'lease-a', 100, 10);
    expect(claimed).toMatchObject({ status: 'running', version: 1 });
    expect(second.claim('op-1', 'lease-b', 100, 10)).toBeNull();
    expect(first.markWaiting('op-1', 'lease-a', 0, 101)).toBeNull();
    expect(second.claim('op-1', 'lease-b', 110, 10)).toMatchObject({ version: 2 });
    expect(first.markWaiting('op-1', 'lease-a', 1, 110)).toBeNull();
    expect(first.markReconciled('op-1', 'lease-a', 1, 110, 'succeeded')).toBeNull();
    expect(second.markWaiting('op-1', 'lease-b', 2, 111)).toMatchObject({ status: 'waiting_readback', version: 3 });
    first.close();
    second.close();
  });

  it('recovers a crash before sending by using the original key and only one fake ingest', () => {
    const path = databasePath();
    const provider = createFakeWeKnora();
    const first = createFakeDurableOperation(path);
    first.enqueue(metadata);
    first.close();
    const recovered = createFakeDurableOperation(path);
    const lease = recovered.claim('op-1', 'lease-b', 100, 10);
    expect(lease?.status).toBe('running');
    expect(provider.inspect('op-1')).toBeNull();
    expect(provider.ingest(request).status).toBe('waiting_readback');
    expect(recovered.markWaiting('op-1', 'lease-b', lease!.version, 101)?.status).toBe('waiting_readback');
    expect(provider.operationCount()).toBe(1);
    recovered.close();
  });

  it('queries an accepted provider operation before retry after the waiting state was not saved', () => {
    const path = databasePath();
    const provider = createFakeWeKnora();
    const first = createFakeDurableOperation(path);
    first.enqueue(metadata);
    const initial = first.claim('op-1', 'lease-a', 100, 10);
    expect(initial).not.toBeNull();
    provider.ingest(request);
    first.close();
    const recovered = createFakeDurableOperation(path);
    const lease = recovered.claim('op-1', 'lease-b', 110, 10);
    expect(lease?.status).toBe('running');
    const observed = provider.inspect('op-1');
    expect(observed?.status).toBe('waiting_readback');
    if (!observed) provider.ingest(request);
    expect(recovered.markWaiting('op-1', 'lease-b', lease!.version, 111)?.status).toBe('waiting_readback');
    expect(provider.operationCount()).toBe(1);
    recovered.close();
  });

  it.each(['completed', 'pending', 'mismatch'] as const)('keeps timed-out %s results subject to final read-back', (outcome) => {
    const path = databasePath();
    const provider = createFakeWeKnora();
    const first = createFakeDurableOperation(path);
    first.enqueue(metadata);
    const sent = first.claim('op-1', 'lease-a', 100, 10)!;
    provider.ingest(request);
    const waiting = first.markWaiting('op-1', 'lease-a', sent.version, 101)!;
    provider.timeout('op-1');
    expect(first.markUnknown('op-1', 'lease-a', waiting.version, 102)?.status).toBe('unknown');
    if (outcome === 'completed') provider.reconcile('op-1', readback, retrieval);
    if (outcome === 'mismatch') provider.reconcile('op-1', { ...readback, asset_space_id: 'space-other' }, retrieval);
    first.close();

    const recovered = createFakeDurableOperation(path);
    const lease = recovered.claim('op-1', 'lease-b', 110, 10)!;
    expect(lease.status).toBe('unknown');
    const observed = provider.inspect('op-1');
    expect(observed).not.toBeNull();
    const evidence = provider.readEvidence('op-1');
    if (outcome === 'completed') {
      expect(observed?.status).toBe('succeeded');
      expect(evidence.map((item) => item.kind)).toEqual(['weknora_readback', 'retrieval_smoke']);
      expect(recovered.markReconciled('op-1', 'lease-b', lease.version, 111, 'succeeded')?.status).toBe('succeeded');
      const command = {
        transition_id: 'transition-publish', idempotency_key: request.idempotencyKey,
        correlation_id: request.correlationId, asset_space_id: asset.asset_space_id,
        to: 'published' as const, actor: { actor_id: 'worker-1', actor_type: 'service' as const },
        reason: 'fake read-back', expected_state_version: asset.state_version,
        expected_asset_revision: asset.asset_revision, evidence, occurred_at: '2026-10-15T09:20:00Z',
      };
      expect(transitionKnowledge(asset, command).ok).toBe(true);
      const unknown = transitionKnowledge(asset, { ...command, to: 'index_unknown' as const, evidence: [{ kind: 'provider_result' as const, reference: 'fake/unknown', operation_id: 'op-1', status: 'unknown' as const, knowledge_id: asset.knowledge_id, asset_revision: asset.asset_revision }] });
      expect(unknown.ok).toBe(true);
      if (unknown.ok) expect(transitionKnowledge(unknown.knowledge, command).ok).toBe(false);
    } else if (outcome === 'pending') {
      expect(observed?.status).toBe('unknown');
      expect(evidence.some((item) => item.kind === 'weknora_readback')).toBe(false);
      expect(recovered.read('op-1')?.status).toBe('unknown');
    } else {
      expect(observed?.status).toBe('reconciling');
      expect(evidence.some((item) => item.kind === 'weknora_readback')).toBe(false);
      expect(recovered.markReconciled('op-1', 'lease-b', lease.version, 111, 'reconciling')?.status).toBe('reconciling');
      expect(recovered.read('op-1')?.status).not.toBe('succeeded');
    }
    expect(provider.operationCount()).toBe(1);
    recovered.close();
  });
});
