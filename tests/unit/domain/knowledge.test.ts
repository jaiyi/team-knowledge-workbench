import { describe, expect, it } from 'vitest';
import { transitionKnowledge } from '../../../packages/domain/src/index.js';
import type {
  EvidenceReference,
  KnowledgeAsset,
  KnowledgeTransitionCommand,
} from '../../../packages/contracts/src/index.js';

const digest = 'sha256:' + 'a'.repeat(64);
const commit = '0123456789abcdef0123456789abcdef01234567';
const baseEvidence = (kind: EvidenceReference['kind']): EvidenceReference => {
  if (kind === 'source_confirmation') {
    return { kind, reference: `evidence/${kind}-1`, claim_ids: ['claim_1'], source_ref_ids: ['src_minutes-1'] };
  }
  return { kind, reference: `evidence/${kind}-1` } as EvidenceReference;
};

const makeKnowledge = (overrides: Partial<KnowledgeAsset> = {}): KnowledgeAsset => ({
  knowledge_id: 'knowledge.quality.assembly-policy',
  version: '1.0.0',
  status: 'candidate',
  team_id: 'team-a',
  asset_space_id: 'space-a',
  asset_repository_id: 'repo-a',
  repo_path: 'knowledge/quality/assembly-policy/torque-review/',
  taxonomy_version: 'v1',
  expected_acl_digest: digest,
  claims_confirmed: false,
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
      confirmation: 'pending',
    }],
    applies_to: ['assembly-line-a'],
    not_applies_to: [],
    inferences: [],
    unknowns: [],
  },
  asset_revision: 1,
  state_version: 0,
  created_at: '2026-10-15T09:00:00Z',
  updated_at: '2026-10-15T09:00:00Z',
  ...overrides,
});

const command = (
  to: KnowledgeTransitionCommand['to'],
  overrides: Partial<KnowledgeTransitionCommand> = {},
): KnowledgeTransitionCommand => ({
  transition_id: 'transition-1',
  idempotency_key: 'idempotency-1',
  correlation_id: 'correlation-1',
  asset_space_id: 'space-a',
  to,
  actor: { actor_id: 'principal-1', actor_type: 'human' },
  reason: 'test transition',
  expected_state_version: 0,
  expected_asset_revision: 1,
  evidence: [baseEvidence('source_confirmation')],
  occurred_at: '2026-10-15T09:10:00Z',
  ...overrides,
});

const expectError = (result: ReturnType<typeof transitionKnowledge>, code: string) => {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
};

