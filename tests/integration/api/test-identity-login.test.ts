import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { createApiServer } from '../../../apps/api/src/server.js';
import { createTestIdentityApi } from '../../../apps/api/src/test-identity-api.js';

const migration = (name: string) => readFileSync(new URL(`../../../apps/api/migrations/${name}`, import.meta.url), 'utf8');
const servers = new Set<ReturnType<typeof createApiServer>>();
const instances = new Set<PGlite>();
const password = randomBytes(32).toString('base64url');
const digest = (text: string) => {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(text, salt, 64).toString('hex')}`;
};

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.clear();
  await Promise.all([...instances].map((instance) => instance.close()));
  instances.clear();
});

async function setup() {
  const db = new PGlite();
  instances.add(db);
  for (const name of ['001_knowledge_transition_outbox.sql', '003_asset_space_authorization_bindings.sql',
    '004_workbench_identity_sessions.sql', '005_test_login_attempts.sql',
    '006_identity_revocation_epoch.sql', '007_test_login_identity_epoch.sql']) await db.exec(migration(name));
  await db.query("INSERT INTO asset_spaces VALUES ('space-a', 'team-a'), ('space-b', 'team-b')");
  await db.query("INSERT INTO workbench_identity_bindings (issuer, subject, principal_id) VALUES ('urn:workbench:local-test', 'memberA', 'principal-a'), ('urn:workbench:local-test', 'memberB', 'principal-b')");
  await db.query("INSERT INTO team_memberships VALUES ('principal-a', 'team-a', 'active'), ('principal-b', 'team-b', 'active')");
  await db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-a', 'reviewer'), ('principal-b', 'team-b', 'space-b', 'reviewer')");
  const database = { connect: async () => ({ query: (sql: string, params?: unknown[]) => db.query(sql, params), release() {} }) } as unknown as Pick<Pool, 'connect'>;
  const api = createTestIdentityApi({ database, environment: 'isolated-test', accounts: { memberA: digest(password), memberB: digest(password) } });
  const server = createApiServer(api);
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  const origin = `http://127.0.0.1:${address.port}`;
  const post = (path: string, payload: object, headers: Record<string, string> = {}) => fetch(origin + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload),
  });
  const start = async (account = 'memberA') => {
    const secret = randomBytes(32).toString('base64url');
    const hostId = randomBytes(32).toString('base64url');
    const response = await post('/test-identity/attempts', { account, claimSecret: secret, hostId, environment: 'isolated-test' });
    expect(response.status).toBe(201);
    const body = await response.json() as { attemptId: string; loginPath: string };
    return { ...body, secret, hostId };
  };
  return { db, origin, post, start };
}

