import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { AuthenticatedPrincipal, KnowledgeEvidenceVerifier } from '../../../packages/contracts/src/index.js';
import { recordKnowledgeTransition } from '../../../apps/api/src/application/record-knowledge-transition.js';

const digest = `sha256:${'a'.repeat(64)}`;
const knowledge = {
  knowledge_id: 'knowledge.quality.assembly-policy', version: '1.0.0', status: 'captured',
  team_id: 'team-a', asset_space_id: 'space-a', asset_repository_id: 'repo-a',
  repo_path: 'knowledge/quality/assembly-policy/torque-review/', taxonomy_version: 'v1',
  expected_acl_digest: digest, claims_confirmed: false, owner_id: 'owner-a', steward_id: 'steward-a',
  evidence_level: 'E1', sensitivity: 'internal',
  sources: [{ source_ref_id: 'src_1', kind: 'document', locator: 'fixture://source', content_digest: digest }],
  content: { conclusion: 'synthetic', claims: [{ claim_id: 'claim_1', kind: 'rule', statement: 'synthetic', source_refs: ['src_1'], confirmation: 'pending' }],
    applies_to: [], not_applies_to: [], inferences: [], unknowns: [] },
  asset_revision: 1, state_version: 0, created_at: '2026-10-15T09:00:00Z', updated_at: '2026-10-15T09:00:00Z',
} as const;
const command = {
  transition_id: 'transition-1', idempotency_key: 'idempotency-1', correlation_id: 'correlation-1',
  asset_space_id: 'space-a', to: 'candidate', actor: { actor_id: 'human-1', actor_type: 'human' },
  reason: 'synthetic', expected_state_version: 0, expected_asset_revision: 1,
  evidence: [{ kind: 'source_confirmation', reference: 'source/1', claim_ids: ['claim_1'], source_ref_ids: ['src_1'] }],
  occurred_at: '2026-10-15T09:10:00Z',
} as const;
const principal: AuthenticatedPrincipal = {
  actor: { actor_id: 'human-1', actor_type: 'human' }, team_ids: ['team-a'],
  asset_space_ids: ['space-a'], roles: ['steward'],
};
const verifier: KnowledgeEvidenceVerifier = {
  verify: (_asset, received) => ({
    ok: true, attestation: { evidence_fingerprint: JSON.stringify(received.evidence) },
  }),
};

type State = { status: string; state_version: number; asset_revision: number; asset_digest: string;
  team_id: string; asset_space_id: string; knowledge_id: string };
type Event = { transition_id: string; idempotency_key: string; command_digest: string;
  knowledge_id: string; team_id: string; asset_space_id: string; actor_id: string; state_version: number };

