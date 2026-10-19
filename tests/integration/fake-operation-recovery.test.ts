import { createHash } from 'node:crypto';
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
