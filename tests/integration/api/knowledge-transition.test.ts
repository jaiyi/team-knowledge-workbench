import { describe, expect, it } from 'vitest';
import {
  applyKnowledgeTransition,
  type KnowledgeTransitionAuthorizer,
} from '../../../apps/api/src/application/knowledge-transition.js';
import type {
  AuthenticatedPrincipal,
  KnowledgeEvidenceVerifier,
  KnowledgeTransitionCommand,
} from '../../../packages/contracts/src/index.js';

const digest = 'sha256:' + 'a'.repeat(64);
const knowledge = {
  knowledge_id: 'knowledge.quality.assembly-policy', version: '1.0.0', status: 'captured',
  team_id: 'team-a', asset_space_id: 'space-a', asset_repository_id: 'repo-a',
  repo_path: 'knowledge/quality/assembly-policy/torque-review/', taxonomy_version: 'v1',
  expected_acl_digest: digest, claims_confirmed: false, owner_id: 'owner-a', steward_id: 'steward-a',
  evidence_level: 'E1', sensitivity: 'internal',
  sources: [{ source_ref_id: 'src_minutes-1', kind: 'document', locator: 'meeting://one', content_digest: digest }],
  content: { conclusion: '结论', claims: [{ claim_id: 'claim_1', kind: 'rule', statement: '规则', source_refs: ['src_minutes-1'], confirmation: 'pending' }], applies_to: [], not_applies_to: [], inferences: [], unknowns: [] },
  asset_revision: 1, state_version: 0, created_at: '2026-10-15T09:00:00Z', updated_at: '2026-10-15T09:00:00Z',
} as const;

const command = {
  transition_id: 'transition-1', idempotency_key: 'idempotency-1', correlation_id: 'correlation-1',
  asset_space_id: 'space-a', to: 'candidate', actor: { actor_id: 'human-1', actor_type: 'human' },
  reason: 'capture complete', expected_state_version: 0, expected_asset_revision: 1,
  evidence: [{ kind: 'source_confirmation', reference: 'source/1', claim_ids: ['claim_1'], source_ref_ids: ['src_minutes-1'] }],
  occurred_at: '2026-10-15T09:10:00Z',
} as const;

const principal: AuthenticatedPrincipal = {
  actor: { actor_id: 'human-1', actor_type: 'human' },
  team_ids: ['team-a'],
  asset_space_ids: ['space-a'],
  roles: ['steward', 'reviewer', 'publisher'],
};

const authorizer: KnowledgeTransitionAuthorizer = {
  authorize: (authenticatedPrincipal) => ({ ok: true, actor: authenticatedPrincipal.actor }),
};

const structuralVerifier: KnowledgeEvidenceVerifier = {
  verify: () => ({
    ok: false,
    reason: 'structural verifier is not trusted',
  }),
};

const trustedVerifier: KnowledgeEvidenceVerifier = {
  verify: (_receivedKnowledge, receivedCommand) => ({
    ok: true,
    attestation: { evidence_fingerprint: JSON.stringify((receivedCommand as KnowledgeTransitionCommand).evidence) },
  }),
};

const apply = (
  rawKnowledge: unknown = knowledge,
  rawCommand: unknown = command,
  evidenceVerifier: KnowledgeEvidenceVerifier = trustedVerifier,
) => applyKnowledgeTransition(rawKnowledge, rawCommand, principal, authorizer, evidenceVerifier);