describe('localhost TEST identity backend', () => {
  it('expires pre-migration sessions and attempts when upgrading the TEST schema', async () => {
    const db = new PGlite();
    instances.add(db);
    for (const name of ['001_knowledge_transition_outbox.sql', '003_asset_space_authorization_bindings.sql',
      '004_workbench_identity_sessions.sql', '005_test_login_attempts.sql']) await db.exec(migration(name));
    await db.query("INSERT INTO workbench_identity_bindings (issuer, subject, principal_id) VALUES ('urn:workbench:local-test', 'memberA', 'principal-a')");
    await db.query(`INSERT INTO workbench_sessions (handle_digest, principal_id, host_id, environment, expires_at)
      VALUES ($1, 'principal-a', 'host-a', 'isolated-test', CURRENT_TIMESTAMP + INTERVAL '5 minutes')`,
    [`sha256:${'0'.repeat(64)}`]);
    await db.query(`INSERT INTO test_login_attempts (attempt_id, claim_digest, host_id, environment, csrf_digest, subject, principal_id, expires_at)
      VALUES ('attempt-a', 'digest', 'host-a', 'isolated-test', 'csrf', 'memberA', 'principal-a', CURRENT_TIMESTAMP + INTERVAL '5 minutes')`);
    await db.exec(migration('006_identity_revocation_epoch.sql'));
    await db.exec(migration('007_test_login_identity_epoch.sql'));
    expect((await db.query<{ revoked_at: string | null }>('SELECT revoked_at FROM workbench_sessions')).rows[0]?.revoked_at).not.toBeNull();
    expect((await db.query<{ valid: boolean }>('SELECT expires_at > CURRENT_TIMESTAMP AS valid FROM test_login_attempts')).rows[0]?.valid).toBe(false);
  });

  it('keeps auth disabled when API dependencies are absent', async () => {
    const server = createApiServer();
    servers.add(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing port');
    const response = await fetch(`http://127.0.0.1:${address.port}/test-identity/attempts`, { method: 'POST' });
    expect(response.status).toBe(404);
  });

  it('logs in two distinct members without sending session handles to the browser', async () => {
    const { origin, post, start } = await setup();
    for (const [account, team, space, forbidden] of [
      ['memberA', 'team-a', 'space-a', 'space-b'], ['memberB', 'team-b', 'space-b', 'space-a'],
    ]) {
      const attempt = await start(account);
      const page = await fetch(origin + attempt.loginPath);
      expect(page.status).toBe(200);
      expect(page.headers.get('cache-control')).toBe('no-store');
      const pageText = await page.text();
      expect(pageText).not.toContain(attempt.secret);
      const csrf = page.headers.get('set-cookie')?.split(';')[0];
      expect(csrf).toBeTruthy();
      const csrfToken = /name="csrf" type="hidden" value="([^"]+)"/.exec(pageText)?.[1];
      expect(csrfToken).toBeTruthy();
      const login = await fetch(origin + attempt.loginPath, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie: csrf! },
        body: new URLSearchParams({ account: account!, password, csrf: csrfToken! }).toString(),
      });
      expect(login.status).toBe(200);
      expect(await login.text()).not.toContain(attempt.secret);
      const claim = await post(`/test-identity/attempts/${attempt.attemptId}/claim`, { claimSecret: attempt.secret, hostId: attempt.hostId, environment: 'isolated-test' });
      expect(claim.status).toBe(200);
      const { sessionHandle } = await claim.json() as { sessionHandle: string };
      const context = async (assetSpaceId?: string) => fetch(`${origin}/v1/context${assetSpaceId ? `?teamId=${team}&assetSpaceId=${assetSpaceId}` : ''}`, {
        headers: { authorization: `Bearer ${sessionHandle}`, 'x-workbench-host': attempt.hostId },
      });
      expect(await (await context()).json()).toMatchObject({ ok: true, spaces: [{ teamId: team, assetSpaceId: space }] });
      expect((await context(forbidden)).status).toBe(403);
      expect((await fetch(`${origin}/v1/context`, {
        headers: { authorization: `Bearer ${sessionHandle}`, 'x-workbench-host': randomBytes(32).toString('base64url') },
      })).status).toBe(401);
      expect((await post(`/test-identity/attempts/${attempt.attemptId}/claim`, { claimSecret: attempt.secret, hostId: attempt.hostId, environment: 'isolated-test' })).status).toBe(403);
      const logout = await post('/test-identity/logout', {}, { authorization: `Bearer ${sessionHandle}`, 'x-workbench-host': attempt.hostId });
      expect(logout.status).toBe(204);
      expect((await context()).status).toBe(401);
    }
  });

  it('rejects wrong password, absent browser origin and cross-account claims', async () => {
    const { origin, db, post, start } = await setup();
    const attempt = await start();
    const page = await fetch(origin + attempt.loginPath);
    const token = /test_csrf=([A-Za-z0-9_-]{43})/.exec(page.headers.get('set-cookie') ?? '')?.[1];
    expect(token).toBeTruthy();
    const form = (value: string) => new URLSearchParams({ account: 'memberA', password: value, csrf: token! }).toString();
    const headers = { cookie: `test_csrf=${token}`, 'content-type': 'application/x-www-form-urlencoded' };
    expect((await fetch(origin + attempt.loginPath, { method: 'POST', headers, body: form(password) })).status).toBe(403);
    expect((await fetch(origin + attempt.loginPath, { method: 'POST', headers: { ...headers, origin }, body: form('wrong') })).status).toBe(403);
    expect((await post(`/test-identity/attempts/${attempt.attemptId}/claim`, { claimSecret: 'guessed', hostId: attempt.hostId, environment: 'isolated-test' })).status).toBe(403);
    for (let i = 0; i < 4; i++) await fetch(origin + attempt.loginPath, { method: 'POST', headers: { ...headers, origin }, body: form('wrong') });
    expect((await fetch(origin + attempt.loginPath, { method: 'POST', headers: { ...headers, origin }, body: form(password) })).status).toBe(403);
    const fresh = await start('memberB');
    expect((await post(`/test-identity/attempts/${fresh.attemptId}/claim`, { claimSecret: attempt.secret, hostId: attempt.hostId, environment: 'isolated-test' })).status).toBe(403);
    await db.query("UPDATE test_login_attempts SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE attempt_id = $1", [fresh.attemptId]);
    expect((await fetch(origin + fresh.loginPath)).status).toBe(403);
  });

  it('rejects claim after identity is disabled and revokes a previous same-host session on switching', async () => {
    const { db, origin, post, start } = await setup();
    const login = async (attempt: Awaited<ReturnType<typeof start>>) => {
      const page = await fetch(origin + attempt.loginPath);
      const csrf = /test_csrf=([A-Za-z0-9_-]{43})/.exec(page.headers.get('set-cookie') ?? '')?.[1];
      expect(csrf).toBeTruthy();
      const result = await fetch(origin + attempt.loginPath, {
        method: 'POST', headers: { origin, cookie: `test_csrf=${csrf}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ account: 'memberA', password, csrf: csrf! }),
      });
      expect(result.status).toBe(200);
    };
    const first = await start();
    await login(first);
    await db.query("UPDATE workbench_identity_bindings SET status = 'disabled' WHERE subject = 'memberA'");
    expect((await post(`/test-identity/attempts/${first.attemptId}/claim`, { claimSecret: first.secret, hostId: first.hostId, environment: 'isolated-test' })).status).toBe(403);
    await db.query("UPDATE workbench_identity_bindings SET status = 'active' WHERE subject = 'memberA'");
    expect((await post(`/test-identity/attempts/${first.attemptId}/claim`,
      { claimSecret: first.secret, hostId: first.hostId, environment: 'isolated-test' })).status).toBe(403);
    const replacement = await start();
    await login(replacement);
    const claimed = await post(`/test-identity/attempts/${replacement.attemptId}/claim`,
      { claimSecret: replacement.secret, hostId: replacement.hostId, environment: 'isolated-test' });
    expect(claimed.status).toBe(200);
    const { sessionHandle } = await claimed.json() as { sessionHandle: string };
    const secondSecret = randomBytes(32).toString('base64url');
    const started = await post('/test-identity/attempts', { account: 'memberA', claimSecret: secondSecret, hostId: replacement.hostId, environment: 'isolated-test' });
    const second = await started.json() as { attemptId: string; loginPath: string };
    await login({ ...second, secret: secondSecret, hostId: replacement.hostId });
    expect((await post(`/test-identity/attempts/${second.attemptId}/claim`, { claimSecret: secondSecret, hostId: replacement.hostId, environment: 'isolated-test' })).status).toBe(200);
    expect((await fetch(origin + '/v1/context', { headers: { authorization: `Bearer ${sessionHandle}`, 'x-workbench-host': replacement.hostId } })).status).toBe(401);
  });

  it('keeps old sessions and completed attempts revoked after disabling and re-enabling identity', async () => {
    const { db, origin, post, start } = await setup();
    const login = async () => {
      const attempt = await start();
      const page = await fetch(origin + attempt.loginPath);
      const csrf = /test_csrf=([A-Za-z0-9_-]{43})/.exec(page.headers.get('set-cookie') ?? '')?.[1];
      const result = await fetch(origin + attempt.loginPath, {
        method: 'POST', headers: { origin, cookie: `test_csrf=${csrf}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ account: 'memberA', password, csrf: csrf! }),
      });
      expect(result.status).toBe(200);
      return attempt;
    };
    const first = await login();
    const session = await post(`/test-identity/attempts/${first.attemptId}/claim`,
      { claimSecret: first.secret, hostId: first.hostId, environment: 'isolated-test' });
    expect(session.status).toBe(200);
    const { sessionHandle } = await session.json() as { sessionHandle: string };
    const pending = await login();
    await db.query("UPDATE workbench_identity_bindings SET status = 'disabled' WHERE subject = 'memberA'");
    await db.query("UPDATE workbench_identity_bindings SET status = 'active' WHERE subject = 'memberA'");
    expect((await fetch(origin + '/v1/context', {
      headers: { authorization: `Bearer ${sessionHandle}`, 'x-workbench-host': first.hostId },
    })).status).toBe(401);
    expect((await post(`/test-identity/attempts/${pending.attemptId}/claim`,
      { claimSecret: pending.secret, hostId: pending.hostId, environment: 'isolated-test' })).status).toBe(403);
    const identity = await db.query<{ revocation_epoch: string }>(
      "SELECT revocation_epoch FROM workbench_identity_bindings WHERE subject = 'memberA'");
    expect(Number(identity.rows[0]?.revocation_epoch)).toBe(1);
    const fresh = await login();
    expect((await post(`/test-identity/attempts/${fresh.attemptId}/claim`,
      { claimSecret: fresh.secret, hostId: fresh.hostId, environment: 'isolated-test' })).status).toBe(200);
  });

  it('switches A to B for one host and rejects the old handle and cross-space reads', async () => {
    const { origin, post } = await setup();
    const hostId = randomBytes(32).toString('base64url');
    const login = async (account: 'memberA' | 'memberB') => {
      const secret = randomBytes(32).toString('base64url');
      const started = await post('/test-identity/attempts', { account, hostId, claimSecret: secret, environment: 'isolated-test' });
      expect(started.status).toBe(201);
      const { attemptId, loginPath } = await started.json() as { attemptId: string; loginPath: string };
      const page = await fetch(origin + loginPath);
      const csrf = /test_csrf=([A-Za-z0-9_-]{43})/.exec(page.headers.get('set-cookie') ?? '')?.[1];
      const result = await fetch(origin + loginPath, {
        method: 'POST', headers: { origin, cookie: `test_csrf=${csrf}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ account, password, csrf: csrf! }),
      });
      expect(result.status).toBe(200);
      const claimed = await post(`/test-identity/attempts/${attemptId}/claim`, { claimSecret: secret, hostId, environment: 'isolated-test' });
      expect(claimed.status).toBe(200);
      return (await claimed.json() as { sessionHandle: string }).sessionHandle;
    };
    const context = (handle: string, team?: string, space?: string) => fetch(
      `${origin}/v1/context${team && space ? `?teamId=${team}&assetSpaceId=${space}` : ''}`,
      { headers: { authorization: `Bearer ${handle}`, 'x-workbench-host': hostId } },
    );
    const first = await login('memberA');
    expect((await context(first, 'team-b', 'space-b')).status).toBe(403);
    const second = await login('memberB');
    expect((await context(first)).status).toBe(401);
    expect(await (await context(second)).json()).toMatchObject({ spaces: [{ teamId: 'team-b', assetSpaceId: 'space-b' }] });
    expect((await context(second, 'team-a', 'space-a')).status).toBe(403);
    expect((await post('/test-identity/logout', {}, { authorization: `Bearer ${second}`, 'x-workbench-host': hostId })).status).toBe(204);
    expect((await context(second)).status).toBe(401);
  });

  it('rejects CSRF mismatch, stale replay, wrong host and environment, and expired claims', async () => {
    const { db, origin, post, start } = await setup();
    const attempt = await start();
    const page = await fetch(origin + attempt.loginPath);
    const csrf = /test_csrf=([A-Za-z0-9_-]{43})/.exec(page.headers.get('set-cookie') ?? '')?.[1];
    expect(csrf).toBeTruthy();
    const login = (token: string, cookie = csrf!) => fetch(origin + attempt.loginPath, {
      method: 'POST', headers: { origin, cookie: `test_csrf=${cookie}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ account: 'memberA', password, csrf: token }),
    });
    expect((await login(csrf!, 'invalid')).status).toBe(403);
    const refreshed = await fetch(origin + attempt.loginPath);
    const newCsrf = /test_csrf=([A-Za-z0-9_-]{43})/.exec(refreshed.headers.get('set-cookie') ?? '')?.[1];
    expect(newCsrf).toBeTruthy();
    expect((await login(csrf!)).status).toBe(403);
    expect((await login(newCsrf!, newCsrf!)).status).toBe(200);
    expect((await login(newCsrf!, newCsrf!)).status).toBe(403);
    const claimPath = `/test-identity/attempts/${attempt.attemptId}/claim`;
    const claim = (hostId: string, environment: string) => post(claimPath, { claimSecret: attempt.secret, hostId, environment });
    expect((await claim(randomBytes(32).toString('base64url'), 'isolated-test')).status).toBe(403);
    expect((await claim(attempt.hostId, 'other')).status).toBe(403);
    await db.query("UPDATE test_login_attempts SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE attempt_id = $1", [attempt.attemptId]);
    expect((await claim(attempt.hostId, 'isolated-test')).status).toBe(403);
  });

  it('rechecks current memberships and roles without changing identity-based authentication', async () => {
    const { db, origin, post, start } = await setup();
    const attempt = await start();
    const page = await fetch(origin + attempt.loginPath);
    const csrf = /test_csrf=([A-Za-z0-9_-]{43})/.exec(page.headers.get('set-cookie') ?? '')?.[1];
    expect(csrf).toBeTruthy();
    const login = await fetch(origin + attempt.loginPath, {
      method: 'POST', headers: { origin, cookie: `test_csrf=${csrf}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ account: 'memberA', password, csrf: csrf! }),
    });
    expect(login.status).toBe(200);
    const claim = await post(`/test-identity/attempts/${attempt.attemptId}/claim`, { claimSecret: attempt.secret, hostId: attempt.hostId, environment: 'isolated-test' });
    expect(claim.status).toBe(200);
    const { sessionHandle } = await claim.json() as { sessionHandle: string };
    const context = () => fetch(origin + '/v1/context', { headers: { authorization: `Bearer ${sessionHandle}`, 'x-workbench-host': attempt.hostId } });
    await db.query("UPDATE team_memberships SET status = 'disabled' WHERE actor_id = 'principal-a'");
    expect(await (await context()).json()).toMatchObject({ spaces: [] });
    await db.query("UPDATE team_memberships SET status = 'active' WHERE actor_id = 'principal-a'");
    await db.query("DELETE FROM knowledge_role_bindings WHERE actor_id = 'principal-a'");
    expect(await (await context()).json()).toMatchObject({ spaces: [] });
    await db.query("UPDATE workbench_identity_bindings SET status = 'disabled' WHERE subject = 'memberA'");
    expect((await context()).status).toBe(401);
  });

  it('prevents repeated login POST after completion under concurrent submissions', async () => {
    const { origin, start } = await setup();
    const attempt = await start();
    const page = await fetch(origin + attempt.loginPath);
    const csrf = /test_csrf=([A-Za-z0-9_-]{43})/.exec(page.headers.get('set-cookie') ?? '')?.[1];
    expect(csrf).toBeTruthy();
    const submit = () => fetch(origin + attempt.loginPath, {
      method: 'POST', headers: { origin, cookie: `test_csrf=${csrf}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ account: 'memberA', password, csrf: csrf! }),
    });
    expect((await Promise.all([submit(), submit()])).map((result) => result.status).sort()).toEqual([200, 403]);
  });

  it('keeps unauthorized and write routes closed and refuses claimed host fields', async () => {
    const { origin } = await setup();
    const response = await fetch(origin + '/v1/context', { headers: { 'x-actor-id': 'principal-a', 'x-team-id': 'team-a' } });
    expect(response.status).toBe(401);
    expect((await fetch(origin + '/v1/spaces/space-a/knowledge/transitions', { method: 'POST' })).status).toBe(404);
    expect((await fetch(origin + '/test-identity/attempts', { method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await fetch(origin + '/test-identity/attempts', { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await fetch(origin + '/test-identity/attempts', { method: 'POST', headers: { forwarded: 'for=unknown', 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await fetch(origin + '/test-identity/logout', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await fetch(origin + '/v1/context', { headers: { origin } })).status).toBe(403);
    expect((await fetch(origin + '/v1/context', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await fetch(origin + '/v1/context?actorId=principal-a')).status).toBe(403);
    expect((await fetch(origin + '/test-identity/attempts?claimSecret=guessed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await fetch(origin + '/test-identity/attempts', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{}' })).status).toBe(403);
  });
});
