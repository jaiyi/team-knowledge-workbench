export type ProviderMode = 'fake' | 'admin' | 'real';
export type IntegrationStatus =
  | 'pending'
  | 'blocked'
  | 'fallback_only'
  | 'contract_verified'
  | 'real_verified';
export type ProviderOperationStatus =
  | 'queued'
  | 'running'
  | 'waiting_readback'
  | 'succeeded'
  | 'failed'
  | 'unknown'
  | 'reconciling';

export type KnowledgeStatus =
  | 'captured'
  | 'candidate'
  | 'reviewing'
  | 'approved'
  | 'publishing'
  | 'published'
  | 'index_failed'
  | 'index_unknown'
  | 'stale'
  | 'deprecated'
  | 'rejected'
  | 'manual_required';

export type SourceConfirmationEvidence = Readonly<{
  kind: 'source_confirmation';
  reference: string;
  claim_ids: readonly string[];
  source_ref_ids: readonly string[];
}>;

export type ApprovalEvidence = Readonly<{
  kind: 'approval';
  reference: string;
  approver_id: string;
  approver_type: 'human';
  approved_revision: number;
}>;

export type GitMergeEvidence = Readonly<{
  kind: 'git_merge';
  reference: string;
  commit_sha: string;
  repository_id: string;
  protected_ref: 'refs/heads/main';
  merge_event_id: string;
  changed_paths: readonly string[];
  signature_verified: true;
}>;

export type WeKnoraReadbackEvidence = Readonly<{
  kind: 'weknora_readback';
  reference: string;
  operation_id: string;
  status: 'succeeded';
  knowledge_id: string;
  version: string;
  asset_revision: number;
  asset_space_id: string;
  repo_path: string;
  source_commit: string;
  acl_digest: string;
}>;

export type RetrievalSmokeEvidence = Readonly<{
  kind: 'retrieval_smoke';
  reference: string;
  operation_id: string;
  status: 'succeeded';
  knowledge_id: string;
  version: string;
  asset_revision: number;
}>;

export type ProviderResultEvidence = Readonly<{
  kind: 'provider_result';
  reference: string;
  operation_id: string;
  status: ProviderOperationStatus;
  knowledge_id: string;
  asset_revision: number;
}>;

export type EvidenceReference =
  | SourceConfirmationEvidence
  | ApprovalEvidence
  | GitMergeEvidence
  | WeKnoraReadbackEvidence
  | RetrievalSmokeEvidence
  | ProviderResultEvidence;

export type Actor = Readonly<{
  actor_id: string;
  actor_type: 'human' | 'service';
}>;

export type AuthenticatedPrincipal = Readonly<{
  actor: Actor;
  team_ids: readonly string[];
  asset_space_ids: readonly string[];
  roles: readonly ('owner' | 'steward' | 'reviewer' | 'publisher')[];
}>;

export type KnowledgeAsset = Readonly<{
  knowledge_id: string;
  version: string;
  status: KnowledgeStatus;
  team_id: string;
  asset_space_id: string;
  asset_repository_id: string;
  repo_path: string;
  taxonomy_version: string;
  source_commit?: string;
  expected_acl_digest: string;
  claims_confirmed: boolean;
  owner_id: string;
  steward_id: string;
  evidence_level: 'E0' | 'E1' | 'E2' | 'E3';
  sensitivity: 'public' | 'internal' | 'confidential' | 'restricted';
  sources: readonly Readonly<{
    source_ref_id: string;
    kind: 'document' | 'file' | 'text' | 'url';
    locator: string;
    content_digest: string;
  }>[];
  content: Readonly<{
    conclusion: string;
    claims: readonly Readonly<{
      claim_id: string;
      kind: 'fact' | 'rule' | 'case' | 'procedure' | 'decision';
      statement: string;
      source_refs: readonly string[];
      confirmation: 'pending' | 'confirmed' | 'rejected';
    }>[];
    applies_to: readonly string[];
    not_applies_to: readonly string[];
    inferences: readonly string[];
    unknowns: readonly string[];
  }>;
  asset_revision: number;
  state_version: number;
  created_at: string;
  updated_at: string;
}>;

export type KnowledgeTransitionCommand = Readonly<{
  transition_id: string;
  idempotency_key: string;
  correlation_id: string;
  asset_space_id: string;
  to: KnowledgeStatus;
  actor: Actor;
  reason: string;
  expected_state_version: number;
  expected_asset_revision: number;
  evidence: readonly EvidenceReference[];
  occurred_at: string;
}>;

export type KnowledgeTransitionRecord = Readonly<{
  transition_id: string;
  idempotency_key: string;
  correlation_id: string;
  asset_space_id: string;
  knowledge_id: string;
  from: KnowledgeStatus;
  to: KnowledgeStatus;
  actor: Actor;
  reason: string;
  asset_revision: number;
  state_version: number;
  evidence: readonly EvidenceReference[];
  occurred_at: string;
}>;

export type ProviderOperationResult = Readonly<{
  operation_id: string;
  provider: 'weknora';
  status: ProviderOperationStatus;
  knowledge_id: string;
  asset_revision: number;
}>;

export * from './evidence.js';
