import { readFileSync } from 'node:fs';
import { createServer, get } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import * as oidc from 'openid-client';
import { parseWebOidcRuntime, startWebOidcServer } from '../../../apps/api/scripts/web-oidc.js';

const migration = (name: string) => readFileSync(new URL(`../../../apps/api/migrations/${name}`, import.meta.url), 'utf8');
const databases = new Set<PGlite>();
const servers = new Set<ReturnType<typeof createServer>>();
afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.clear();
  await Promise.all([...databases].map((database) => database.close())); databases.clear();
});

const configuration = (issuer = settings.WORKBENCH_WEB_ISSUER) => new oidc.Configuration({
  issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
  jwks_uri: `${issuer}/jwks`, id_token_signing_alg_values_supported: ['RS256'],
}, settings.WORKBENCH_WEB_CLIENT_ID, { id_token_signed_response_alg: 'RS256' }, oidc.None());

async function fixture(migrated = true) {
  const db = new PGlite(); databases.add(db);
  if (migrated) for (const name of ['001_knowledge_transition_outbox.sql', '003_asset_space_authorization_bindings.sql',
    '004_workbench_identity_sessions.sql', '006_identity_revocation_epoch.sql', '008_web_oidc_login.sql']) {
    await db.exec(migration(name));
  }
  const database = {
    query: (sql: string, params?: unknown[]) => db.query(sql, params),
    connect: async () => ({ query: (sql: string, params?: unknown[]) => db.query(sql, params), release() {} }),
  } as unknown as Pool;
  return database;
}

