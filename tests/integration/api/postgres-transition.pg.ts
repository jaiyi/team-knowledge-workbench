import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, afterEach, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import type { AuthenticatedPrincipal, KnowledgeEvidenceVerifier } from '../../../packages/contracts/src/index.js';
import { recordKnowledgeTransition } from '../../../apps/api/src/application/record-knowledge-transition.js';

const migration = readFileSync(new URL('../../../apps/api/migrations/001_knowledge_transition_outbox.sql', import.meta.url), 'utf8');
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

const connection = {
  host: '127.0.0.1', port: 5432, database: 'workbench_p0',
  user: process.env.WORKBENCH_PG_TEST_USER,
  ssl: false, connectionTimeoutMillis: 5000,
};
const instances: { schema: string; pool: Pool; ended: boolean }[] = [];
let admin: Pool;

if (process.argv[2] === '--readback') {
  const schema = process.env.WORKBENCH_PG_TEST_SCHEMA;
  if (process.env.WORKBENCH_PG_TEST !== '1' || !/^p0_test_[0-9a-f_]{36}$/.test(schema ?? '')
    || connection.user !== 'workbench_p0_runner') {
    throw new Error('Isolated PostgreSQL readback role required');
  }
  const pool = new Pool({ ...connection, options: `-c search_path=${schema}` });
  try {
    const activeSchema = await pool.query<{ schema: string }>('SELECT current_schema() AS schema');
    assert.equal(activeSchema.rows[0]?.schema, schema);
    const state = await pool.query('SELECT status, state_version FROM knowledge_states');
    const events = await pool.query('SELECT count(*)::int AS count FROM knowledge_transition_events');
    const outbox = await pool.query('SELECT count(*)::int AS count FROM knowledge_outbox');
    console.log(JSON.stringify({ state: state.rows, events: events.rows[0]?.count, outbox: outbox.rows[0]?.count }));
  } finally {
    await pool.end();
  }
  process.exit(0);
}

before(async () => {
  if (process.env.WORKBENCH_PG_TEST !== '1' || connection.user !== 'workbench_p0_runner') {
    throw new Error('Explicit opt-in and isolated PostgreSQL role are required');
  }
  admin = new Pool(connection);
  const result = await admin.query<{ database: string; role: string; version: string }>(
    'SELECT current_database() AS database, current_user AS role, current_setting(\'server_version\') AS version',
  );
  if (result.rows[0]?.database !== 'workbench_p0' || result.rows[0].role !== 'workbench_p0_runner'
    || !result.rows[0].version.startsWith('16.')) {
    throw new Error('Expected isolated workbench_p0 PostgreSQL 16 test role');
  }
});