const recordingDatabase = () => {
  const committed = {
    state: { knowledge_id: knowledge.knowledge_id, team_id: 'team-a', asset_space_id: 'space-a',
      status: 'captured', state_version: 0, asset_revision: 1,
      asset_digest: `sha256:${createHash('sha256').update(JSON.stringify(knowledge)).digest('hex')}` } as State,
    events: [] as Event[], outbox: [] as string[],
  };
  let transaction: typeof committed | null = null;
  let binding = true;
  let failOutbox = false;
  let conflictConstraint: string | null = null;
  const statements: string[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      statements.push(sql.trim().split(/\s+/u)[0]!.toUpperCase());
      if (sql === 'BEGIN') {
        transaction = structuredClone(committed);
        return { rows: [], rowCount: null };
      }
      if (sql === 'ROLLBACK') {
        transaction = null;
        return { rows: [], rowCount: null };
      }
      if (sql === 'COMMIT') {
        if (!transaction) throw new Error('No transaction');
        Object.assign(committed, structuredClone(transaction));
        transaction = null;
        return { rows: [], rowCount: null };
      }
      if (!transaction) throw new Error('Query outside transaction');
      if (sql.includes('FROM knowledge_states')) {
        return { rows: params[0] === transaction.state.knowledge_id ? [transaction.state] : [], rowCount: 1 };
      }
      if (sql.includes('FROM knowledge_role_bindings')) {
        return { rows: binding && params[0] === principal.actor.actor_id
          && params[1] === transaction.state.team_id && params[2] === transaction.state.asset_space_id
          && (params[3] as string[]).includes('steward') ? [{ role: 'steward' }] : [], rowCount: 1 };
      }
      if (sql.includes('FROM knowledge_transition_events')) {
        return { rows: transaction.events.filter((item) => item.transition_id === params[0] || item.idempotency_key === params[1])
          .map((item) => ({ ...item, outbox_event_id: transaction!.outbox.includes(item.transition_id) ? item.transition_id : null })), rowCount: 1 };
      }
      if (sql.startsWith('UPDATE knowledge_states')) {
        if (transaction.state.state_version !== params[3] || transaction.state.status !== params[5]) {
          return { rows: [], rowCount: 0 };
        }
        transaction.state.status = params[0] as string;
        transaction.state.state_version = params[1] as number;
        transaction.state.asset_digest = params[6] as string;
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO knowledge_transition_events')) {
        if (conflictConstraint) {
          throw Object.assign(new Error('synthetic unique constraint failure'), {
            code: '23505', constraint: conflictConstraint,
          });
        }
        transaction.events.push({ transition_id: params[0] as string, idempotency_key: params[1] as string,
          command_digest: params[2] as string, knowledge_id: params[4] as string, team_id: params[5] as string,
          asset_space_id: params[6] as string, actor_id: params[7] as string, state_version: params[10] as number });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO knowledge_outbox')) {
        if (failOutbox) throw new Error('synthetic database failure');
        transaction.outbox.push(params[0] as string);
        return { rows: [], rowCount: 1 };
      }
      throw new Error('Unexpected query');
    },
    release() {},
  };
  return {
    database: { connect: async () => client } as unknown as Pick<Pool, 'connect'>,
    committed, statements,
    revoke: () => { binding = false; },
    failOutbox: () => { failOutbox = true; },
    failEventConstraint: (constraint: string) => { conflictConstraint = constraint; },
  };
};

