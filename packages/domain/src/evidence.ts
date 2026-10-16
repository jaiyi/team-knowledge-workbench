import type {
  EvidenceReference,
  KnowledgeAsset,
  KnowledgeTransitionCommand,
} from '../../contracts/src/index.js';
import { isKnowledgePathChanged } from './path-boundary.js';

export type EvidenceVerificationFailure = Readonly<{
  ok: false;
  reason: string;
}>;

export type EvidenceVerificationResult =
  | Readonly<{ ok: true; evidence: readonly EvidenceReference[] }>
  | EvidenceVerificationFailure;

/**
 * Performs structural and asset-specific consistency checks only.
 *
 * This function does not authenticate actors, verify signatures, query Git or
 * WeKnora, or establish provider read-back. Only a trusted adapter may create
 * the branded evidence required by KnowledgeEvidenceVerifier.
 */
export const verifyTransitionEvidence = (
  knowledge: KnowledgeAsset,
  command: KnowledgeTransitionCommand,
): EvidenceVerificationResult => {
  if (!command.evidence.length) return { ok: false, reason: 'A transition requires evidence' };

  const knownSourceIds = new Set(knowledge.sources.map((source) => source.source_ref_id));
  const knownClaimIds = new Set(knowledge.content.claims.map((claim) => claim.claim_id));
  const claimsById = new Map(knowledge.content.claims.map((claim) => [claim.claim_id, claim]));
  for (const evidence of command.evidence) {
    if (evidence.kind !== 'source_confirmation') continue;
    const claimIds = new Set<string>();
    const sourceIds = new Set<string>();
    for (const claimId of evidence.claim_ids) {
      if (claimIds.has(claimId)) {
        return { ok: false, reason: 'Source confirmation claims must be unique' };
      }
      if (!knownClaimIds.has(claimId)) {
        return { ok: false, reason: 'Source confirmation references an unknown Knowledge claim' };
      }
      claimIds.add(claimId);
    }
    for (const sourceRefId of evidence.source_ref_ids) {
      if (sourceIds.has(sourceRefId)) {
        return { ok: false, reason: 'Source confirmation references must be unique' };
      }
      if (!knownSourceIds.has(sourceRefId)) {
        return { ok: false, reason: 'Source confirmation references an unknown Knowledge source' };
      }
      sourceIds.add(sourceRefId);
    }
    for (const claimId of claimIds) {
      const claim = claimsById.get(claimId);
      if (!claim) {
        return { ok: false, reason: 'Source confirmation references an unknown Knowledge claim' };
      }
      const claimSourceIds = new Set(claim.source_refs);
      if (
        claimSourceIds.size !== sourceIds.size ||
        [...claimSourceIds].some((sourceRefId) => !sourceIds.has(sourceRefId))
      ) {
        return { ok: false, reason: 'Source confirmation does not exactly match the claim sources' };
      }
    }
  }

  if (command.to === 'approved') {
    const sourceConfirmations = command.evidence.filter((item) => item.kind === 'source_confirmation');
    const confirmedClaimIds = new Set(
      knowledge.content.claims
        .filter((claim) => claim.confirmation === 'confirmed')
        .map((claim) => claim.claim_id),
    );
    const coveredClaimIds = new Set(sourceConfirmations.flatMap((item) => item.claim_ids));
    if (sourceConfirmations.length === 0 || [...confirmedClaimIds].some((claimId) => !coveredClaimIds.has(claimId))) {
      return { ok: false, reason: 'Approval requires source confirmation for every confirmed claim' };
    }
    const approval = command.evidence.find((item) => item.kind === 'approval');
    if (!approval || approval.approver_type !== 'human' || approval.approved_revision !== knowledge.asset_revision) {
      return { ok: false, reason: 'Approval requires a human approval for this revision' };
    }
  }

  if (command.to === 'publishing') {
    const merge = command.evidence.find((item) => item.kind === 'git_merge');
    if (
      !merge ||
      merge.repository_id !== knowledge.asset_repository_id ||
      merge.protected_ref !== 'refs/heads/main' ||
      !merge.signature_verified ||
      !merge.changed_paths.some((changedPath) => isKnowledgePathChanged(knowledge.repo_path, changedPath))
    ) {
      return { ok: false, reason: 'Publishing requires a verified merge of the Knowledge path' };
    }
  }

  if (command.to === 'index_failed' || command.to === 'index_unknown') {
    const providerResult = command.evidence.find((item) => item.kind === 'provider_result');
    const expectedStatus = command.to === 'index_failed' ? 'failed' : 'unknown';
    if (
      !providerResult ||
      providerResult.status !== expectedStatus ||
      providerResult.knowledge_id !== knowledge.knowledge_id ||
      providerResult.asset_revision !== knowledge.asset_revision
    ) {
      return { ok: false, reason: 'Provider failure evidence does not match the Knowledge operation' };
    }
  }

  if (command.to === 'published') {
    const readback = command.evidence.find((item) => item.kind === 'weknora_readback');
    const retrieval = command.evidence.find((item) => item.kind === 'retrieval_smoke');
    if (
      !readback ||
      !retrieval ||
      readback.status !== 'succeeded' ||
      retrieval.status !== 'succeeded' ||
      readback.knowledge_id !== knowledge.knowledge_id ||
      readback.version !== knowledge.version ||
      readback.asset_revision !== knowledge.asset_revision ||
      readback.asset_space_id !== knowledge.asset_space_id ||
      readback.repo_path !== knowledge.repo_path ||
      readback.source_commit !== knowledge.source_commit ||
      readback.acl_digest !== knowledge.expected_acl_digest ||
      retrieval.knowledge_id !== knowledge.knowledge_id ||
      retrieval.version !== knowledge.version ||
      retrieval.asset_revision !== knowledge.asset_revision ||
      retrieval.operation_id !== readback.operation_id
    ) {
      return { ok: false, reason: 'Published evidence does not match the Knowledge revision' };
    }
  }

  return { ok: true, evidence: command.evidence };
};
