import { describe, expect, it } from 'vitest';
import { transitionKnowledge } from '../../packages/domain/src/index.js';
import type { KnowledgeAsset } from '../../packages/contracts/src/index.js';
import { createFakeWeKnora } from '../support/fake-weknora.js';

const digest = 'sha256:' + 'a'.repeat(64);
const commit = '0123456789abcdef0123456789abcdef01234567';
const makePublishing = (): KnowledgeAsset => ({
  knowledge_id: 'knowledge.quality.assembly-policy', version: '1.0.0', status: 'publishing',
  team_id: 'team-a', asset_space_id: 'space-a', asset_repository_id: 'repo-a',
  repo_path: 'knowledge/quality/assembly-policy/torque-review/', taxonomy_version: 'v1',
  source_commit: commit, expected_acl_digest: digest, claims_confirmed: true,
  owner_id: 'owner-a', steward_id: 'steward-a', evidence_level: 'E1', sensitivity: 'internal',
  sources: [{ source_ref_id: 'src_1', kind: 'document', locator: 'meeting://fixture', content_digest: digest }],
  content: { conclusion: 'Fixture conclusion', claims: [{ claim_id: 'claim_1', kind: 'rule', statement: 'Fixture rule', source_refs: ['src_1'], confirmation: 'confirmed' }], applies_to: [], not_applies_to: [], inferences: [], unknowns: [] },
  asset_revision: 1, state_version: 1, created_at: '2026-10-15T09:00:00Z', updated_at: '2026-10-15T09:00:00Z',
});

const asset = makePublishing();
const request = { idempotencyKey: 'key-1', operationId: 'op-1', correlationId: 'correlation-1', asset };
const readback = {
  operation_id: 'op-1', knowledge_id: asset.knowledge_id, version: asset.version,
  asset_revision: asset.asset_revision, asset_space_id: asset.asset_space_id,
  repo_path: asset.repo_path, source_commit: commit, acl_digest: digest,
};
const retrieval = {
  operation_id: 'op-1', knowledge_id: asset.knowledge_id, version: asset.version,
  asset_revision: asset.asset_revision,
};
const command = (to: 'published' | 'index_failed' | 'index_unknown', evidence: ReturnType<ReturnType<typeof createFakeWeKnora>['readEvidence']>) => ({
  transition_id: `transition-${to}`, idempotency_key: request.idempotencyKey,
  correlation_id: request.correlationId, asset_space_id: asset.asset_space_id,
  to, actor: { actor_id: 'worker-1', actor_type: 'service' as const },
  reason: 'fake Provider result', expected_state_version: asset.state_version,
  expected_asset_revision: asset.asset_revision, evidence,
  occurred_at: '2026-10-15T09:20:00Z',
});

