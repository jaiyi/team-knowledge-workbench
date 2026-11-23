import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { createDurableFakeOperation } from '../../../apps/api/src/application/durable-fake-operation.js';

const foundation = readFileSync(new URL('../../../apps/api/migrations/001_knowledge_transition_outbox.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../apps/api/migrations/002_durable_fake_operations.sql', import.meta.url), 'utf8');
const expectedDatabase = process.env.WORKBENCH_PG_TEST_DATABASE;
const schemas = process.env.WORKBENCH_PG_TEST_SCHEMAS?.split(',') ?? [];
const connection = {
  host: '127.0.0.1', port: 5432, database: expectedDatabase,
  user: process.env.WORKBENCH_PG_TEST_USER,
  ssl: false, connectionTimeoutMillis: 5000,
};
const command = {
  operationId: 'op-one', idempotencyKey: 'key-one', assetSpaceId: 'space-a',
  knowledgeId: 'fixture-one', assetRevision: 1,
  expectedDigest: `sha256:${'a'.repeat(64)}`, target: 'synthetic-readback' as const,
};
let admin: Pool;

const requireIsolatedTarget = () => {
  if (process.env.WORKBENCH_PG_TEST !== '1' || expectedDatabase !== 'knowledge_workbench'
    || connection.user !== 'workbench_synthetic_operation_runner' || schemas.length !== 4
    || new Set(schemas).size !== 4 || !schemas.every((schema) => /^synthetic_operation_case_[0-9a-f]{32}$/.test(schema))) {
    throw new Error('Explicit isolated synthetic operation test target, dedicated role and four schemas required');
  }
  if (process.env.PGHOST || process.env.PGPORT || process.env.PGDATABASE || process.env.PGUSER
    || process.env.PGOPTIONS || process.env.PGSERVICE || process.env.DATABASE_URL) {
    throw new Error('Unexpected libpq or application database target overrides');
  }
};

const assertTarget = async (pool: Pool, schema: string) => {
  const result = await pool.query<{ database: string; role: string; schema: string; version: string;
    search_path: string; database_create: boolean; schema_create: boolean;
    public_create: boolean; unexpected_schema_access: boolean }>(`
    SELECT current_database() AS database, current_user AS role, current_schema() AS schema,
      current_setting('server_version') AS version, current_setting('search_path') AS search_path,
      has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
      has_schema_privilege(current_user, $1, 'CREATE') AS schema_create,
      has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
      EXISTS (SELECT 1 FROM pg_namespace WHERE nspname <> ALL($2::text[])
        AND nspname <> 'public' AND nspname <> 'information_schema'
        AND nspname NOT IN ('pg_catalog', 'pg_toast')
        AND left(nspname, 8) <> 'pg_temp_' AND left(nspname, 14) <> 'pg_toast_temp_'
        AND (has_schema_privilege(current_user, oid, 'USAGE')
          OR has_schema_privilege(current_user, oid, 'CREATE'))) AS unexpected_schema_access`, [schema, schemas]);
  const row = result.rows[0];
  assert.ok(row);
  assert.equal(row.database, expectedDatabase);
  assert.equal(row.role, 'workbench_synthetic_operation_runner');
  assert.equal(row.schema, schema);
  assert.equal(row.search_path, schema);
  assert.ok(row.version.startsWith('16.'));
  assert.equal(row.database_create, false);
  assert.equal(row.schema_create, true);
  assert.equal(row.public_create, false);
  assert.equal(row.unexpected_schema_access, false);
};
const poolFor = (schema: string) => new Pool({ ...connection, max: 4, options: `-c search_path=${schema}` });

if (process.argv[2] === '--readback') {
  requireIsolatedTarget();
  const schema = process.env.WORKBENCH_PG_TEST_SCHEMA;
  if (!schema || schema !== schemas[0]) throw new Error('Unexpected readback schema');
  const pool = poolFor(schema);
  try {
    await assertTarget(pool, schema);
    const item = await createDurableFakeOperation(pool).read('space-a', command.operationId);
    const outbox = await pool.query<{ delivery_status: string }>(
      'SELECT delivery_status FROM synthetic_operation_outbox WHERE operation_id = $1', [command.operationId],
    );
    console.log(JSON.stringify({ item, outbox: outbox.rows[0]?.delivery_status }));
  } finally { await pool.end(); }
  process.exit(0);
}

