import type { KnowledgeTransitionCommand, KnowledgeAsset } from './index.js';

export type EvidenceVerificationAttestation = Readonly<{
  evidence_fingerprint: string;
}>;

export type TrustedKnowledgeTransitionResult =
  | Readonly<{ ok: true; attestation: EvidenceVerificationAttestation }>
  | Readonly<{ ok: false; reason: string }>;

/**
 * A server-side adapter that attests to the exact submitted evidence.
 * The adapter is responsible for authenticating external provider facts before
 * returning an attestation; a fingerprint alone is not external authenticity.
 */
export interface KnowledgeEvidenceVerifier {
  verify(
    knowledge: KnowledgeAsset,
    command: KnowledgeTransitionCommand,
  ): TrustedKnowledgeTransitionResult;
}
