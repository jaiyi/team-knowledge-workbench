import { z } from 'zod';
import { strictSemverSchema } from './semver.js';

export const providerModeSchema = z.enum(['fake', 'admin', 'real']);
export const integrationStatusSchema = z.enum([
  'pending',
  'blocked',
  'fallback_only',
  'contract_verified',
  'real_verified',
]);
export const providerOperationStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_readback',
  'succeeded',
  'failed',
  'unknown',
  'reconciling',
]);

const definedOptional = <T extends z.ZodType>(schema: T) => schema.optional().refine((value) => value !== undefined, {
  message: 'omit optional fields instead of providing undefined',
});

const id = z.string().trim().min(1).max(200);
const sha = z.string().regex(/^[0-9a-f]{7,64}$/);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const sourceConfirmationEvidenceSchema = z.strictObject({
  kind: z.literal('source_confirmation'),
  reference: z.string().trim().min(1).max(500),
  claim_ids: z.array(z.string().regex(/^claim_[A-Za-z0-9_-]+$/)).min(1),
  source_ref_ids: z.array(z.string().regex(/^src_[A-Za-z0-9_-]+$/)).min(1),
});
const approvalEvidenceSchema = z.strictObject({
  kind: z.literal('approval'),
  reference: z.string().trim().min(1).max(500),
  approver_id: id,
  approver_type: z.literal('human'),
  approved_revision: z.number().int().positive(),
});
const gitMergeEvidenceSchema = z.strictObject({
  kind: z.literal('git_merge'),
  reference: z.string().trim().min(1).max(500),
  commit_sha: sha,
  repository_id: id,
  protected_ref: z.literal('refs/heads/main'),
  merge_event_id: id,
  changed_paths: z.array(z.string().trim().min(1).refine(
    (value) => !/\p{Cc}/u.test(value),
    { message: 'changed path must not contain control characters' },
  )).min(1),
  signature_verified: z.literal(true),
});
const weknoraReadbackEvidenceSchema = z.strictObject({
  kind: z.literal('weknora_readback'),
  reference: z.string().trim().min(1).max(500),
  operation_id: id,
  status: z.literal('succeeded'),
  knowledge_id: z.string().regex(/^knowledge\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  version: strictSemverSchema,
  asset_revision: z.number().int().positive(),
  asset_space_id: id,
  repo_path: z.string().regex(/^knowledge\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/),
  source_commit: sha,
  acl_digest: digest,
});
const retrievalSmokeEvidenceSchema = z.strictObject({
  kind: z.literal('retrieval_smoke'),
  reference: z.string().trim().min(1).max(500),
  operation_id: id,
  status: z.literal('succeeded'),
  knowledge_id: z.string().regex(/^knowledge\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  version: strictSemverSchema,
  asset_revision: z.number().int().positive(),
});
const providerResultEvidenceSchema = z.strictObject({
  kind: z.literal('provider_result'),
  reference: z.string().trim().min(1).max(500),
  operation_id: id,
  status: providerOperationStatusSchema,
  knowledge_id: z.string().regex(/^knowledge\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  asset_revision: z.number().int().positive(),
});

export const evidenceReferenceSchema = z.discriminatedUnion('kind', [
  sourceConfirmationEvidenceSchema,
  approvalEvidenceSchema,
  gitMergeEvidenceSchema,
  weknoraReadbackEvidenceSchema,
  retrievalSmokeEvidenceSchema,
  providerResultEvidenceSchema,
]);

export const actorSchema = z.strictObject({
  actor_id: id,
  actor_type: z.enum(['human', 'service']),
});

export const knowledgeStatusSchema = z.enum([
  'captured',
  'candidate',
  'reviewing',
  'approved',
  'publishing',
  'published',
  'index_failed',
  'index_unknown',
  'stale',
  'deprecated',
  'rejected',
  'manual_required',
]);

export const knowledgeAssetSchema = z
  .strictObject({
    knowledge_id: z.string().regex(/^knowledge\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
    version: strictSemverSchema,
    status: knowledgeStatusSchema,
    team_id: id,
    asset_space_id: id,
    asset_repository_id: id,
    repo_path: z.string().regex(/^knowledge\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/),
    taxonomy_version: z.string().regex(/^v\d+$/),
    source_commit: definedOptional(sha),
    expected_acl_digest: digest,
    claims_confirmed: z.boolean(),
    owner_id: id,
    steward_id: id,
    evidence_level: z.enum(['E0', 'E1', 'E2', 'E3']),
    sensitivity: z.enum(['public', 'internal', 'confidential', 'restricted']),
    sources: z.array(
      z.strictObject({
        source_ref_id: z.string().regex(/^src_[A-Za-z0-9_-]+$/),
        kind: z.enum(['document', 'file', 'text', 'url']),
        locator: z.string().trim().min(1).max(2_000),
        content_digest: digest,
      }),
    ).min(1),
    content: z.strictObject({
      conclusion: z.string().trim().min(1).max(20_000),
      claims: z.array(
        z.strictObject({
          claim_id: z.string().regex(/^claim_[A-Za-z0-9_-]+$/),
          kind: z.enum(['fact', 'rule', 'case', 'procedure', 'decision']),
          statement: z.string().trim().min(1).max(20_000),
          source_refs: z.array(z.string().regex(/^src_[A-Za-z0-9_-]+$/)).min(1),
          confirmation: z.enum(['pending', 'confirmed', 'rejected']),
        }),
      ).min(1),
      applies_to: z.array(z.string().trim().min(1)).max(100),
      not_applies_to: z.array(z.string().trim().min(1)).max(100),
      inferences: z.array(z.string().trim().min(1)).max(100),
      unknowns: z.array(z.string().trim().min(1)).max(100),
    }),
    asset_revision: z.number().int().positive(),
    state_version: z.number().int().nonnegative(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .superRefine((asset, context) => {
    const sourceIds = new Set<string>();
    asset.sources.forEach((source, index) => {
      if (sourceIds.has(source.source_ref_id)) {
        context.addIssue({ code: 'custom', path: ['sources', index, 'source_ref_id'], message: 'source ID must be unique' });
      }
      sourceIds.add(source.source_ref_id);
    });
    const claimIds = new Set<string>();
    asset.content.claims.forEach((claim, claimIndex) => {
      if (claimIds.has(claim.claim_id)) {
        context.addIssue({ code: 'custom', path: ['content', 'claims', claimIndex, 'claim_id'], message: 'claim ID must be unique' });
      }
      claimIds.add(claim.claim_id);
      const refs = new Set<string>();
      claim.source_refs.forEach((sourceRef, sourceIndex) => {
        if (refs.has(sourceRef)) {
          context.addIssue({ code: 'custom', path: ['content', 'claims', claimIndex, 'source_refs', sourceIndex], message: 'source reference must be unique' });
        }
        refs.add(sourceRef);
        if (!sourceIds.has(sourceRef)) {
          context.addIssue({ code: 'custom', path: ['content', 'claims', claimIndex, 'source_refs', sourceIndex], message: `claim references unknown source: ${sourceRef}` });
        }
      });
    });
    if (['approved', 'publishing', 'published'].includes(asset.status) && (!asset.claims_confirmed || asset.content.claims.some((claim) => claim.confirmation !== 'confirmed'))) {
      context.addIssue({ code: 'custom', path: ['claims_confirmed'], message: 'all claims must be confirmed' });
    }
    if (['publishing', 'published'].includes(asset.status) && !asset.source_commit) {
      context.addIssue({ code: 'custom', path: ['source_commit'], message: 'source commit is required' });
    }
  });

export const knowledgeTransitionCommandSchema = z.strictObject({
  transition_id: id,
  idempotency_key: id,
  correlation_id: id,
  asset_space_id: id,
  to: knowledgeStatusSchema,
  actor: actorSchema,
  reason: z.string().trim().min(1).max(2_000),
  expected_state_version: z.number().int().nonnegative(),
  expected_asset_revision: z.number().int().positive(),
  evidence: z.array(evidenceReferenceSchema).min(1),
  occurred_at: z.string().datetime({ offset: true }),
}).superRefine((command, context) => {
  command.evidence.forEach((evidence, evidenceIndex) => {
    if (evidence.kind !== 'source_confirmation') return;
    const sourceIds = new Set<string>();
    evidence.source_ref_ids.forEach((sourceRefId, sourceIndex) => {
      if (sourceIds.has(sourceRefId)) {
        context.addIssue({
          code: 'custom',
          path: ['evidence', evidenceIndex, 'source_ref_ids', sourceIndex],
          message: 'source reference must be unique',
        });
      }
      sourceIds.add(sourceRefId);
    });
  });
});

export const providerOperationResultSchema = z.strictObject({
  operation_id: id,
  provider: z.literal('weknora'),
  status: providerOperationStatusSchema,
  knowledge_id: z.string().regex(/^knowledge\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  asset_revision: z.number().int().positive(),
});