before(async () => {
  requireIsolatedTarget();
  admin = poolFor(schemas[0]!);
  await assertTarget(admin, schemas[0]!);
  const available = await admin.query<{ name: string; owner: string; relations: number }>(`
    SELECT n.nspname AS name, r.rolname AS owner,
      (SELECT count(*)::int FROM pg_class c WHERE c.relnamespace = n.oid) AS relations
    FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
    WHERE n.nspname = ANY($1::text[])`, [schemas]);
  assert.equal(available.rows.length, schemas.length);
  for (const row of available.rows) {
    assert.equal(row.owner, 'workbench_synthetic_operation_runner');
    assert.equal(row.relations, 0);
  }
});
after(async () => { await admin?.end(); });

const setup = async (schema: string) => {
  const pool = poolFor(schema);
  try {
    await assertTarget(pool, schema);
    const existing = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM pg_class WHERE relnamespace = $1::regnamespace', [schema]);
    assert.equal(existing.rows[0]?.count, 0, 'Synthetic operation test schema must be empty');
    await pool.query(foundation);
    await pool.query(migration);
    await pool.query("INSERT INTO asset_spaces VALUES ('space-a', 'team-a'), ('space-b', 'team-b')");
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
};

describe('opt-in isolated PostgreSQL 16 synthetic operations (pre-created schemas only)', () => {
  it('commits operation and outbox, then reads them through a new process', async () => {
    const pool = await setup(schemas[0]!);
    const store = createDurableFakeOperation(pool);
    try {
      assert.equal((await store.enqueue(command)).replayed, false);
    } finally { await pool.end(); }
    const output = execFileSync(process.execPath, [process.argv[1]!, '--readback'], {
      env: { ...process.env, WORKBENCH_PG_TEST_SCHEMA: schemas[0] }, encoding: 'utf8', timeout: 15000,
    });
    const result = JSON.parse(output);
    assert.equal(result.item.status, 'queued');
    assert.equal(result.item.operationId, command.operationId);
    assert.equal(result.outbox, 'pending');
  });

  it('serializes independent connections claiming the same job and fences late responses', async () => {
    const pool = await setup(schemas[1]!);
    try {
      const store = createDurableFakeOperation(pool);
      await store.enqueue(command);
      const [first, second] = await Promise.all([
        store.claim('space-a', 'worker-a', 100, 10), store.claim('space-a', 'worker-b', 100, 10),
      ]);
      assert.equal([first, second].filter(Boolean).length, 1);
      const winner = first ?? second!;
      const late = await store.claim('space-a', 'worker-next', 110, 10);
      assert.ok(late);
      assert.equal(await store.settle('space-a', command.operationId, winner.leaseToken!, winner.version,
        111, 1, 'succeeded', { operationId: 'op-one', assetSpaceId: 'space-a', knowledgeId: 'fixture-one',
          assetRevision: 1, digest: command.expectedDigest }), null);
      const mismatch = await store.settle('space-a', command.operationId, 'worker-next', late.version,
        111, 2, 'succeeded', { operationId: 'op-one', assetSpaceId: 'space-b', knowledgeId: 'fixture-one',
          assetRevision: 1, digest: command.expectedDigest });
      assert.equal(mismatch?.status, 'reconciling');
      assert.equal((await pool.query<{ delivery_status: string }>(
        'SELECT delivery_status FROM synthetic_operation_outbox',
      )).rows[0]?.delivery_status, 'pending');
      assert.equal(await store.read('space-b', 'op-one'), null);
    } finally { await pool.end(); }
  });

  it('replays concurrent identical enqueues without duplicate operations or outbox intents', async () => {
    const pool = await setup(schemas[2]!);
    try {
      const store = createDurableFakeOperation(pool);
      const [a, b] = await Promise.all([store.enqueue(command), store.enqueue(command)]);
      assert.deepEqual([a.replayed, b.replayed].sort(), [false, true]);
      assert.equal((await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM synthetic_operations',
      )).rows[0]?.count, 1);
      assert.equal((await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM synthetic_operation_outbox',
      )).rows[0]?.count, 1);
      await assert.rejects(store.enqueue({ ...command, expectedDigest: `sha256:${'b'.repeat(64)}` }));
    } finally { await pool.end(); }
  });

  it('rolls back the operation when an outbox insert fails inside the isolated schema', async () => {
    const pool = await setup(schemas[3]!);
    try {
      const store = createDurableFakeOperation(pool);
      await pool.query(`CREATE FUNCTION reject_synthetic_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic outbox failure'; END $$`);
      await pool.query(`CREATE TRIGGER reject_insert BEFORE INSERT ON synthetic_operation_outbox
        FOR EACH ROW EXECUTE FUNCTION reject_synthetic_outbox()`);
      await assert.rejects(store.enqueue(command));
      assert.equal((await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM synthetic_operations',
      )).rows[0]?.count, 0);
    } finally { await pool.end(); }
  });
});