describe('Knowledge transition application boundary', () => {
  it('rejects malformed input before invoking the domain', () => {
    expect(apply(null)).toEqual({
      ok: false, kind: 'validation', message: 'Invalid Knowledge asset',
    });
    expect(apply(knowledge, { ...command, extra: true })).toEqual({
      ok: false, kind: 'validation', message: 'Invalid Knowledge transition command',
    });
  });

  it('requires verified evidence before applying a valid command', () => {
    expect(apply().ok).toBe(true);
  });

  it('rejects an unauthorized transition', () => {
    const result = applyKnowledgeTransition(knowledge, command, principal, {
      authorize: () => ({ ok: false, reason: 'actor is not authorized' }),
    }, trustedVerifier);
    expect(result).toEqual({ ok: false, kind: 'authorization', message: 'actor is not authorized' });
  });

  it('returns a structured authorization failure when the authorizer throws', () => {
    const result = applyKnowledgeTransition(knowledge, command, principal, {
      authorize: () => {
        throw new Error('provider response contained secret-like detail');
      },
    }, trustedVerifier);
    expect(result).toEqual({
      ok: false,
      kind: 'authorization',
      message: 'Authorization failed',
    });
  });

  it('rejects an actor claim that differs from the authenticated actor', () => {
    const result = applyKnowledgeTransition(knowledge, {
      ...command,
      actor: { actor_id: 'human-other', actor_type: 'human' },
    }, principal, authorizer, structuralVerifier);
    expect(result).toEqual({
      ok: false,
      kind: 'authorization',
      message: 'Command actor does not match authenticated actor',
    });
  });

  it('rejects an authorizer denial before invoking the verifier', () => {
    let verifierCalled = false;
    const result = applyKnowledgeTransition(knowledge, command, principal, {
      authorize: () => ({ ok: false, reason: 'actor is not a workspace steward' }),
    }, {
      verify: () => {
        verifierCalled = true;
        return { ok: false, reason: 'not reached' };
      },
    });
    expect(result).toEqual({
      ok: false,
      kind: 'authorization',
      message: 'actor is not a workspace steward',
    });
    expect(verifierCalled).toBe(false);
  });

  it('returns a structured evidence failure when the verifier throws', () => {
    const result = apply(knowledge, command, {
      verify: () => {
        throw new Error('provider response contained secret-like detail');
      },
    });
    expect(result).toEqual({ ok: false, kind: 'evidence', message: 'Evidence verification failed' });
  });

  it('rejects a malformed verifier success result', () => {
    const result = apply(knowledge, command, {
      verify: () => ({ ok: true } as never),
    });
    expect(result).toEqual({ ok: false, kind: 'evidence', message: 'Evidence verifier returned an invalid result' });
  });

  it('preserves the domain error code at the application boundary', () => {
    const result = apply(knowledge, { ...command, expected_state_version: 1 });
    expect(result).toEqual({
      ok: false,
      kind: 'domain',
      code: 'STALE_STATE_VERSION',
      message: 'Knowledge state version is stale',
    });
  });

  it('sanitizes authorization failure details', () => {
    const result = applyKnowledgeTransition(knowledge, command, principal, {
      authorize: () => ({ ok: false, reason: 'internal\nprovider path\u0000secret' }),
    }, trustedVerifier);
    expect(result).toEqual({ ok: false, kind: 'authorization', message: 'internal provider path secret' });
  });

  it('rejects evidence that the verifier does not trust', () => {
    const result = apply(knowledge, command, {
      verify: () => ({ ok: false, reason: 'provider evidence was not authenticated' }),
    });
    expect(result).toEqual({ ok: false, kind: 'evidence', message: 'provider evidence was not authenticated' });
  });

  it('isolates validated inputs from verifier mutation attempts', () => {
    let commandMutationBlocked = false;
    let knowledgeMutationBlocked = false;
    const result = apply(knowledge, command, {
      verify: (receivedKnowledge, receivedCommand) => {
        try {
          (receivedCommand as { to: string }).to = 'rejected';
        } catch {
          commandMutationBlocked = true;
        }
        try {
          (receivedKnowledge as { status: string }).status = 'rejected';
        } catch {
          knowledgeMutationBlocked = true;
        }
        return {
          ok: true,
          attestation: { evidence_fingerprint: JSON.stringify((receivedCommand as KnowledgeTransitionCommand).evidence) },
        };
      },
    });
    expect(commandMutationBlocked).toBe(true);
    expect(knowledgeMutationBlocked).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('rejects a verifier success with an invalid command', () => {
    const result = apply(knowledge, command, {
      verify: () => ({
        ok: true,
        attestation: { evidence_fingerprint: 'not-the-command-evidence' },
      }),
    });
    expect(result).toEqual({
      ok: false,
      kind: 'evidence',
      message: 'Verifier attestation does not match the transition evidence',
    });
  });

  it('rejects a verifier that changes evidence', () => {
    const result = apply(knowledge, command, {
      verify: () => ({
        ok: true,
        attestation: { evidence_fingerprint: JSON.stringify([{ forged: true }]) },
      }),
    });
    expect(result).toEqual({
      ok: false,
      kind: 'evidence',
      message: 'Verifier attestation does not match the transition evidence',
    });
  });

  it('parses valid input before applying the transition', () => {
    const result = apply();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.knowledge.status).toBe('candidate');
  });
});