describe('internal PostgreSQL transition transaction (recording client, not real PG)', () => {
  it('records only scoped state, event and outbox together', async () => {
    const db = recordingDatabase();
    expect(await recordKnowledgeTransition(db.database, principal, knowledge, command, verifier))
      .toEqual({ ok: true, transitionId: 'transition-1', stateVersion: 1, replayed: false });
    expect(db.committed.state).toMatchObject({ status: 'candidate', state_version: 1 });
    expect(db.committed.events).toHaveLength(1);
    expect(db.committed.outbox).toEqual(['transition-1']);
    expect(db.statements.at(-1)).toBe('COMMIT');
    expect(JSON.stringify(db.committed)).not.toContain('synthetic');
  });

  it('requires an authenticated principal and matching actor without touching the database', async () => {
    const db = recordingDatabase();
    expect((await recordKnowledgeTransition(db.database, null, knowledge, command, verifier)).ok).toBe(false);
    expect((await recordKnowledgeTransition(db.database, principal, knowledge,
      { ...command, actor: { actor_id: 'other', actor_type: 'human' } }, verifier)).ok).toBe(false);
    expect(db.statements).toHaveLength(0);
  });

  it('denies another team, space and role before verifying evidence', async () => {
    const db = recordingDatabase();
    let called = false;
    const deniedVerifier: KnowledgeEvidenceVerifier = { verify: () => { called = true; throw new Error('must not run'); } };
    for (const changed of [
      { ...principal, team_ids: ['team-b'] },
      { ...principal, asset_space_ids: ['space-b'] },
      { ...principal, roles: ['reviewer'] as const },
    ]) {
      const result = await recordKnowledgeTransition(db.database, changed, knowledge, command, deniedVerifier);
      expect(result).toMatchObject({ ok: false, kind: 'authorization' });
    }
    expect(called).toBe(false);
    expect(db.committed.events).toHaveLength(0);
  });

  it('checks current grants and rejects a principal snapshot after revocation', async () => {
    const db = recordingDatabase();
    db.revoke();
    const result = await recordKnowledgeTransition(db.database, principal, knowledge, command, verifier);
    expect(result).toMatchObject({ ok: false, kind: 'authorization' });
    expect(db.committed.outbox).toHaveLength(0);
  });

  it('does not let a new database grant borrow a role missing from the principal snapshot', async () => {
    const db = recordingDatabase();
    const stalePrincipal = { ...principal, roles: ['reviewer'] as const };
    expect(await recordKnowledgeTransition(db.database, stalePrincipal, knowledge, command, verifier))
      .toMatchObject({ ok: false, kind: 'authorization' });
  });

  it('rolls back event and state on outbox write failure', async () => {
    const db = recordingDatabase();
    db.failOutbox();
    expect(await recordKnowledgeTransition(db.database, principal, knowledge, command, verifier))
      .toEqual({ ok: false, kind: 'database', message: 'Knowledge transition could not be recorded' });
    expect(db.committed.state).toMatchObject({ status: 'captured', state_version: 0 });
    expect(db.committed.events).toHaveLength(0);
    expect(db.committed.outbox).toHaveLength(0);
    expect(db.statements.at(-1)).toBe('ROLLBACK');
  });

  it('maps event identifier uniqueness failures to conflicts while retaining rollback', async () => {
    for (const constraint of ['knowledge_transition_events_pkey', 'knowledge_transition_events_idempotency_key_key']) {
      const db = recordingDatabase();
      db.failEventConstraint(constraint);
      expect(await recordKnowledgeTransition(db.database, principal, knowledge, command, verifier))
        .toEqual({ ok: false, kind: 'conflict', message: 'Conflicting Knowledge transition' });
      expect(db.committed.state).toMatchObject({ status: 'captured', state_version: 0 });
      expect(db.committed.events).toHaveLength(0);
      expect(db.statements.at(-1)).toBe('ROLLBACK');
    }
    const db = recordingDatabase();
    db.failEventConstraint('other_unique_constraint');
    expect(await recordKnowledgeTransition(db.database, principal, knowledge, command, verifier))
      .toMatchObject({ ok: false, kind: 'database' });
  });

  it('replays the identical transition without new event or outbox and rejects a conflicting replay', async () => {
    const db = recordingDatabase();
    await recordKnowledgeTransition(db.database, principal, knowledge, command, verifier);
    expect(await recordKnowledgeTransition(db.database, principal, knowledge, command, verifier))
      .toEqual({ ok: true, transitionId: command.transition_id, stateVersion: 1, replayed: true });
    expect(await recordKnowledgeTransition(db.database, principal, knowledge,
      { ...command, reason: 'changed' }, verifier)).toMatchObject({ ok: false, kind: 'conflict' });
    expect(db.committed.events).toHaveLength(1);
    expect(db.committed.outbox).toHaveLength(1);
  });

  it('does not acknowledge a replay if the event has no outbox row', async () => {
    const db = recordingDatabase();
    await recordKnowledgeTransition(db.database, principal, knowledge, command, verifier);
    db.committed.outbox.length = 0;
    expect(await recordKnowledgeTransition(db.database, principal, knowledge, command, verifier))
      .toMatchObject({ ok: false, kind: 'conflict' });
  });

  it('rejects tampered asset content with unchanged state metadata', async () => {
    const db = recordingDatabase();
    const changed = { ...knowledge, content: { ...knowledge.content, conclusion: 'different synthetic text' } };
    expect(await recordKnowledgeTransition(db.database, principal, changed, command, verifier))
      .toMatchObject({ ok: false, kind: 'conflict' });
    expect(db.committed.outbox).toHaveLength(0);
  });

  it('returns a generic database error when the connection fails', async () => {
    const unavailable = { connect: async () => { throw new Error('connection details must not escape'); } } as unknown as Pick<Pool, 'connect'>;
    expect(await recordKnowledgeTransition(unavailable, principal, knowledge, command, verifier))
      .toEqual({ ok: false, kind: 'database', message: 'Knowledge transition could not be recorded' });
  });

  it('rejects stale state and untrusted evidence before writing event or outbox', async () => {
    const db = recordingDatabase();
    const stale = await recordKnowledgeTransition(db.database, principal,
      { ...knowledge, state_version: 1 }, command, verifier);
    expect(stale).toMatchObject({ ok: false, kind: 'conflict' });
    const denied = await recordKnowledgeTransition(db.database, principal, knowledge, command,
      { verify: () => ({ ok: false, reason: 'untrusted' }) });
    expect(denied).toMatchObject({ ok: false, kind: 'evidence' });
    expect(db.committed.events).toHaveLength(0);
  });
});
