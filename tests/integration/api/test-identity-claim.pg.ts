import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { createApiServer } from '../../../apps/api/src/server.js';
import { createTestIdentityApi } from '../../../apps/api/src/test-identity-api.js';

const connection = {
  host: '127.0.0.1', port: 5432, database: 'workbench_p0',
  user: process.env.WORKBENCH_PG_TEST_USER,
  ssl: false, connectionTimeoutMillis: 5000,
};
const secret = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
let admin: Pool;
let database: Pool;
let schema: string;
let schemaOid: string;

async function assertIsolatedTarget(client: PoolClient) {
  const check = await client.query<{ database: string; role: string; version: string }>(
    "SELECT current_database() AS database, current_user AS role, current_setting('server_version') AS version",
  );
  if (check.rows[0]?.database !== 'workbench_p0' || check.rows[0].role !== 'workbench_p0_runner'
    || !check.rows[0].version.startsWith('16.')) throw new Error('Expected isolated workbench_p0 PostgreSQL 16 test role');
}

before(async () => {
  if (process.env.WORKBENCH_PG_TEST !== '1' || connection.user !== 'workbench_p0_runner') {
    throw new Error('Explicit opt-in and isolated PostgreSQL role are required');
  }
  admin = new Pool(connection);
  const client = await admin.connect();
  try {
    await assertIsolatedTarget(client);
    const created = `p0_test_${randomUUID().replaceAll('-', '_')}`;
    await client.query(`CREATE SCHEMA "${created}"`);
    const createdSchema = await client.query<{ oid: string; owner: string }>(
      'SELECT oid::text AS oid, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = $1', [created],
    );
    if (createdSchema.rows[0]?.owner !== 'workbench_p0_runner') throw new Error('Test schema is not owned by isolated test role');
    schema = created;
    schemaOid = createdSchema.rows[0].oid;
  } finally {
    client.release();
  }
  database = new Pool({ ...connection, max: 4, options: `-c search_path=${schema}` });
  const current = await database.query<{ schema: string }>('SELECT current_schema() AS schema');
  assert.equal(current.rows[0]?.schema, schema);
  for (const name of ['001_knowledge_transition_outbox.sql', '003_asset_space_authorization_bindings.sql',
    '004_workbench_identity_sessions.sql', '005_test_login_attempts.sql',
    '006_identity_revocation_epoch.sql', '007_test_login_identity_epoch.sql']) {
    await database.query(readFileSync(new URL(`../../../apps/api/migrations/${name}`, import.meta.url), 'utf8'));
  }
  await database.query("INSERT INTO workbench_identity_bindings (issuer, subject, principal_id) VALUES ('urn:workbench:local-test', 'memberA', 'principal-a')");
});

after(async () => {
  try {
    await database?.end();
    if (admin && schema && schemaOid) {
      const client = await admin.connect();
      try {
        await assertIsolatedTarget(client);
        const owner = await client.query<{ oid: string; owner: string }>(
          'SELECT oid::text AS oid, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = $1', [schema],
        );
        if (owner.rows[0]?.oid !== schemaOid || owner.rows[0].owner !== 'workbench_p0_runner') {
          throw new Error('Test schema identity or owner changed');
        }
        await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        client.release();
      }
    }
  } finally {
    await admin?.end();
  }
});

describe('opt-in PostgreSQL TEST claim atomicity (synthetic data)', () => {
  it('issues exactly one handle under two simultaneous claims', async () => {
    const attemptId = secret();
    const claimSecret = secret();
    const hostId = secret();
    await database.query(`INSERT INTO test_login_attempts
      (attempt_id, claim_digest, host_id, environment, csrf_digest, subject, principal_id, identity_epoch, expires_at)
      VALUES ($1, $2, $3, 'isolated-test', $4, 'memberA', 'principal-a', 0, CURRENT_TIMESTAMP + INTERVAL '3 minutes')`,
    [attemptId, digest(claimSecret), hostId, digest(secret())]);
    const salt = randomBytes(16).toString('hex');
    const account = `${salt}:${'0'.repeat(128)}`;
    const server = createApiServer(createTestIdentityApi({ database, environment: 'isolated-test', accounts: { memberA: account, memberB: account } }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const origin = `http://127.0.0.1:${address.port}`;
      const claim = () => fetch(`${origin}/test-identity/attempts/${attemptId}/claim`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claimSecret, hostId, environment: 'isolated-test' }),
      });
      const outcomes = await Promise.all([claim(), claim()]);
      assert.deepEqual(outcomes.map((response) => response.status).sort(), [200, 403]);
      const sessions = await database.query<{ count: string }>(
        'SELECT count(*) FROM workbench_sessions WHERE host_id = $1', [hostId]);
      assert.equal(sessions.rows[0]?.count, '1');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('serializes two different completed attempts for the same host', async () => {
    const hostId = secret();
    const first = { attemptId: secret(), claimSecret: secret() };
    const second = { attemptId: secret(), claimSecret: secret() };
    for (const attempt of [first, second]) {
      await database.query(`INSERT INTO test_login_attempts
        (attempt_id, claim_digest, host_id, environment, csrf_digest, subject, principal_id, identity_epoch, expires_at)
        VALUES ($1, $2, $3, 'isolated-test', $4, 'memberA', 'principal-a', 0, CURRENT_TIMESTAMP + INTERVAL '3 minutes')`,
      [attempt.attemptId, digest(attempt.claimSecret), hostId, digest(secret())]);
    }
    const account = `${randomBytes(16).toString('hex')}:${'0'.repeat(128)}`;
    const server = createApiServer(createTestIdentityApi({ database, environment: 'isolated-test', accounts: { memberA: account, memberB: account } }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const origin = `http://127.0.0.1:${address.port}`;
      const claim = (attempt: typeof first) => fetch(`${origin}/test-identity/attempts/${attempt.attemptId}/claim`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claimSecret: attempt.claimSecret, hostId, environment: 'isolated-test' }),
      });
      const responses = await Promise.all([claim(first), claim(second)]);
      assert.deepEqual(responses.map((response) => response.status), [200, 200]);
      const sessions = await database.query<{ live: string }>(
        'SELECT count(*) FILTER (WHERE revoked_at IS NULL)::text AS live FROM workbench_sessions WHERE host_id = $1',
        [hostId]);
      assert.equal(sessions.rows[0]?.live, '1');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
