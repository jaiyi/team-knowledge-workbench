import { z } from 'zod';
import { knowledgeAssetSchema, knowledgeTransitionCommandSchema } from '../../../../packages/validation/src/index.js';
import {
  cloneAndFreezeKnowledge,
  transitionKnowledge,
} from '../../../../packages/domain/src/index.js';
import {
  type KnowledgeEvidenceVerifier,
  type TrustedKnowledgeTransitionResult,
} from '../../../../packages/contracts/src/evidence.js';
import type {
  Actor,
  AuthenticatedPrincipal,
  KnowledgeAsset,
  KnowledgeTransitionCommand,
} from '../../../../packages/contracts/src/index.js';

export type KnowledgeTransitionAuthorizationResult =
  | Readonly<{ ok: true; actor: Actor }>
  | Readonly<{ ok: false; reason: string }>;

export interface KnowledgeTransitionAuthorizer {
  authorize(
    principal: AuthenticatedPrincipal,
    knowledge: KnowledgeAsset,
    command: KnowledgeTransitionCommand,
  ): KnowledgeTransitionAuthorizationResult;
}

export type KnowledgeTransitionApplicationResult =
  | Readonly<{ ok: true; knowledge: KnowledgeAsset; record: unknown }>
  | Readonly<{
    ok: false;
    kind: 'validation' | 'authorization' | 'evidence' | 'domain';
    message: string;
    code?: string;
  }>;

const sameCommandEnvelope = (
  original: KnowledgeTransitionCommand,
  verified: KnowledgeTransitionCommand,
): boolean => (
  original.transition_id === verified.transition_id
  && original.idempotency_key === verified.idempotency_key
  && original.correlation_id === verified.correlation_id
  && original.asset_space_id === verified.asset_space_id
  && original.to === verified.to
  && original.actor.actor_id === verified.actor.actor_id
  && original.actor.actor_type === verified.actor.actor_type
  && original.reason === verified.reason
  && original.expected_state_version === verified.expected_state_version
  && original.expected_asset_revision === verified.expected_asset_revision
  && original.occurred_at === verified.occurred_at
);

const evidenceFingerprint = (command: KnowledgeTransitionCommand): string => JSON.stringify(command.evidence);

const trustedKnowledgeTransitionResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    attestation: z.strictObject({ evidence_fingerprint: z.string().min(1) }),
  }),
  z.object({ ok: z.literal(false), reason: z.string().trim().min(1).max(500) }),
]);

const sanitizeBoundaryReason = (reason: string): string =>
  reason.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 500);

const isAttestationForCommand = (
  command: KnowledgeTransitionCommand,
  result: TrustedKnowledgeTransitionResult,
): boolean => result.ok && result.attestation.evidence_fingerprint === evidenceFingerprint(command);

export const applyKnowledgeTransition = (
  rawKnowledge: unknown,
  rawCommand: unknown,
  principal: AuthenticatedPrincipal,
  authorizer: KnowledgeTransitionAuthorizer,
  evidenceVerifier: KnowledgeEvidenceVerifier,
): KnowledgeTransitionApplicationResult => {
  const knowledgeResult = knowledgeAssetSchema.safeParse(rawKnowledge);
  if (!knowledgeResult.success) {
    return { ok: false, kind: 'validation', message: 'Invalid Knowledge asset' };
  }

  const commandResult = knowledgeTransitionCommandSchema.safeParse(rawCommand);
  if (!commandResult.success) {
    return { ok: false, kind: 'validation', message: 'Invalid Knowledge transition command' };
  }

  const validatedKnowledge = cloneAndFreezeKnowledge(knowledgeResult.data);
  const validatedCommand = Object.freeze({
    ...commandResult.data,
    actor: Object.freeze({ ...commandResult.data.actor }),
    evidence: Object.freeze(commandResult.data.evidence.map((item) => Object.freeze({
      ...item,
      ...(item.kind === 'source_confirmation' ? {
        claim_ids: Object.freeze([...item.claim_ids]),
        source_ref_ids: Object.freeze([...item.source_ref_ids]),
      } : {}),
      ...(item.kind === 'git_merge' ? { changed_paths: Object.freeze([...item.changed_paths]) } : {}),
    }))),
  });
  const originalCommand = validatedCommand as KnowledgeTransitionCommand;

  let authorization: KnowledgeTransitionAuthorizationResult;
  try {
    authorization = authorizer.authorize(principal, validatedKnowledge, originalCommand);
  } catch {
    return { ok: false, kind: 'authorization', message: 'Authorization failed' };
  }
  if (!authorization.ok) {
    return { ok: false, kind: 'authorization', message: sanitizeBoundaryReason(authorization.reason) };
  }
  if (
    principal.actor.actor_id !== authorization.actor.actor_id
    || principal.actor.actor_type !== authorization.actor.actor_type
    || authorization.actor.actor_id !== originalCommand.actor.actor_id
    || authorization.actor.actor_type !== originalCommand.actor.actor_type
  ) {
    return { ok: false, kind: 'authorization', message: 'Command actor does not match authenticated actor' };
  }

  let trustedResult: TrustedKnowledgeTransitionResult;
  try {
    const rawTrustedResult = evidenceVerifier.verify(validatedKnowledge, originalCommand);
    const parsedTrustedResult = trustedKnowledgeTransitionResultSchema.safeParse(rawTrustedResult);
    if (!parsedTrustedResult.success) {
      return { ok: false, kind: 'evidence', message: 'Evidence verifier returned an invalid result' };
    }
    trustedResult = parsedTrustedResult.data;
  } catch {
    return { ok: false, kind: 'evidence', message: 'Evidence verification failed' };
  }
  if (!trustedResult.ok) {
    return { ok: false, kind: 'evidence', message: sanitizeBoundaryReason(trustedResult.reason) };
  }
  if (!isAttestationForCommand(originalCommand, trustedResult)) {
    return { ok: false, kind: 'evidence', message: 'Verifier attestation does not match the transition evidence' };
  }

  const verifiedCommandResult = knowledgeTransitionCommandSchema.safeParse(originalCommand);
  if (!verifiedCommandResult.success) {
    return { ok: false, kind: 'evidence', message: 'Verifier returned an invalid transition command' };
  }
  if (!sameCommandEnvelope(originalCommand, verifiedCommandResult.data)) {
    return { ok: false, kind: 'evidence', message: 'Verifier changed the transition command' };
  }

  const result = transitionKnowledge(validatedKnowledge, verifiedCommandResult.data);
  if (!result.ok) {
    return {
      ok: false,
      kind: 'domain',
      code: result.error.code,
      message: result.error.message,
    };
  }
  return { ok: true, knowledge: result.knowledge, record: result.record };
};
