export type DomainErrorCode =
  | 'INVALID_TRANSITION'
  | 'STALE_STATE_VERSION'
  | 'ASSET_REVISION_CONFLICT'
  | 'WORKSPACE_MISMATCH'
  | 'CONFIRMATION_REQUIRED'
  | 'APPROVAL_EVIDENCE_REQUIRED'
  | 'MERGE_EVIDENCE_REQUIRED'
  | 'PROVIDER_RESULT_MISMATCH'
  | 'EVIDENCE_REQUIRED'
  | 'EVIDENCE_INVALID';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