afterEach(async () => {
  for (const { schema, pool, ended } of instances.splice(0)) {
    if (!ended) await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
});

after(async () => {
  await admin?.end();
});

const setup = async () => {
  const schema = `p0_test_${randomUUID().replaceAll('-', '_')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ ...connection, max: 4, options: `-c search_path=${schema}` });
  instances.push({ schema, pool, ended: false });
  const activeSchema = await pool.query<{ schema: string }>('SELECT current_schema() AS schema');
  if (activeSchema.rows[0]?.schema !== schema) throw new Error('Test schema was not selected');
  await pool.query(migration);
  await pool.query("INSERT INTO asset_spaces VALUES ('space-a', 'team-a'), ('space-b', 'team-b')");
  await pool.query("INSERT INTO knowledge_role_bindings VALUES ('human-1', 'team-a', 'space-a', 'steward')");
  const assetDigest = `sha256:${createHash('sha256').update(JSON.stringify(knowledge)).digest('hex')}`;
  await pool.query('INSERT INTO knowledge_states VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [knowledge.knowledge_id, knowledge.team_id, knowledge.asset_space_id, knowledge.status,
      knowledge.state_version, knowledge.asset_revision, assetDigest]);
  return { pool, schema };
};

describe('opt-in external PostgreSQL 16 (synthetic data only)', () => {
  it('runs the repository migration and reads committed state in a new process', async () => {
    const { pool, schema } = await setup();
    assert.deepEqual(await recordKnowledgeTransition(pool, principal, knowledge, command, verifier),
      { ok: true, transitionId: command.transition_id, stateVersion: 1, replayed: false });
    await pool.end();
    instances[0]!.ended = true;
    const output = execFileSync(process.execPath, [process.argv[1]!, '--readback'], {
      env: {
        WORKBENCH_PG_TEST: '1', WORKBENCH_PG_TEST_USER: connection.user,
        WORKBENCH_PG_TEST_SCHEMA: schema,
      }, encoding: 'utf8', timeout: 15000 });
    assert.deepEqual(JSON.parse(output), { state: [{ status: 'candidate', state_version: 1 }], events: 1, outbox: 1 });
  });

  it('rejects cross-team and revoked bindings even if the caller claims a role', async () => {
    const { pool } = await setup();
    const otherTeam: AuthenticatedPrincipal = { ...principal, team_ids: ['team-b'], asset_space_ids: ['space-b'] };
    assert.deepEqual(await recordKnowledgeTransition(pool, otherTeam, knowledge, command, verifier),
      { ok: false, kind: 'authorization', message: 'Not authorized for Knowledge transition' });
    await pool.query("DELETE FROM knowledge_role_bindings WHERE actor_id = 'human-1'");
    assert.deepEqual(await recordKnowledgeTransition(pool, principal, knowledge, command, verifier),
      { ok: false, kind: 'authorization', message: 'Not authorized for Knowledge transition' });
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM knowledge_transition_events')).rows[0]?.count, 0);
  });

  it('serializes concurrent retries on separate pool clients', async () => {
    const { pool } = await setup();
    const locker = await pool.connect();
    await locker.query('BEGIN');
    await locker.query('SELECT 1 FROM knowledge_states WHERE knowledge_id = $1 FOR UPDATE', [knowledge.knowledge_id]);
    const pending = Promise.all([
      recordKnowledgeTransition(pool, principal, knowledge, command, verifier),
      recordKnowledgeTransition(pool, principal, knowledge, command, verifier),
    ]);
    try {
      let lockCount = 0;
      for (let attempt = 0; lockCount < 2 && attempt < 300; attempt++) {
        const waiting = await admin.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_stat_activity
           WHERE datname = 'workbench_p0' AND usename = 'workbench_p0_runner' AND wait_event_type = 'Lock'`,
        );
        lockCount = waiting.rows[0]?.count ?? 0;
        if (lockCount < 2) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(lockCount, 2);
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
    }
    const results = await pending;
    assert.ok(results.some((result) => result.ok && !result.replayed));
    assert.ok(results.some((result) => result.ok && result.replayed));
    assert.deepEqual(await recordKnowledgeTransition(pool, principal, knowledge,
      { ...command, transition_id: 'transition-2' }, verifier),
    { ok: false, kind: 'conflict', message: 'Conflicting Knowledge transition' });
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM knowledge_outbox')).rows[0]?.count, 1);
  });

  it('rolls back state and event when an isolated outbox insert fails', async () => {
    const { pool } = await setup();
    await pool.query(`CREATE FUNCTION reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic outbox failure'; END $$`);
    await pool.query('CREATE TRIGGER fail_outbox BEFORE INSERT ON knowledge_outbox FOR EACH ROW EXECUTE FUNCTION reject_outbox()');
    assert.deepEqual(await recordKnowledgeTransition(pool, principal, knowledge, command, verifier),
      { ok: false, kind: 'database', message: 'Knowledge transition could not be recorded' });
    assert.deepEqual((await pool.query('SELECT status, state_version FROM knowledge_states')).rows,
      [{ status: 'captured', state_version: 0 }]);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM knowledge_transition_events')).rows[0]?.count, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM knowledge_outbox')).rows[0]?.count, 0);
  });
});
