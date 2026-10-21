import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import type { AuthenticatedPrincipal, KnowledgeEvidenceVerifier } from '../../../packages/contracts/src/index.js';
import { recordKnowledgeTransition } from '../../../apps/api/src/application/record-knowledge-transition.js';

const migration = readFileSync(fileURLToPath(new URL('../../../apps/api/migrations/001_knowledge_transition_outbox.sql', import.meta.url)), 'utf8');
const digest = `sha256:${'a'.repeat(64)}`;
const knowledge = {
  knowledge_id: 'knowledge.test.case', version: '1.0.0', status: 'captured',
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
  transition_id: 'transition-1', idempotency_key: 'idem-1', correlation_id: 'corr-1',
  asset_space_id: 'space-a', to: 'candidate', actor: { actor_id: 'human-1', actor_type: 'human' },
  reason: 'synthetic', expected_state_version: 0, expected_asset_revision: 1,
  evidence: [{ kind: 'source_confirmation', reference: 'source/1', claim_ids: ['claim_1'], source_ref_ids: ['src_1'] }],
  occurred_at: '2026-10-15T09:10:00Z',
} as const;
const principal: AuthenticatedPrincipal = { actor: command.actor, team_ids: ['team-a'],
  asset_space_ids: ['space-a'], roles: ['steward'] };
const verifier: KnowledgeEvidenceVerifier = { verify: (_asset, cmd) => ({
  ok: true, attestation: { evidence_fingerprint: JSON.stringify(cmd.evidence) },
}) };
const instances: PGlite[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map((db) => db.close()));
});

const setup = async () => {
  const db = new PGlite();
  instances.push(db);
  await db.exec(migration);
  await db.query("INSERT INTO asset_spaces VALUES ('space-a', 'team-a'), ('space-b', 'team-b')");
  await db.query("INSERT INTO knowledge_role_bindings VALUES ('human-1', 'team-a', 'space-a', 'steward')");
  const assetDigest = `sha256:${createHash('sha256').update(JSON.stringify(knowledge)).digest('hex')}`;
  await db.query('INSERT INTO knowledge_states VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [knowledge.knowledge_id, knowledge.team_id, knowledge.asset_space_id, knowledge.status,
      knowledge.state_version, knowledge.asset_revision, assetDigest]);
  const database = { connect: async () => ({
    query: (sql: string, params?: unknown[]) => db.query(sql, params), release() {},
  }) } as unknown as Pick<Pool, 'connect'>;
  return { db, database };
};

describe('ephemeral PostgreSQL engine (not external PG or recovery)', () => {
  it('applies the migration, records a transition and replays the same event exactly once', async () => {
    const { db, database } = await setup();
    expect(await recordKnowledgeTransition(database, principal, knowledge, command, verifier))
      .toEqual({ ok: true, transitionId: command.transition_id, stateVersion: 1, replayed: false });
    expect(await recordKnowledgeTransition(database, principal, knowledge, command, verifier))
      .toEqual({ ok: true, transitionId: command.transition_id, stateVersion: 1, replayed: true });
    expect((await db.query('SELECT * FROM knowledge_transition_events')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM knowledge_outbox')).rows).toHaveLength(1);
    await expect(db.query("INSERT INTO knowledge_outbox (event_id, knowledge_id, asset_space_id, state_version) VALUES ('transition-1', 'knowledge.test.case', 'space-b', 1)"))
      .rejects.toThrow();
    expect((await db.query<{ status: string; state_version: number }>('SELECT status, state_version FROM knowledge_states')).rows)
      .toEqual([{ status: 'candidate', state_version: 1 }]);
  });

  it('rejects missing/revoked grants, cross-team association and duplicate identifiers', async () => {
    const { db, database } = await setup();
    await db.query("DELETE FROM knowledge_role_bindings WHERE actor_id = 'human-1'");
    expect(await recordKnowledgeTransition(database, principal, knowledge, command, verifier))
      .toMatchObject({ ok: false, kind: 'authorization' });
    await expect(db.query("INSERT INTO knowledge_role_bindings VALUES ('human-1', 'team-b', 'space-a', 'steward')"))
      .rejects.toThrow();
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('human-1', 'team-a', 'space-a', 'steward')");
    expect((await recordKnowledgeTransition(database, principal, knowledge, command, verifier)).ok).toBe(true);
    expect(await recordKnowledgeTransition(database, principal, knowledge,
      { ...command, idempotency_key: 'different-id' }, verifier))
      .toMatchObject({ ok: false, kind: 'conflict' });
  });

  it('does not commit state or event when the outbox insert fails', async () => {
    const { db, database } = await setup();
    await db.query('DROP TABLE knowledge_outbox');
    expect(await recordKnowledgeTransition(database, principal, knowledge, command, verifier))
      .toMatchObject({ ok: false, kind: 'database' });
    expect((await db.query('SELECT * FROM knowledge_transition_events')).rows).toHaveLength(0);
    expect((await db.query<{ status: string }>('SELECT status FROM knowledge_states')).rows[0]?.status).toBe('captured');
  });
});
