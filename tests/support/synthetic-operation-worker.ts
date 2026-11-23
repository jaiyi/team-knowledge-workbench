import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { createDurableFakeOperation, runFakeOperationStep } from '../../apps/api/src/application/durable-fake-operation.js';
import { createPersistentSyntheticTarget } from './synthetic-persistent-operation-target.js';

const [phase, operationDirectory, targetDirectory, timestamp] = process.argv.slice(2);
if ((phase !== 'crash-after-accept' && phase !== 'resume' && phase !== 'resume-unknown')
  || !operationDirectory || !targetDirectory
  || !timestamp || !Number.isSafeInteger(Number(timestamp))) throw new Error('Invalid synthetic Worker test arguments');

const db = new PGlite(operationDirectory);
const target = createPersistentSyntheticTarget(targetDirectory);
const store = createDurableFakeOperation({ connect: async () => ({
  query: (sql: string, params?: unknown[]) => db.query(sql, params), release() {},
}) } as unknown as Pick<Pool, 'connect'>);
const port = phase === 'crash-after-accept' ? {
  inspect: target.inspect,
  readback: target.readback,
  submit: async (command: Parameters<typeof target.submit>[0]) => {
    await target.submit(command);
    target.close();
    process.exit(73);
  },
} : phase === 'resume-unknown' ? {
  inspect: target.inspect,
  submit: target.submit,
  readback: async () => { throw new Error('Synthetic readback unavailable'); },
} : target;

try {
  const result = await runFakeOperationStep(store, 'space-a', phase === 'crash-after-accept' ? 'worker-first' : 'worker-next',
    Number(timestamp), 10, port);
  if (phase === 'crash-after-accept' || !result || !['succeeded', 'waiting_readback', 'unknown', 'reconciling']
    .includes(result.status)) process.exitCode = 1;
} finally {
  if (phase === 'resume' || phase === 'resume-unknown') target.close();
  await db.close();
}