async function start(database: Pool, config = configuration()) {
  const server = await startWebOidcServer({ ...parseWebOidcRuntime(settings), port: 0 }, config, database);
  servers.add(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected local test port');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

const publicRequest = (url: string, headers: Record<string, string> = {}) => new Promise<{ status: number; body: string; location: string | undefined }>((resolve, reject) => {
  get(url, { headers: { host: 'workbench.example.test', ...headers } }, (response) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.on('end', () => resolve({ status: response.statusCode ?? 0,
      body: Buffer.concat(chunks).toString(), location: response.headers.location }));
    response.on('error', reject);
  }).on('error', reject);
});

const settings = {
  WORKBENCH_WEB_OIDC: '1',
  WORKBENCH_WEB_ISSUER: 'https://id.example.test/issuer',
  WORKBENCH_WEB_CLIENT_ID: 'workbench-test',
  WORKBENCH_WEB_ORIGIN: 'https://workbench.example.test',
  WORKBENCH_WEB_ENVIRONMENT: 'approved-test',
  WORKBENCH_WEB_DATABASE_URL: 'postgresql://test:private@db.example.test/workbench?sslmode=verify-full',
  WORKBENCH_WEB_PORT: '3411',
};

describe('explicit Web OIDC server configuration', () => {
  it('requires explicit enablement and fixed HTTPS settings before any connection', () => {
    expect(() => parseWebOidcRuntime({})).toThrow();
    expect(parseWebOidcRuntime(settings)).toEqual({
      issuer: settings.WORKBENCH_WEB_ISSUER, clientId: settings.WORKBENCH_WEB_CLIENT_ID,
      origin: settings.WORKBENCH_WEB_ORIGIN,
      redirectUri: `${settings.WORKBENCH_WEB_ORIGIN}/auth/callback`,
      environment: settings.WORKBENCH_WEB_ENVIRONMENT,
      databaseUrl: settings.WORKBENCH_WEB_DATABASE_URL, port: 3411,
    });
  });

  it('starts the explicitly wired handler only with the expected schema and issuer', async () => {
    const database = await fixture();
    const { url } = await start(database);
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
    const page = await publicRequest(`${url}/auth`);
    expect(page.status).toBe(200);
    expect(page.body).toContain('当前有权空间');
    const login = await publicRequest(`${url}/auth/login`);
    expect(login.status).toBe(302);
    expect(login.location).toContain('https://id.example.test/issuer/authorize');
    expect((await fetch(`${url}/v1/context`)).status).toBe(404);
  });

  it('rejects wrong public Host and any forwarded-header names before creating login state', async () => {
    const database = await fixture();
    const { url } = await start(database);
    for (const path of ['/auth', '/auth/login']) {
      expect((await publicRequest(`${url}${path}`, { host: 'foreign.example.test' })).status).toBe(401);
      for (const name of ['forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for',
        'x-forwarded-port', 'x-forwarded-prefix']) {
        for (const value of ['https', '']) {
          expect((await publicRequest(`${url}${path}`, { [name]: value })).status).toBe(401);
        }
      }
    }
    expect((await database.query('SELECT COUNT(*)::integer AS count FROM web_oidc_attempts')).rows[0])
      .toEqual({ count: 0 });
  });

  it('rejects incomplete schema and mismatched issuer before listening', async () => {
    const database = await fixture(false);
    await expect(startWebOidcServer({ ...parseWebOidcRuntime(settings), port: 0 }, configuration(), database)).rejects.toThrow();
    expect((await database.query("SELECT to_regclass('web_oidc_attempts') AS name")).rows[0]).toEqual({ name: null });
    const ready = await fixture();
    await expect(startWebOidcServer({ ...parseWebOidcRuntime(settings), port: 0 },
      configuration('https://other.example.test'), ready)).rejects.toThrow('Invalid Web OIDC configuration');
  });

  it('does not create a server when database readiness fails', async () => {
    const connection = { query: async () => { throw new Error('storage unavailable'); } } as unknown as Pool;
    await expect(startWebOidcServer({ ...parseWebOidcRuntime(settings), port: 0 }, configuration(), connection))
      .rejects.toThrow('storage unavailable');
  });

  it('rejects missing, malformed or insecure identity, database and public origin settings', () => {
    for (const bad of [
      { WORKBENCH_WEB_OIDC: '0' }, { WORKBENCH_WEB_CLIENT_ID: '' }, { WORKBENCH_WEB_ENVIRONMENT: '' },
      { WORKBENCH_WEB_ISSUER: 'http://id.example.test/issuer' },
      { WORKBENCH_WEB_ISSUER: 'https://user@id.example.test/issuer' },
      { WORKBENCH_WEB_ISSUER: 'https://id.example.test/issuer?x=1' },
      { WORKBENCH_WEB_ISSUER: 'https://id.example.test/.well-known/openid-configuration' },
      { WORKBENCH_WEB_ORIGIN: 'http://workbench.example.test' },
      { WORKBENCH_WEB_ORIGIN: 'https://workbench.example.test/path' },
      { WORKBENCH_WEB_ORIGIN: 'https://workbench.example.test/' },
      { WORKBENCH_WEB_DATABASE_URL: 'postgresql://test:private@db.example.test/workbench?sslmode=no-verify' },
      { WORKBENCH_WEB_DATABASE_URL: 'postgresql://test:private@db.example.test/workbench?sslmode=verify-full&sslmode=disable' },
      { WORKBENCH_WEB_DATABASE_URL: 'postgresql://test:private@db.example.test/workbench?sslmode=verify-full&sslrootcert=/tmp/ca.pem' },
      { WORKBENCH_WEB_DATABASE_URL: 'postgresql://db.example.test/workbench?sslmode=verify-full' },
      { WORKBENCH_WEB_DATABASE_URL: 'http://db.example.test/workbench' },
      { WORKBENCH_WEB_DATABASE_URL: '' }, { WORKBENCH_WEB_PORT: '0' },
      { WORKBENCH_WEB_PORT: '90000' }, { WORKBENCH_WEB_PORT: '3411x' },
    ]) expect(() => parseWebOidcRuntime({ ...settings, ...bad })).toThrow();
  });
});
