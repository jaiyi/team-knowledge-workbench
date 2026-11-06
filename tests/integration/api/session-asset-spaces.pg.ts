import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, afterEach, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { digestSessionHandle } from '../../../apps/api/src/application/workbench-session.js';
import { readSessionAssetSpaces } from '../../../apps/api/src/application/read-session-asset-spaces.js';

const connection = {
  host: '127.0.0.1', port: 5432, database: 'workbench_p0',
  user: process.env.WORKBENCH_PG_TEST_USER,
  ssl: false, connectionTimeoutMillis: 5000,
};
const migrations = ['001_knowledge_transition_outbox.sql', '003_asset_space_authorization_bindings.sql',
  '004_workbench_identity_sessions.sql', '006_identity_revocation_epoch.sql'];
const request = { sessionHandle: 'isolated-session-a', hostId: 'host-a', environment: 'isolated-test' };
const selected = { teamId: 'team-a', assetSpaceId: 'space-a' };
const instances: { pool: Pool; schema: string }[] = [];
let admin: Pool;

before(async () => {
  if (process.env.WORKBENCH_PG_TEST !== '1' || connection.user !== 'workbench_p0_runner') {
    throw new Error('Explicit opt-in and isolated PostgreSQL role are required');
  }
  admin = new Pool(connection);
  const result = await admin.query<{ database: string; role: string; version: string }>(
    "SELECT current_database() AS database, current_user AS role, current_setting('server_version') AS version",
  );
  if (result.rows[0]?.database !== 'workbench_p0' || result.rows[0].role !== 'workbench_p0_runner'
    || !result.rows[0].version.startsWith('16.')) {
    throw new Error('Expected isolated workbench_p0 PostgreSQL 16 test role');
  }
});

afterEach(async () => {
  for (const { pool, schema } of instances.splice(0)) {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
});
after(async () => { await admin?.end(); });

async function setup() {
  const schema = `p0_test_${randomUUID().replaceAll('-', '_')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ ...connection, max: 4, options: `-c search_path=${schema}` });
  instances.push({ pool, schema });
  const active = await pool.query<{ schema: string }>('SELECT current_schema() AS schema');
  assert.equal(active.rows[0]?.schema, schema);
  for (const name of migrations) {
    await pool.query(readFileSync(new URL(`../../../apps/api/migrations/${name}`, import.meta.url), 'utf8'));
  }
  await pool.query("INSERT INTO asset_spaces VALUES ('space-a', 'team-a')");
  await pool.query("INSERT INTO team_memberships VALUES ('principal-a', 'team-a', 'active')");
  await pool.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-a', 'steward')");
  await pool.query("INSERT INTO workbench_identity_bindings (issuer, subject, principal_id) VALUES ('https://id.example.invalid', 'person-a', 'principal-a')");
  await pool.query(
    "INSERT INTO workbench_sessions (handle_digest, principal_id, host_id, environment, expires_at) VALUES ($1, 'principal-a', 'host-a', 'isolated-test', CURRENT_TIMESTAMP + INTERVAL '1 hour')",
    [digestSessionHandle(request.sessionHandle)],
  );
  return pool;
}

async function waitForBlockedConnection() {
  for (let attempt = 0; attempt < 300; attempt++) {
    const waiting = await admin.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_stat_activity
       WHERE datname = 'workbench_p0' AND usename = 'workbench_p0_runner' AND wait_event_type = 'Lock'`,
    );
    if ((waiting.rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Expected a blocked independent connection');
}

describe('opt-in PostgreSQL session and grant revocation ordering (synthetic data)', () => {
  for (const [name, update] of [
    ['session', 'UPDATE workbench_sessions SET revoked_at = CURRENT_TIMESTAMP'],
    ['membership', "UPDATE team_memberships SET status = 'disabled'"],
    ['role', 'DELETE FROM knowledge_role_bindings'],
    ['identity', "UPDATE workbench_identity_bindings SET status = 'disabled'"],
  ]) {
    it(`waits for a pending ${name} revocation then denies the selected space`, async () => {
      const pool = await setup();
      const revoker = await pool.connect();
      await revoker.query('BEGIN');
      await revoker.query(update!);
      const pending = readSessionAssetSpaces(pool, request, selected);
      try {
        await waitForBlockedConnection();
      } finally {
        await revoker.query('COMMIT');
        revoker.release();
      }
      assert.deepEqual(await pending, name === 'identity' || name === 'session'
        ? { ok: false, reason: 'unauthenticated' }
        : { ok: false, reason: 'unavailable' });
    });
  }
});
