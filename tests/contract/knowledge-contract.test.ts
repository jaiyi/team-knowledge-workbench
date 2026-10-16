import { describe, expect, it } from 'vitest';
import { knowledgeAssetSchema } from '../../packages/validation/src/knowledge.js';

const digest = 'sha256:' + 'a'.repeat(64);

const candidate = {
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
  sources: [
    {
      source_ref_id: 'src_minutes-1',
      kind: 'document',
      locator: 'meeting://2026-10-15/section/3',
      content_digest: digest,
    },
  ],
  content: {
    conclusion: '扭矩复核应在最终装配后执行。',
    claims: [
      {
        claim_id: 'claim_1',
        kind: 'rule',
        statement: "复核记录必须包含 SQL-like value: ' OR 1=1 --",
        source_refs: ['src_minutes-1'],
        confirmation: 'pending',
      },
    ],
    applies_to: ['assembly-line-a'],
    not_applies_to: [],
    inferences: [],
    unknowns: ['是否适用于旧产线'],
  },
  asset_revision: 1,
  state_version: 0,
  created_at: '2026-10-15T09:00:00Z',
  updated_at: '2026-10-15T09:00:00Z',
};

describe('Knowledge contract', () => {
  it('accepts a sanitized candidate with Unicode, emoji, and SQL-like text', () => {
    expect(knowledgeAssetSchema.safeParse(candidate).success).toBe(true);
  });

  it.each([null, undefined, 'not-an-object', 42, []])(
    'rejects invalid top-level input: %s',
    (input) => {
      expect(knowledgeAssetSchema.safeParse(input).success).toBe(false);
    },
  );

  it('rejects undeclared source references and path traversal', () => {
    const missingSource = {
      ...candidate,
      content: {
        ...candidate.content,
        claims: [{ ...candidate.content.claims[0], source_refs: ['src_missing'] }],
      },
    };
    const unsafePath = { ...candidate, repo_path: 'knowledge/../secrets/' };

    expect(knowledgeAssetSchema.safeParse(missingSource).success).toBe(false);
    expect(knowledgeAssetSchema.safeParse(unsafePath).success).toBe(false);
  });

  it('rejects undocumented raw source fields', () => {
    expect(
      knowledgeAssetSchema.safeParse({
        ...candidate,
        raw_source_text: 'sensitive meeting contents',
      }).success,
    ).toBe(false);
  });

  it('requires confirmed claims and a source commit for approved lifecycle states', () => {
    expect(
      knowledgeAssetSchema.safeParse({ ...candidate, status: 'approved' }).success,
    ).toBe(false);
    expect(
      knowledgeAssetSchema.safeParse({
        ...candidate,
        status: 'published',
        source_commit: '0123456789abcdef0123456789abcdef01234567',
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate source and claim identifiers', () => {
    const duplicateSource = {
      ...candidate,
      sources: [...candidate.sources, { ...candidate.sources[0] }],
    };
    const duplicateClaim = {
      ...candidate,
      content: {
        ...candidate.content,
        claims: [...candidate.content.claims, { ...candidate.content.claims[0] }],
      },
    };

    expect(knowledgeAssetSchema.safeParse(duplicateSource).success).toBe(false);
    expect(knowledgeAssetSchema.safeParse(duplicateClaim).success).toBe(false);
  });

  it('rejects malformed Semantic Versions', () => {
    const invalidVersions = ['01.2.3', '1.2', '1.2.3-', '1.2.3-01', '1.2.3+'];

    for (const version of invalidVersions) {
      expect(
        knowledgeAssetSchema.safeParse({ ...candidate, version }).success,
        version,
      ).toBe(false);
    }
  });

  it('accepts strict Semantic Versions with valid prerelease and build metadata', () => {
    for (const version of ['0.0.0', '1.2.3-rc.1', '1.2.3+build.7']) {
      expect(
        knowledgeAssetSchema.safeParse({ ...candidate, version }).success,
        version,
      ).toBe(true);
    }
  });

  it('rejects explicit undefined for optional fields', () => {
    expect(knowledgeAssetSchema.safeParse({ ...candidate, source_commit: undefined }).success).toBe(false);
  });
  it('rejects duplicate source confirmation references', async () => {
    const { knowledgeTransitionCommandSchema } = await import(
      '../../packages/validation/src/knowledge.js'
    );
    const result = knowledgeTransitionCommandSchema.safeParse({
      transition_id: 'transition-1', idempotency_key: 'idempotency-1', correlation_id: 'correlation-1',
      asset_space_id: 'space-a', to: 'candidate', actor: { actor_id: 'human-1', actor_type: 'human' },
      reason: 'test', expected_state_version: 0, expected_asset_revision: 1,
      evidence: [{ kind: 'source_confirmation', reference: 'source/1', claim_ids: ['claim_1'], source_ref_ids: ['src_minutes-1', 'src_minutes-1'] }],
      occurred_at: '2026-10-15T09:10:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects C0, DEL, and C1 control characters in changed paths', async () => {
    const { knowledgeTransitionCommandSchema } = await import(
      '../../packages/validation/src/knowledge.js'
    );
    for (const control of ['\u0000', '\u0085', '\u009f']) {
      const result = knowledgeTransitionCommandSchema.safeParse({
        transition_id: 'transition-1', idempotency_key: 'idempotency-1', correlation_id: 'correlation-1',
        asset_space_id: 'space-a', to: 'publishing', actor: { actor_id: 'human-1', actor_type: 'human' },
        reason: 'test', expected_state_version: 0, expected_asset_revision: 1,
        evidence: [{
          kind: 'git_merge', reference: 'merge/1', commit_sha: '0123456789abcdef0123456789abcdef01234567',
          repository_id: 'repo-a', protected_ref: 'refs/heads/main', merge_event_id: 'merge-1',
          changed_paths: [`knowledge/quality/assembly-policy/torque-review/metadata.yaml${control}`], signature_verified: true,
        }],
        occurred_at: '2026-10-15T09:10:00Z',
      });
      expect(result.success, `U+${control.codePointAt(0)?.toString(16).padStart(4, '0')}`).toBe(false);
    }
  });

  it('preserves unknown provider operation status as a non-success status', async () => {
    const { providerOperationResultSchema } = await import(
      '../../packages/validation/src/knowledge.js'
    );
    const result = providerOperationResultSchema.parse({
      operation_id: 'op_1',
      provider: 'weknora',
      status: 'unknown',
      knowledge_id: candidate.knowledge_id,
      asset_revision: 1,
    });

    expect(result.status).toBe('unknown');
  });
});