describe('Knowledge lifecycle', () => {
  it('returns a new object and does not mutate the original', () => {
    const original = makeKnowledge({ status: 'captured' });
    const result = transitionKnowledge(original, command('candidate'));

    expect(result.ok).toBe(true);
    expect(original.status).toBe('captured');
    expect(original.state_version).toBe(0);
    if (result.ok) {
      expect(result.knowledge).not.toBe(original);
      expect(result.knowledge.status).toBe('candidate');
      expect(result.knowledge.state_version).toBe(1);
    }
  });

  it('rejects illegal transitions, stale versions, and wrong asset spaces', () => {
    expectError(transitionKnowledge(makeKnowledge(), command('published')), 'INVALID_TRANSITION');
    expectError(transitionKnowledge(makeKnowledge(), command('reviewing', { expected_state_version: 1 })), 'STALE_STATE_VERSION');
    expectError(transitionKnowledge(makeKnowledge(), command('reviewing', { expected_asset_revision: 2 })), 'ASSET_REVISION_CONFLICT');
    expectError(transitionKnowledge(makeKnowledge(), command('reviewing', { asset_space_id: 'space-b' })), 'WORKSPACE_MISMATCH');
  });

  it('rejects source confirmation evidence for unknown or duplicate sources', () => {
    const unknownSource = transitionKnowledge(
      makeKnowledge({ status: 'captured' }),
      command('candidate', {
        evidence: [{ kind: 'source_confirmation', reference: 'source/1', claim_ids: ['claim_1'], source_ref_ids: ['src_missing'] }],
      }),
    );
    expectError(unknownSource, 'EVIDENCE_INVALID');

    const duplicateSource = transitionKnowledge(
      makeKnowledge({ status: 'captured' }),
      command('candidate', {
        evidence: [{ kind: 'source_confirmation', reference: 'source/1', claim_ids: ['claim_1'], source_ref_ids: ['src_minutes-1', 'src_minutes-1'] }],
      }),
    );
    expectError(duplicateSource, 'EVIDENCE_INVALID');
  });

  it('rejects source confirmation with an unrelated source', () => {
    const knowledge = makeKnowledge({
      status: 'captured',
      sources: [
        ...makeKnowledge().sources,
        {
          source_ref_id: 'src_other',
          kind: 'document',
          locator: 'meeting://2026-10-15/section/4',
          content_digest: digest,
        },
      ],
    });
    const result = transitionKnowledge(knowledge, command('candidate', {
      evidence: [{
        kind: 'source_confirmation', reference: 'source/1', claim_ids: ['claim_1'],
        source_ref_ids: ['src_minutes-1', 'src_other'],
      }],
    }));
    expectError(result, 'EVIDENCE_INVALID');
  });
  it('requires confirmed claims and human approval before approval', () => {
    expectError(transitionKnowledge(makeKnowledge({ status: 'reviewing' }), command('approved')), 'CONFIRMATION_REQUIRED');
    const pendingApproval = transitionKnowledge(
      makeKnowledge({
        status: 'reviewing',
        claims_confirmed: true,
      }),
      command('approved', {
        evidence: [{ kind: 'approval', reference: 'approval/1', approver_id: 'reviewer-1', approver_type: 'human', approved_revision: 1 }],
      }),
    );
    expectError(pendingApproval, 'CONFIRMATION_REQUIRED');
  });

  it('requires source confirmation coverage for every confirmed claim before approval', () => {
    const confirmed = makeKnowledge({
      status: 'reviewing',
      claims_confirmed: true,
      content: {
        ...makeKnowledge().content,
        claims: [{
          claim_id: 'claim_1', kind: 'rule', statement: '复核记录必须包含来源。',
          source_refs: ['src_minutes-1'], confirmation: 'confirmed',
        }],
      },
    });
    const approvalOnly = transitionKnowledge(confirmed, command('approved', {
      evidence: [{
        kind: 'approval', reference: 'approval/1', approver_id: 'reviewer-1',
        approver_type: 'human', approved_revision: 1,
      }],
    }));
    expectError(approvalOnly, 'APPROVAL_EVIDENCE_REQUIRED');

    const complete = transitionKnowledge(confirmed, command('approved', {
      evidence: [
        { kind: 'source_confirmation', reference: 'source/1', claim_ids: ['claim_1'], source_ref_ids: ['src_minutes-1'] },
        { kind: 'approval', reference: 'approval/1', approver_id: 'reviewer-1', approver_type: 'human', approved_revision: 1 },
      ],
    }));
    expect(complete.ok).toBe(true);
  });

  it('rejects source confirmation that covers an unrelated claim', () => {
    const confirmed = makeKnowledge({
      status: 'reviewing',
      claims_confirmed: true,
      content: {
        ...makeKnowledge().content,
        claims: [{
          claim_id: 'claim_1', kind: 'rule', statement: '复核记录必须包含来源。',
          source_refs: ['src_minutes-1'], confirmation: 'confirmed',
        }],
      },
    });
    const result = transitionKnowledge(confirmed, command('approved', {
      evidence: [
        { kind: 'source_confirmation', reference: 'source/1', claim_ids: ['claim_missing'], source_ref_ids: ['src_minutes-1'] },
        { kind: 'approval', reference: 'approval/1', approver_id: 'reviewer-1', approver_type: 'human', approved_revision: 1 },
      ],
    }));
    expectError(result, 'APPROVAL_EVIDENCE_REQUIRED');
  });
  it('requires a verified protected merge of the Knowledge path', () => {
    expectError(
      transitionKnowledge(
        makeKnowledge({
          status: 'approved',
          claims_confirmed: true,
          content: {
            ...makeKnowledge().content,
            claims: [{
              claim_id: 'claim_1', kind: 'rule', statement: '复核记录必须包含来源。',
              source_refs: ['src_minutes-1'], confirmation: 'confirmed',
            }],
          },
        }),
        command('publishing'),
      ),
      'MERGE_EVIDENCE_REQUIRED',
    );
  });

  it('rejects sibling paths that only share a repository prefix', () => {
    const confirmed = makeKnowledge({
      status: 'approved',
      claims_confirmed: true,
      content: { ...makeKnowledge().content, claims: [{ claim_id: 'claim_1', kind: 'rule', statement: '复核记录必须包含来源。', source_refs: ['src_minutes-1'], confirmation: 'confirmed' }] },
    });
    const result = transitionKnowledge(confirmed, command('publishing', {
      evidence: [{
        kind: 'git_merge', reference: `merge/${commit}`, commit_sha: commit,
        repository_id: confirmed.asset_repository_id, protected_ref: 'refs/heads/main',
        merge_event_id: 'merge-event-1',
        changed_paths: ['knowledge/quality/assembly-policy/torque-review-sibling/metadata.yaml'],
        signature_verified: true,
      }],
    }));

    expectError(result, 'MERGE_EVIDENCE_REQUIRED');
  });

  it('rejects C1 control characters in changed paths', () => {
    const confirmed = makeKnowledge({
      status: 'approved',
      claims_confirmed: true,
      content: { ...makeKnowledge().content, claims: [{ claim_id: 'claim_1', kind: 'rule', statement: '复核记录必须包含来源。', source_refs: ['src_minutes-1'], confirmation: 'confirmed' }] },
    });
    for (const control of ['', '']) {
      const result = transitionKnowledge(confirmed, command('publishing', {
        evidence: [{
          kind: 'git_merge', reference: `merge/${commit}`, commit_sha: commit,
          repository_id: confirmed.asset_repository_id, protected_ref: 'refs/heads/main',
          merge_event_id: 'merge-event-1',
          changed_paths: [`${confirmed.repo_path}metadata${control}.yaml`],
          signature_verified: true,
        }],
      }));
      expectError(result, 'MERGE_EVIDENCE_REQUIRED');
    }
  });
  it('copies a verified merge commit and publishes only on correlated successful evidence', () => {
    const confirmed = makeKnowledge({
      status: 'approved',
      claims_confirmed: true,
      content: { ...makeKnowledge().content, claims: [{ claim_id: 'claim_1', kind: 'rule', statement: '复核记录必须包含来源。', source_refs: ['src_minutes-1'], confirmation: 'confirmed' }] },
    });
    const merge = {
      kind: 'git_merge' as const,
      reference: `merge/${commit}`,
      commit_sha: commit,
      repository_id: confirmed.asset_repository_id,
      protected_ref: 'refs/heads/main' as const,
      merge_event_id: 'merge-event-1',
      changed_paths: [`${confirmed.repo_path}metadata.yaml`],
      signature_verified: true as const,
    };
    const publishing = transitionKnowledge(confirmed, command('publishing', { evidence: [merge] }));

    expect(publishing.ok).toBe(true);
    if (!publishing.ok) return;
    expect(publishing.knowledge.source_commit).toBe(commit);

    const published = transitionKnowledge(publishing.knowledge, command('published', {
      expected_state_version: 1,
      evidence: [
        {
          kind: 'weknora_readback',
          reference: 'readback/1',
          operation_id: 'op-1',
          status: 'succeeded',
          knowledge_id: publishing.knowledge.knowledge_id,
          version: publishing.knowledge.version,
          asset_revision: publishing.knowledge.asset_revision,
          asset_space_id: publishing.knowledge.asset_space_id,
          repo_path: publishing.knowledge.repo_path,
          source_commit: commit,
          acl_digest: digest,
        },
        {
          kind: 'retrieval_smoke',
          reference: 'retrieval/1',
          operation_id: 'op-1',
          status: 'succeeded',
          knowledge_id: publishing.knowledge.knowledge_id,
          version: publishing.knowledge.version,
          asset_revision: publishing.knowledge.asset_revision,
        },
      ],
    }));

    expect(published.ok).toBe(true);
    if (published.ok) expect(published.knowledge.status).toBe('published');
  });


  it('rejects failed, unknown, unrelated, and stale read-back evidence', () => {
    const publishing = makeKnowledge({ status: 'publishing', source_commit: commit });
    const unknown = transitionKnowledge(publishing, command('index_unknown', {
      evidence: [{ kind: 'provider_result', reference: 'provider/unknown', operation_id: 'op-1', status: 'unknown', knowledge_id: publishing.knowledge_id, asset_revision: 1 }],
    }));
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.knowledge.status).toBe('index_unknown');

    const unrelatedFailure = transitionKnowledge(publishing, command('index_failed', {
      evidence: [{ kind: 'source_confirmation', reference: 'source/1', claim_ids: ['claim_1'], source_ref_ids: ['src_minutes-1'] }],
    }));
    expectError(unrelatedFailure, 'PROVIDER_RESULT_MISMATCH');
    const result = transitionKnowledge(publishing, command('published', {
      evidence: [
        {
          kind: 'weknora_readback', reference: 'readback/1', operation_id: 'op-1', status: 'succeeded',
          knowledge_id: publishing.knowledge_id, version: publishing.version, asset_revision: 99,
          asset_space_id: publishing.asset_space_id, repo_path: publishing.repo_path, source_commit: commit, acl_digest: digest,
        },
        {
          kind: 'retrieval_smoke', reference: 'retrieval/1', operation_id: 'op-2', status: 'succeeded',
          knowledge_id: 'knowledge.other', version: publishing.version, asset_revision: 99,
        },
      ],
    }));
    expectError(result, 'PROVIDER_RESULT_MISMATCH');
  });

  it('deeply isolates and freezes returned assets and records', () => {
    const evidenceItems = [baseEvidence('source_confirmation')];
    const original = makeKnowledge({ status: 'captured' });
    const result = transitionKnowledge(original, command('candidate', { evidence: evidenceItems }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.knowledge.sources).not.toBe(original.sources);
      expect(result.knowledge.content).not.toBe(original.content);
      expect(result.knowledge.content.claims).not.toBe(original.content.claims);
      expect(result.knowledge.content.claims[0]?.source_refs).not.toBe(original.content.claims[0]?.source_refs);
      expect(result.record.evidence).not.toBe(evidenceItems);
      expect(Object.isFrozen(result.knowledge)).toBe(true);
      expect(Object.isFrozen(result.knowledge.content)).toBe(true);
      expect(Object.isFrozen(result.record)).toBe(true);
    }
  });

  it('copies transition evidence instead of retaining the caller array', () => {
    const evidenceItems = [baseEvidence('source_confirmation')];
    const result = transitionKnowledge(makeKnowledge({ status: 'captured' }), command('candidate', { evidence: evidenceItems }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      evidenceItems.push(baseEvidence('retrieval_smoke'));
      expect(result.record.evidence).toHaveLength(1);
    }
  });
});
