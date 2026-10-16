import { describe, expect, it } from 'vitest';
import { transitionKnowledge } from '../../packages/domain/src/index.js';
import type { KnowledgeAsset } from '../../packages/contracts/src/index.js';

const sourceCommit = '0123456789abcdef0123456789abcdef01234567';
const digest = 'sha256:' + 'a'.repeat(64);

const makeAsset = (status: KnowledgeAsset['status']): KnowledgeAsset => ({
  knowledge_id: 'knowledge.quality.assembly-policy',
  version: '1.0.0',
  status,
  team_id: 'team-a',
  asset_space_id: 'space-a',
  asset_repository_id: 'repo-a',
  repo_path: 'knowledge/quality/assembly-policy/torque-review/',
  taxonomy_version: 'v1',
  source_commit: sourceCommit,
  expected_acl_digest: digest,
  claims_confirmed: true,
  owner_id: 'owner-a',
  steward_id: 'steward-a',
  evidence_level: 'E1',
  sensitivity: 'internal',
  sources: [{
    source_ref_id: 'src_minutes-1',
    kind: 'document',
    locator: 'meeting://2026-10-15/section/3',
    content_digest: digest,
  }],
  content: {
    conclusion: '扭矩复核应在最终装配后执行。',
    claims: [{
      claim_id: 'claim_1',
      kind: 'rule',
      statement: '复核记录必须包含来源。',
      source_refs: ['src_minutes-1'],
      confirmation: 'confirmed',
    }],
    applies_to: ['assembly-line-a'],
    not_applies_to: [],
    inferences: [],
    unknowns: [],
  },
  asset_revision: 1,
  state_version: status === 'publishing' ? 1 : 0,
  created_at: '2026-10-15T09:00:00Z',
  updated_at: '2026-10-15T09:00:00Z',
});

const baseCommand = (asset: KnowledgeAsset) => ({
  transition_id: 'transition-1',
  idempotency_key: 'idempotency-1',
  correlation_id: 'correlation-1',
  asset_space_id: asset.asset_space_id,
  actor: { actor_id: 'worker-1', actor_type: 'service' as const },
  reason: 'Provider evidence was verified',
  expected_state_version: asset.state_version,
  expected_asset_revision: asset.asset_revision,
  occurred_at: '2026-10-15T09:20:00Z',
});

describe('Knowledge lifecycle integration', () => {
  it('publishes only after matching index and retrieval evidence', () => {
    const asset = makeAsset('publishing');
    const result = transitionKnowledge(asset, {
      ...baseCommand(asset),
      transition_id: 'transition-published',
      to: 'published',
      evidence: [
        {
          kind: 'weknora_readback',
          reference: 'readback/weknora-1',
          operation_id: 'op-1',
          status: 'succeeded',
          knowledge_id: asset.knowledge_id,
          version: asset.version,
          asset_revision: asset.asset_revision,
          asset_space_id: asset.asset_space_id,
          repo_path: asset.repo_path,
          source_commit: sourceCommit,
          acl_digest: digest,
        },
        {
          kind: 'retrieval_smoke',
          reference: 'retrieval/smoke-1',
          operation_id: 'op-1',
          status: 'succeeded',
          knowledge_id: asset.knowledge_id,
          version: asset.version,
          asset_revision: asset.asset_revision,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.knowledge.status).toBe('published');
      expect(result.record.knowledge_id).toBe(asset.knowledge_id);
    }
  });

  it('keeps unknown provider outcomes non-published', () => {
    const asset = makeAsset('publishing');
    const result = transitionKnowledge(asset, {
      ...baseCommand(asset),
      transition_id: 'transition-unknown',
      to: 'index_unknown',
      evidence: [{
        kind: 'provider_result',
        reference: 'provider/weknora-1',
        operation_id: 'op-1',
        status: 'unknown',
        knowledge_id: asset.knowledge_id,
        asset_revision: asset.asset_revision,
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.knowledge.status).toBe('index_unknown');
  });
});
