import type {
  EvidenceReference,
  KnowledgeAsset,
  KnowledgeStatus,
  KnowledgeTransitionCommand,
  KnowledgeTransitionRecord,
} from '../../contracts/src/index.js';
import { DomainError, type DomainErrorCode } from './errors.js';
import { verifyTransitionEvidence } from './evidence.js';
import {
  cloneAndFreezeKnowledge,
  cloneAndFreezeTransitionRecord,
} from './immutability.js';

export type KnowledgeTransitionResult =
  | Readonly<{ ok: true; knowledge: KnowledgeAsset; record: KnowledgeTransitionRecord }>
  | Readonly<{ ok: false; error: DomainError }>;

const allowedTransitions: Readonly<Record<KnowledgeStatus, readonly KnowledgeStatus[]>> = {
  captured: ['candidate'],
  candidate: ['reviewing', 'rejected'],
  reviewing: ['approved', 'rejected'],
  approved: ['publishing'],
  publishing: ['published', 'index_failed', 'index_unknown', 'manual_required'],
  published: ['stale', 'deprecated'],
  index_failed: [],
  index_unknown: [],
  stale: [],
  deprecated: [],
  rejected: [],
  manual_required: [],
};

const failure = (code: DomainErrorCode, message: string): KnowledgeTransitionResult => ({
  ok: false,
  error: new DomainError(code, message),
});

const hasEvidence = (evidence: readonly EvidenceReference[], kind: EvidenceReference['kind']): boolean =>
  evidence.some((item) => item.kind === kind);

export const transitionKnowledge = (
  knowledge: KnowledgeAsset,
  command: KnowledgeTransitionCommand,
): KnowledgeTransitionResult => {
  if (command.asset_space_id !== knowledge.asset_space_id) {
    return failure('WORKSPACE_MISMATCH', 'Transition asset space does not match Knowledge');
  }
  if (command.expected_state_version !== knowledge.state_version) {
    return failure('STALE_STATE_VERSION', 'Knowledge state version is stale');
  }
  if (command.expected_asset_revision !== knowledge.asset_revision) {
    return failure('ASSET_REVISION_CONFLICT', 'Knowledge asset revision does not match');
  }
  if (!command.evidence.length) {
    return failure('EVIDENCE_REQUIRED', 'A transition requires evidence');
  }
  if (!allowedTransitions[knowledge.status].includes(command.to)) {
    return failure('INVALID_TRANSITION', `Cannot transition from ${knowledge.status} to ${command.to}`);
  }
  if (command.to === 'approved') {
    const approval = command.evidence.find((item) => item.kind === 'approval');
    if (!knowledge.claims_confirmed || !knowledge.content.claims.every((claim) => claim.confirmation === 'confirmed')) {
      return failure('CONFIRMATION_REQUIRED', 'All Knowledge claims must be confirmed before approval');
    }
    if (!approval || approval.approver_type !== 'human' || approval.approved_revision !== knowledge.asset_revision) {
      return failure('APPROVAL_EVIDENCE_REQUIRED', 'Approval requires a human approval for this revision');
    }
  }
  const evidenceCheck = verifyTransitionEvidence(knowledge, command);
  if (!evidenceCheck.ok) {
    if (command.to === 'candidate' || command.to === 'reviewing') {
      return failure('EVIDENCE_INVALID', evidenceCheck.reason);
    }
    if (command.to === 'approved') {
      return failure('APPROVAL_EVIDENCE_REQUIRED', evidenceCheck.reason);
    }
    if (command.to === 'publishing') {
      return failure('MERGE_EVIDENCE_REQUIRED', evidenceCheck.reason);
    }
    return failure('PROVIDER_RESULT_MISMATCH', evidenceCheck.reason);
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
      return failure('PROVIDER_RESULT_MISMATCH', 'Provider failure evidence does not match the Knowledge operation');
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
      return failure('PROVIDER_RESULT_MISMATCH', 'Published evidence does not match the Knowledge revision');
    }
  }


  const merge = command.evidence.find((item) => item.kind === 'git_merge');
  const baseKnowledge: KnowledgeAsset = {
    ...knowledge,
    status: command.to,
    state_version: knowledge.state_version + 1,
    updated_at: command.occurred_at,
  };
  const nextKnowledge: KnowledgeAsset =
    command.to === 'publishing' && merge?.kind === 'git_merge'
      ? { ...baseKnowledge, source_commit: merge.commit_sha }
      : baseKnowledge;
  const record: KnowledgeTransitionRecord = {
    transition_id: command.transition_id,
    idempotency_key: command.idempotency_key,
    correlation_id: command.correlation_id,
    asset_space_id: command.asset_space_id,
    knowledge_id: knowledge.knowledge_id,
    from: knowledge.status,
    to: command.to,
    actor: { ...command.actor },
    reason: command.reason,
    asset_revision: knowledge.asset_revision,
    state_version: nextKnowledge.state_version,
    evidence: command.evidence.map((item) => ({ ...item })),
    occurred_at: command.occurred_at,
  };

  return {
    ok: true,
    knowledge: cloneAndFreezeKnowledge(nextKnowledge),
    record: cloneAndFreezeTransitionRecord(record),
  };
};
