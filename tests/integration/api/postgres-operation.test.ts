import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { createDurableFakeOperation, runFakeOperationStep } from '../../../apps/api/src/application/durable-fake-operation.js';
import { createPersistentSyntheticTarget } from '../../support/synthetic-persistent-operation-target.js';

const foundation = readFileSync(new URL('../../../apps/api/migrations/001_knowledge_transition_outbox.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../apps/api/migrations/002_durable_fake_operations.sql', import.meta.url), 'utf8');
const digest = `sha256:${'a'.repeat(64)}`;
const command: Parameters<ReturnType<typeof createDurableFakeOperation>['enqueue']>[0] = {
  operationId: 'op-one', idempotencyKey: 'key-one', assetSpaceId: 'space-a',
  knowledgeId: 'fixture-one', assetRevision: 1, expectedDigest: digest, target: 'synthetic-readback',
};
const instances: PGlite[] = [];
const folders: string[] = [];
const adapter = (db: PGlite) => ({ connect: async () => ({
  query: (sql: string, params?: unknown[]) => db.query(sql, params), release() {},
}) }) as unknown as Pick<Pool, 'connect'>;
const setup = async (dir?: string) => {
  const db = dir ? new PGlite(dir) : new PGlite();
  instances.push(db);
  await db.exec(foundation);
  await db.exec(migration);
  await db.query("INSERT INTO asset_spaces VALUES ('space-a', 'team-a'), ('space-b', 'team-b')");
  return { db, store: createDurableFakeOperation(adapter(db)) };
};
afterEach(async () => {
  await Promise.all(instances.splice(0).map((db) => db.close()));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const fakeTarget = () => {
  const operations = new Map<string, typeof command>();
  const evidence = new Map<string, { operationId: string; assetSpaceId: string; knowledgeId: string;
    assetRevision: number; digest: string }>();
  return {
    inspect: async (id: string) => operations.get(id) ?? null,
    submit: async (input: typeof command) => { operations.set(input.operationId, input); },
    readback: async (id: string) => evidence.get(id) ?? null,
    complete: (id: string, change: Partial<NonNullable<ReturnType<typeof evidence.get>>> = {}) => {
      evidence.set(id, { operationId: id, assetSpaceId: 'space-a', knowledgeId: 'fixture-one',
        assetRevision: 1, digest, ...change });
    },
    count: () => operations.size,
  };
};

describe('T08 synthetic PG operation (PGlite, not an external PG/Provider)', () => {
  it('commits operation and delivery intent together, replays exactly and rejects conflicts', async () => {
    const { db, store } = await setup();
    expect(await store.enqueue(command)).toMatchObject({ status: 'queued', replayed: false });
    expect(await store.enqueue(command)).toMatchObject({ status: 'queued', replayed: true });
    await expect(store.enqueue({ ...command, expectedDigest: `sha256:${'b'.repeat(64)}` })).rejects.toThrow();
    await expect(store.enqueue({ ...command, operationId: 'op-two' })).rejects.toThrow();
    expect((await db.query('SELECT * FROM synthetic_operations')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM synthetic_operation_outbox')).rows).toHaveLength(1);
    expect(await store.read('space-b', command.operationId)).toBeNull();
    expect(await store.claim('space-b', 'worker-b', 100, 10)).toBeNull();
    await db.query('DROP TABLE synthetic_operation_outbox');
    await expect(store.enqueue({ ...command, operationId: 'op-new', idempotencyKey: 'key-new' })).rejects.toThrow();
    expect((await db.query('SELECT * FROM synthetic_operations')).rows).toHaveLength(1);
    await expect(store.enqueue({ ...command, operationId: 'op-injected', idempotencyKey: 'key-injected',
      knowledgeId: 'https://not-a-fixture' })).rejects.toThrow();
  });

  it('fences competing claims, late callbacks and mismatched read-back', async () => {
    const { store } = await setup();
    await store.enqueue(command);
    const first = (await store.claim('space-a', 'worker-a', 100, 10))!;
    expect(await store.claim('space-a', 'worker-b', 109, 10)).toBeNull();
    const second = (await store.claim('space-a', 'worker-b', 110, 10))!;
    expect(second.version).toBeGreaterThan(first.version);
    expect(await store.settle('space-a', 'op-one', 'worker-a', first.version, 111, 1,
      'succeeded', { operationId: 'op-one', assetSpaceId: 'space-a', knowledgeId: 'fixture-one',
        assetRevision: 1, digest })).toBeNull();
    const mismatch = await store.settle('space-a', 'op-one', 'worker-b', second.version, 111, 2,
      'succeeded', { operationId: 'op-one', assetSpaceId: 'space-b', knowledgeId: 'fixture-one',
        assetRevision: 1, digest });
    expect(mismatch?.status).toBe('reconciling');
    expect(await store.settle('space-a', 'op-one', 'worker-b', mismatch!.version, 112, 2,
      'succeeded', { operationId: 'op-one', assetSpaceId: 'space-a', knowledgeId: 'fixture-one',
        assetRevision: 1, digest })).toBeNull();
    expect((await store.read('space-a', 'op-one'))?.status).toBe('reconciling');
  });

  it('keeps independent spaces isolated and only completes with matching fake read-back', async () => {
    const { db, store } = await setup();
    await store.enqueue(command);
    await store.enqueue({ ...command, operationId: 'op-other', idempotencyKey: 'key-other',
      assetSpaceId: 'space-b', knowledgeId: 'fixture-other' });
    const target = fakeTarget();
    expect(await runFakeOperationStep(store, 'space-a', 'worker-a', 1_783_258_000_000, 1000, target))
      .toMatchObject({ status: 'waiting_readback' });
    expect(target.count()).toBe(1);
    expect((await store.read('space-b', 'op-other'))?.status).toBe('queued');
    expect(await store.claim('space-b', 'worker-b', 1_783_258_000_000, 1000))
      .toMatchObject({ operationId: 'op-other' });
    target.complete('op-one');
    expect(await runFakeOperationStep(store, 'space-a', 'worker-next', 1_783_258_001_000, 1000, target))
      .toMatchObject({ status: 'succeeded' });
    expect(target.count()).toBe(1);
    expect(await store.claim('space-a', 'worker-late', 1_783_258_002_000, 1000)).toBeNull();
    expect((await db.query<{ delivery_status: string }>(`SELECT delivery_status FROM synthetic_operation_outbox
      WHERE operation_id = 'op-one'`)).rows[0]?.delivery_status).toBe('delivered');
  });

  it('reopens a committed operation in another process without duplicating an accepted fake effect', async () => {
    const folder = mkdtempSync(join(tmpdir(), 't08-pglite-'));
    folders.push(folder);
    const { db, store } = await setup(folder);
    await store.enqueue(command);
    await db.close();
    instances.splice(instances.indexOf(db), 1);
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import { PGlite } from '@electric-sql/pglite';
      import { createDurableFakeOperation } from './apps/api/src/application/durable-fake-operation.ts';
      const db = new PGlite(process.argv[1]);
      const store = createDurableFakeOperation({connect: async () => ({query: (sql, params) => db.query(sql, params), release() {}})});
      const item = await store.read('space-a', 'op-one');
      if (item?.status !== 'queued') process.exitCode = 1;
      await db.close();
    `, folder], { cwd: process.cwd(), encoding: 'utf8' });
    expect(child.status, child.stderr).toBe(0);
    const reopened = new PGlite(folder);
    instances.push(reopened);
    const recovered = createDurableFakeOperation(adapter(reopened));
    const target = fakeTarget();
    const accepted = { ...command };
    await target.submit(accepted); // Accepted before the response was lost; the Worker instance did not survive.
    expect(await runFakeOperationStep(recovered, 'space-a', 'worker-new', 100, 10, target))
      .toMatchObject({ status: 'waiting_readback' });
    expect(target.count()).toBe(1);
    target.complete('op-one', { digest: `sha256:${'b'.repeat(64)}` });
    expect(await runFakeOperationStep(recovered, 'space-a', 'worker-later', 111, 10, target))
      .toMatchObject({ status: 'reconciling' });
    expect(target.count()).toBe(1);
    expect((await recovered.read('space-a', 'op-one'))?.status).toBe('reconciling');
    expect(await runFakeOperationStep(recovered, 'space-a', 'worker-next', 121, 10, target))
      .toMatchObject({ status: 'reconciling' });
  });

  it.each(['matched', 'missing', 'mismatch', 'other-space', 'unknown'] as const)(
    'reclaims after a Worker exits after target acceptance with %s readback', async (readback) => {
    const operationFolder = mkdtempSync(join(tmpdir(), 'synthetic-operation-'));
    const targetFolder = mkdtempSync(join(tmpdir(), 'synthetic-target-'));
    folders.push(operationFolder, targetFolder);
    const { db, store } = await setup(operationFolder);
    await store.enqueue(command);
    await db.close();
    instances.splice(instances.indexOf(db), 1);

    const worker = (phase: string, now: number) => spawnSync(process.execPath,
      ['--import', 'tsx', 'tests/support/synthetic-operation-worker.ts', phase,
        operationFolder, targetFolder, String(now)], { cwd: process.cwd(), encoding: 'utf8' });
    const crashed = worker('crash-after-accept', 100);
    expect(crashed.status, crashed.stderr).toBe(73);

    const firstDb = new PGlite(operationFolder);
    instances.push(firstDb);
    const firstStore = createDurableFakeOperation(adapter(firstDb));
    const oldLease = (await firstStore.read('space-a', 'op-one'))!;
    expect(oldLease).toMatchObject({ status: 'running', leaseToken: 'worker-first' });
    expect(await firstStore.claim('space-a', 'worker-early', 109, 10)).toBeNull();
    expect((await firstDb.query<{ delivery_status: string }>(
      'SELECT delivery_status FROM synthetic_operation_outbox WHERE operation_id = $1', ['op-one'],
    )).rows[0]?.delivery_status).toBe('pending');
    await firstDb.close();
    instances.splice(instances.indexOf(firstDb), 1);

    const target = createPersistentSyntheticTarget(targetFolder);
    expect(target.submitCount('op-one')).toBe(1);
    await expect(target.inspect('op-one')).resolves.toEqual(command);
    if (readback !== 'missing' && readback !== 'unknown') target.complete('op-one', {
      operationId: 'op-one', assetSpaceId: readback === 'other-space' ? 'space-b' : 'space-a',
      knowledgeId: 'fixture-one', assetRevision: 1,
      digest: readback === 'mismatch' ? `sha256:${'b'.repeat(64)}` : digest,
    });
    target.close();

    const resumed = worker(readback === 'unknown' ? 'resume-unknown' : 'resume', 110);
    expect(resumed.status, resumed.stderr).toBe(0);
    const finalDb = new PGlite(operationFolder);
    instances.push(finalDb);
    const finalStore = createDurableFakeOperation(adapter(finalDb));
    const status = readback === 'matched' ? 'succeeded'
      : readback === 'missing' ? 'waiting_readback'
        : readback === 'unknown' ? 'unknown' : 'reconciling';
    expect((await finalStore.read('space-a', 'op-one'))?.status).toBe(status);
    const current = (await finalStore.read('space-a', 'op-one'))!;
    expect(await finalStore.settle('space-a', 'op-one', current.leaseToken ?? 'worker-next',
      current.version, 111, current.callbackSequence, 'succeeded',
      { operationId: 'op-one', assetSpaceId: 'space-a', knowledgeId: 'fixture-one',
        assetRevision: 1, digest })).toBeNull();
    expect((await finalStore.read('space-a', 'op-one'))?.status).toBe(status);
    expect(await finalStore.settle('space-a', 'op-one', oldLease.leaseToken!, oldLease.version,
      111, 1, 'succeeded', { operationId: 'op-one', assetSpaceId: 'space-a',
        knowledgeId: 'fixture-one', assetRevision: 1, digest })).toBeNull();
    expect((await finalDb.query<{ delivery_status: string }>(
      'SELECT delivery_status FROM synthetic_operation_outbox WHERE operation_id = $1', ['op-one'],
    )).rows[0]?.delivery_status).toBe(readback === 'matched' ? 'delivered' : 'pending');
    expect(await finalStore.read('space-b', 'op-one')).toBeNull();
    const checked = createPersistentSyntheticTarget(targetFolder);
    expect(checked.submitCount('op-one')).toBe(1);
    checked.close();

    if (readback === 'missing' || readback === 'unknown') {
      await finalDb.close();
      instances.splice(instances.indexOf(finalDb), 1);
      const completed = createPersistentSyntheticTarget(targetFolder);
      completed.complete('op-one', { operationId: 'op-one', assetSpaceId: 'space-a',
        knowledgeId: 'fixture-one', assetRevision: 1, digest });
      completed.close();
      const later = worker('resume', 120);
      expect(later.status, later.stderr).toBe(0);
      const laterDb = new PGlite(operationFolder);
      instances.push(laterDb);
      const laterStore = createDurableFakeOperation(adapter(laterDb));
      expect((await laterStore.read('space-a', 'op-one'))?.status).toBe('succeeded');
      expect((await laterDb.query<{ delivery_status: string }>(
        'SELECT delivery_status FROM synthetic_operation_outbox WHERE operation_id = $1', ['op-one'],
      )).rows[0]?.delivery_status).toBe('delivered');
      const verified = createPersistentSyntheticTarget(targetFolder);
      expect(verified.submitCount('op-one')).toBe(1);
      verified.close();
    }
  });
});
