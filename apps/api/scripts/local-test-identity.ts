import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { createApiServer } from '../src/server.js';
import { createTestIdentityApi } from '../src/test-identity-api.js';

const folder = resolve(process.cwd(), '.tmp/workbench-local-identity');
const configFile = resolve(folder, 'accounts.json');
const dbFolder = resolve(folder, 'pglite');
const environment = 'isolated-test';
const issuer = 'urn:workbench:local-test';
const testMode = process.env.WORKBENCH_LOCAL_TEST_IDENTITY === '1';
if (!testMode || process.env.NODE_ENV === 'production' || process.env.HOST && process.env.HOST !== '127.0.0.1') {
  throw new Error('Explicit loopback-only TEST identity opt-in is required');
}
const command = process.argv[2];
if (command !== 'init' && command !== 'serve') throw new Error('Use init or serve');
if (command === 'init' && process.env.WORKBENCH_LOCAL_TEST_CONFIRM !== 'NEW_ONLY') {
  throw new Error('Set WORKBENCH_LOCAL_TEST_CONFIRM=NEW_ONLY');
}
if (existsSync(folder) && (lstatSync(folder).isSymbolicLink() || !lstatSync(folder).isDirectory()
  || lstatSync(folder).mode & 0o077)) {
  throw new Error('TEST directory must be a private real local directory');
}
if (command === 'init' && (existsSync(configFile) || existsSync(dbFolder))) {
  throw new Error('TEST identity already initialized or incomplete; inspect local directory before retrying');
}
if (command === 'serve' && (!existsSync(configFile) || !existsSync(dbFolder)
  || lstatSync(configFile).isSymbolicLink() || lstatSync(dbFolder).isSymbolicLink())) {
  throw new Error('Initialize a real local TEST database and accounts first');
}
const migration = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const accounts = ['memberA', 'memberB'] as const;
const hash = (password: string) => {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
};
mkdirSync(folder, { recursive: true, mode: 0o700 });
if (command === 'init') mkdirSync(dbFolder, { mode: 0o700 });
const db = new PGlite(dbFolder);
const pool = { connect: async () => ({ query: (sql: string, params?: unknown[]) => db.query(sql, params), release() {} }) } as unknown as Pick<Pool, 'connect'>;

async function initialize() {
  await db.exec('BEGIN');
  try {
    for (const name of ['001_knowledge_transition_outbox.sql', '003_asset_space_authorization_bindings.sql',
      '004_workbench_identity_sessions.sql', '005_test_login_attempts.sql',
      '006_identity_revocation_epoch.sql', '007_test_login_identity_epoch.sql']) await db.exec(migration(name));
    await db.query("INSERT INTO asset_spaces VALUES ('space-a', 'team-a'), ('space-b', 'team-b')");
    for (const [index, account] of accounts.entries()) {
      const principal = `test-principal-${index + 1}`;
      const team = index === 0 ? 'team-a' : 'team-b';
      const space = index === 0 ? 'space-a' : 'space-b';
      await db.query('INSERT INTO workbench_identity_bindings (issuer, subject, principal_id) VALUES ($1, $2, $3)', [issuer, account, principal]);
      await db.query("INSERT INTO team_memberships VALUES ($1, $2, 'active')", [principal, team]);
      await db.query("INSERT INTO knowledge_role_bindings VALUES ($1, $2, $3, 'reviewer')", [principal, team, space]);
    }
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

try {
  if (command === 'init') {
    const passwords = { memberA: randomBytes(32).toString('base64url'), memberB: randomBytes(32).toString('base64url') };
    await initialize();
    try {
      writeFileSync(configFile, JSON.stringify({ memberA: hash(passwords.memberA), memberB: hash(passwords.memberB) }), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      process.stderr.write('TEST database exists without accounts; inspect local directory before retrying.\n');
      throw error;
    }
    process.stdout.write('TEST-only accounts created. Save these passwords privately; they are displayed once.\n');
    process.stdout.write(`memberA: ${passwords.memberA}\nmemberB: ${passwords.memberB}\n`);
  } else {
    if (lstatSync(folder).mode & 0o077 || lstatSync(dbFolder).mode & 0o077) {
      throw new Error('TEST database directory must be private');
    }
    const mode = lstatSync(configFile).mode & 0o777;
    if (mode & 0o077) throw new Error('TEST accounts file must not be group/world readable');
    const config = JSON.parse(readFileSync(configFile, 'utf8')) as { memberA: string; memberB: string };
    const port = Number(process.env.PORT ?? 3407);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TEST port');
    const schema = await db.query<{ identity_epoch: boolean; session_epoch: boolean; attempt_epoch: boolean }>(
      `SELECT
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workbench_identity_bindings' AND column_name = 'revocation_epoch') AS identity_epoch,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workbench_sessions' AND column_name = 'identity_epoch') AS session_epoch,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'test_login_attempts' AND column_name = 'identity_epoch') AS attempt_epoch`);
    if (!schema.rows[0] || schema.rows[0].identity_epoch !== schema.rows[0].session_epoch
      || schema.rows[0].identity_epoch !== schema.rows[0].attempt_epoch) {
      throw new Error('TEST identity revocation migration is incomplete');
    }
    if (!schema.rows[0]?.identity_epoch) {
      await db.exec('BEGIN');
      try {
        await db.exec(migration('006_identity_revocation_epoch.sql'));
        await db.exec(migration('007_test_login_identity_epoch.sql'));
        await db.exec('COMMIT');
      } catch (error) { await db.exec('ROLLBACK'); throw error; }
    }
    await db.query('UPDATE workbench_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL');
    await db.query(`UPDATE test_login_attempts SET expires_at = CURRENT_TIMESTAMP
      WHERE claimed_at IS NULL AND expires_at > CURRENT_TIMESTAMP`);
    const handler = createTestIdentityApi({ database: pool, environment, accounts: config });
    let previous = Promise.resolve();
    const server = createApiServer((request, response) => {
      const result = previous.then(() => handler(request, response));
      previous = result.then(() => undefined, () => undefined);
      return result;
    });
    server.listen(port, '127.0.0.1', () => {
      process.stdout.write('Workbench TEST identity API ready on 127.0.0.1\n');
    });
    process.on('SIGINT', () => server.close(() => { void db.close(); }));
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'TEST identity startup failed'}\n`);
  await db.close();
  process.exitCode = 1;
}