describe('fake WeKnora operation/read-back (local fixtures only)', () => {
  it('deduplicates matching requests without turning accepted operations into success', () => {
    const weknora = createFakeWeKnora();
    expect(weknora.ingest(request)).toEqual({ operation_id: 'op-1', status: 'waiting_readback' });
    expect(weknora.ingest({ ...request })).toEqual({ operation_id: 'op-1', status: 'waiting_readback' });
    expect(() => weknora.ingest({ ...request, asset: { ...asset, source_commit: 'f'.repeat(40) } })).toThrow();
    expect(weknora.operationCount()).toBe(1);
    expect(weknora.readEvidence('op-1')).toEqual([]);
    expect(() => weknora.ingest({ ...request, asset: { ...asset, asset_revision: 2 } })).toThrow();
    expect(() => weknora.ingest({ ...request, operationId: 'op-2' })).toThrow();
    expect(() => weknora.ingest({ ...request, idempotencyKey: 'key-2' })).toThrow();
    expect(weknora.operationCount()).toBe(1);
  });

  it('rejects a replay that changes its correlation while keeping the same operation', () => {
    const weknora = createFakeWeKnora();
    weknora.ingest(request);
    expect(() => weknora.ingest({ ...request, correlationId: 'correlation-other' })).toThrow();
    expect(weknora.operationCount()).toBe(1);
  });

  it('only produces publish evidence for a matching final read-back and retrieval', () => {
    const weknora = createFakeWeKnora();
    weknora.ingest(request);
    expect(weknora.complete('op-1', readback, { ...retrieval, operation_id: 'op-other' }))
      .toEqual({ operation_id: 'op-1', status: 'reconciling' });
    expect(weknora.readEvidence('op-1')).toEqual([]);
    expect(() => weknora.complete('op-1', readback, retrieval)).toThrow();
    expect(weknora.reconcile('op-1', readback, retrieval)).toEqual({ operation_id: 'op-1', status: 'succeeded' });
    const evidence = weknora.readEvidence('op-1');
    expect(evidence.map((item) => item.kind)).toEqual(['weknora_readback', 'retrieval_smoke']);
    const result = transitionKnowledge(asset, command('published', evidence));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.knowledge.status).toBe('published');
    expect(weknora.complete('op-1', readback, retrieval)).toEqual({ operation_id: 'op-1', status: 'succeeded' });
    expect(weknora.operationCount()).toBe(1);
  });

  it.each([
    { asset_space_id: 'space-b' }, { version: '2.0.0' },
    { source_commit: 'f'.repeat(40) }, { acl_digest: 'sha256:' + 'b'.repeat(64) },
    { repo_path: 'knowledge/quality/assembly-policy/other/' },
    { asset_revision: 2 }, { knowledge_id: 'knowledge.other' },
  ])('does not publish mismatched read-back %j', (mismatch) => {
    const weknora = createFakeWeKnora();
    weknora.ingest(request);
    expect(weknora.complete('op-1', { ...readback, ...mismatch }, retrieval))
      .toEqual({ operation_id: 'op-1', status: 'reconciling' });
    expect(weknora.readEvidence('op-1')).toEqual([]);
    expect(transitionKnowledge(asset, command('published', weknora.readEvidence('op-1'))).ok).toBe(false);
  });

  it.each([
    { knowledge_id: 'knowledge.other' }, { version: '2.0.0' }, { asset_revision: 2 },
  ])('does not publish mismatched retrieval %j', (mismatch) => {
    const weknora = createFakeWeKnora();
    weknora.ingest(request);
    expect(weknora.complete('op-1', readback, { ...retrieval, ...mismatch }))
      .toEqual({ operation_id: 'op-1', status: 'reconciling' });
    expect(weknora.readEvidence('op-1')).toEqual([]);
    expect(transitionKnowledge(asset, command('published', weknora.readEvidence('op-1'))).ok).toBe(false);
  });

  it('rejects changed evidence after success and does not expose mutable read-back state', () => {
    const weknora = createFakeWeKnora();
    weknora.ingest(request);
    weknora.complete('op-1', readback, retrieval);
    const evidence = weknora.readEvidence('op-1');
    if (evidence[0]?.kind !== 'weknora_readback') throw new Error('Expected fake read-back');
    (evidence[0] as { asset_space_id: string }).asset_space_id = 'space-b';
    expect(weknora.readEvidence('op-1')[0]).toMatchObject({ asset_space_id: 'space-a' });
    expect(() => weknora.complete('op-1', { ...readback, acl_digest: 'sha256:' + 'b'.repeat(64) }, retrieval)).toThrow();
    expect(weknora.readEvidence('op-1')[0]).toMatchObject({ asset_space_id: 'space-a', acl_digest: digest });
  });

  it('does not let a later mutation of the submitted asset change the expected read-back', () => {
    const mutableAsset = { ...asset };
    const weknora = createFakeWeKnora();
    weknora.ingest({ ...request, asset: mutableAsset });
    mutableAsset.asset_space_id = 'space-b';
    expect(weknora.complete('op-1', { ...readback, asset_space_id: 'space-b' }, retrieval))
      .toEqual({ operation_id: 'op-1', status: 'reconciling' });
    expect(weknora.readEvidence('op-1')).toEqual([]);
  });

  it('keeps mismatched late results in reconciliation without publish evidence', () => {
    const weknora = createFakeWeKnora();
    weknora.ingest(request);
    expect(weknora.timeout('op-1').status).toBe('unknown');
    expect(() => weknora.complete('op-1', readback, retrieval)).toThrow();
    expect(weknora.reconcile('op-1', readback, { ...retrieval, operation_id: 'op-other' }))
      .toEqual({ operation_id: 'op-1', status: 'reconciling' });
    expect(weknora.readEvidence('op-1')).toEqual([]);
    expect(transitionKnowledge(asset, command('published', weknora.readEvidence('op-1'))).ok).toBe(false);
    expect(() => weknora.complete('op-1', readback, retrieval)).toThrow();
    expect(weknora.reconcile('op-1', readback, retrieval))
      .toEqual({ operation_id: 'op-1', status: 'succeeded' });
  });

  it('does not revive failed operations when a result arrives late', () => {
    const weknora = createFakeWeKnora();
    weknora.ingest(request);
    weknora.timeout('op-1');
    weknora.fail('op-1');
    expect(() => weknora.complete('op-1', readback, retrieval)).toThrow();
    expect(() => weknora.reconcile('op-1', readback, retrieval)).toThrow();
    expect(weknora.readEvidence('op-1')).toMatchObject([{ kind: 'provider_result', status: 'failed' }]);
    expect(transitionKnowledge(asset, command('published', weknora.readEvidence('op-1'))).ok).toBe(false);
  });

  it('does not rewrite a recorded unknown Knowledge transition after a late fake success', () => {
    const weknora = createFakeWeKnora();
    weknora.ingest(request);
    weknora.timeout('op-1');
    const unknown = transitionKnowledge(asset, command('index_unknown', weknora.readEvidence('op-1')));
    expect(unknown.ok).toBe(true);
    if (!unknown.ok) throw new Error('Expected index_unknown Knowledge');
    weknora.reconcile('op-1', readback, retrieval);
    const publish = transitionKnowledge(unknown.knowledge, command('published', weknora.readEvidence('op-1')));
    expect(publish.ok).toBe(false);
    if (!publish.ok) expect(publish.error.code).toBe('STALE_STATE_VERSION');
    expect(unknown.knowledge.status).toBe('index_unknown');
  });

  it('keeps stale state versions and asset revisions from applying a successful result', () => {
    const weknora = createFakeWeKnora();
    weknora.ingest(request);
    weknora.complete('op-1', readback, retrieval);
    const publishCommand = command('published', weknora.readEvidence('op-1'));
    const staleState = transitionKnowledge({ ...asset, state_version: 2 }, publishCommand);
    expect(staleState.ok).toBe(false);
    if (!staleState.ok) expect(staleState.error.code).toBe('STALE_STATE_VERSION');
    const staleRevision = transitionKnowledge({ ...asset, asset_revision: 2 }, publishCommand);
    expect(staleRevision.ok).toBe(false);
    if (!staleRevision.ok) expect(staleRevision.error.code).toBe('ASSET_REVISION_CONFLICT');
    const first = transitionKnowledge(asset, publishCommand);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('Expected published Knowledge');
    const duplicate = transitionKnowledge(first.knowledge, publishCommand);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.code).toBe('STALE_STATE_VERSION');
    expect(first.knowledge.status).toBe('published');
  });

  it('keeps timeouts unknown until a matching reconciliation and never succeeds on failure', () => {
    const weknora = createFakeWeKnora();
    weknora.ingest(request);
    expect(weknora.timeout('op-1')).toEqual({ operation_id: 'op-1', status: 'unknown' });
    expect(weknora.readEvidence('op-1').map((item) => item.kind)).toEqual(['provider_result']);
    const unknown = transitionKnowledge(asset, command('index_unknown', weknora.readEvidence('op-1')));
    expect(unknown.ok).toBe(true);
    expect(() => weknora.complete('op-1', readback, retrieval)).toThrow();
    expect(weknora.reconcile('op-1', readback, retrieval))
      .toEqual({ operation_id: 'op-1', status: 'succeeded' });
    expect(weknora.readEvidence('op-1').map((item) => item.kind)).toEqual(['weknora_readback', 'retrieval_smoke']);

    const failed = createFakeWeKnora();
    failed.ingest(request);
    expect(failed.fail('op-1')).toEqual({ operation_id: 'op-1', status: 'failed' });
    expect(transitionKnowledge(asset, command('index_failed', failed.readEvidence('op-1'))).ok).toBe(true);
    expect(() => failed.complete('op-1', readback, retrieval)).toThrow();
  });
});
