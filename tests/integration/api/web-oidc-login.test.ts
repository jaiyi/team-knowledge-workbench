import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import * as oidc from 'openid-client';
import { createApiServer } from '../../../apps/api/src/server.js';
import { createWebOidcApi } from '../../../apps/api/src/web-oidc-api.js';
import { digestSessionHandle, resolveWorkbenchSession } from '../../../apps/api/src/application/workbench-session.js';

const migration = (name: string) => readFileSync(new URL(`../../../apps/api/migrations/${name}`, import.meta.url), 'utf8');
const servers = new Set<ReturnType<typeof createServer>>();
const databases = new Set<PGlite>();
const close = (server: ReturnType<typeof createServer>) => new Promise<void>((resolve) => server.close(() => resolve()));
afterEach(async () => {
  await Promise.all([...servers].map(close)); servers.clear();
  await Promise.all([...databases].map((db) => db.close())); databases.clear();
});
const start = async (server: ReturnType<typeof createServer>) => {
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected test port');
  return `http://127.0.0.1:${address.port}`;
};
const cookieJar = (response: Response) => (response.headers.getSetCookie?.() ?? []).map((item) => item.split(';')[0]).join('; ');
const sha = (value: string) => createHash('sha256').update(value).digest('base64url');
const browserNavigation = (url: string, cookie: string) => new Promise<number>((resolve, reject) => {
  const request = httpRequest(url, { headers: { cookie, 'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } }, (response) => {
    response.resume(); response.on('end', () => resolve(response.statusCode ?? 0));
  });
  request.on('error', reject); request.end();
});

async function setup() {
  const db = new PGlite(); databases.add(db);
  for (const name of ['001_knowledge_transition_outbox.sql', '003_asset_space_authorization_bindings.sql',
    '004_workbench_identity_sessions.sql', '006_identity_revocation_epoch.sql', '008_web_oidc_login.sql']) await db.exec(migration(name));
  await db.query("INSERT INTO asset_spaces VALUES ('space-a', 'team-a'), ('space-b', 'team-b')");
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  let issuer = '';
  let availability = true;
  let invalidSignature = false;
  let wrongNonce = false;
  let wrongAudience = false;
  let wrongIssuer = false;
  let wrongPkce = false;
  let expiredToken = false;
  let unknownKey = false;
  let user = 'memberA';
  const codes = new Map<string, { nonce: string; challenge: string; clientId: string; redirect: string }>();
  const issuerServer = createServer(async (request, response) => {
    if (!availability) { response.writeHead(503).end(); return; }
    const url = new URL(request.url ?? '/', issuer);
    if (url.pathname === '/authorize') {
      const code = randomBytes(32).toString('base64url');
      codes.set(code, { nonce: url.searchParams.get('nonce') ?? '', challenge: url.searchParams.get('code_challenge') ?? '',
        clientId: url.searchParams.get('client_id') ?? '', redirect: url.searchParams.get('redirect_uri') ?? '' });
      const redirect = new URL(url.searchParams.get('redirect_uri') ?? 'http://invalid');
      redirect.searchParams.set('state', url.searchParams.get('state') ?? ''); redirect.searchParams.set('code', code);
      response.writeHead(302, { location: redirect.href }).end(); return;
    }
    if (url.pathname === '/token' && request.method === 'POST') {
      let text = '';
      for await (const chunk of request) text += chunk.toString();
      const body = new URLSearchParams(text);
      const code = body.get('code') ?? '';
      const attempt = codes.get(code); codes.delete(code);
      if (!attempt || body.get('grant_type') !== 'authorization_code'
        || body.get('client_id') !== attempt.clientId || body.get('redirect_uri') !== attempt.redirect
        || wrongPkce || sha(body.get('code_verifier') ?? '') !== attempt.challenge) {
        response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_grant' })); return;
      }
      const now = Math.floor(Date.now() / 1000);
      const claims = { iss: wrongIssuer ? `${issuer}/other` : issuer, aud: wrongAudience ? 'other-client' : attempt.clientId,
        sub: user, nonce: wrongNonce ? 'invalid' : attempt.nonce, iat: now, exp: expiredToken ? now - 120 : now + 60 };
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: unknownKey ? 'unknown' : 'fixture-key', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const data = `${header}.${payload}`;
      const signature = sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url');
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'unused-fixture', token_type: 'Bearer',
        id_token: `${data}.${invalidSignature ? 'bad' : signature}` })); return;
    }
    if (url.pathname === '/jwks') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [{ ...jwk, kid: 'fixture-key', alg: 'RS256', use: 'sig' }] })); return;
    }
    response.writeHead(404).end();
  });
  issuer = await start(issuerServer);
  const config = new oidc.Configuration({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`, id_token_signing_alg_values_supported: ['RS256'] }, 'test-client',
  { id_token_signed_response_alg: 'RS256' }, oidc.None());
  oidc.allowInsecureRequests(config);
  const database = { connect: async () => ({ query: (sql: string, params?: unknown[]) => db.query(sql, params), release() {} }) } as unknown as Pick<Pool, 'connect'>;
  let handler: ReturnType<typeof createWebOidcApi> | undefined;
  const server = createApiServer((request, response) => handler!(request, response));
  const origin = await start(server);
  handler = createWebOidcApi({ database, config, issuer, clientId: 'test-client', origin,
    redirectUri: `${origin}/auth/callback`, environment: 'isolated', isolatedHttpTest: true });
  await db.query('INSERT INTO workbench_identity_bindings (issuer, subject, principal_id) VALUES ($1, $2, $3), ($1, $4, $5)',
    [issuer, 'memberA', 'principal-a', 'memberB', 'principal-b']);
  await db.query("INSERT INTO team_memberships VALUES ('principal-a', 'team-a', 'active'), ('principal-b', 'team-b', 'active')");
  await db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-a', 'reviewer'), ('principal-b', 'team-b', 'space-b', 'reviewer')");
  const begin = async () => {
    const response = await fetch(`${origin}/auth/login`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    const login = new URL(response.headers.get('location')!);
    const authorization = await fetch(login, { redirect: 'manual' });
    expect(authorization.status).toBe(302);
    return { callback: authorization.headers.get('location')!, browserCookie: cookieJar(response), login };
  };
  const complete = async (callback: string, browserCookie: string, headers: Record<string, string> = {}) => fetch(callback, {
    redirect: 'manual', headers: { cookie: browserCookie, ...headers },
  });
  return { db, origin, issuer, config, begin, complete,
    setUser(value: string) { user = value; }, setUnavailable(value: boolean) { availability = !value; },
    setInvalidSignature(value: boolean) { invalidSignature = value; }, setWrongNonce(value: boolean) { wrongNonce = value; },
    setWrongAudience(value: boolean) { wrongAudience = value; }, setWrongIssuer(value: boolean) { wrongIssuer = value; },
    setWrongPkce(value: boolean) { wrongPkce = value; }, setExpiredToken(value: boolean) { expiredToken = value; },
    setUnknownKey(value: boolean) { unknownKey = value; }, database };
}

describe('independent Web OIDC (signed isolated issuer)', () => {
  it('leaves login disabled on the default API', async () => {
    const origin = await start(createApiServer());
    for (const path of ['/auth/login', '/auth/session', '/auth/spaces',
      '/auth/spaces?teamId=team-a&assetSpaceId=space-a', '/v1/context']) {
      expect((await fetch(origin + path)).status).toBe(404);
    }
  });

  it('binds two signed identities to current spaces, switches and revokes a browser session', async () => {
    const app = await setup();
    const loginA = await app.begin();
    const responseA = await app.complete(loginA.callback, loginA.browserCookie);
    expect(responseA.status).toBe(303);
    expect(responseA.headers.get('location')).toBe('/auth');
    const cookieA = cookieJar(responseA);
    const setCookies = responseA.headers.getSetCookie();
    expect(setCookies.find((value) => value.startsWith('__Host-workbench_session='))).toMatch(/Secure; HttpOnly; SameSite=Lax; Path=\//);
    expect(setCookies.find((value) => value.startsWith('__Host-workbench_csrf='))).toMatch(/Secure; SameSite=Lax; Path=\//);
    expect(setCookies.find((value) => value.startsWith('__Host-workbench_csrf='))).not.toContain('HttpOnly');
    expect(cookieA).not.toContain('unused-fixture');
    expect((await (await fetch(`${app.origin}/auth/session`, { headers: { cookie: cookieA } })).json())).toEqual({ authenticated: true });
    expect((await (await fetch(`${app.origin}/auth/spaces`, { headers: { cookie: cookieA } })).json())).toMatchObject({
      ok: true, spaces: [{ teamId: 'team-a', assetSpaceId: 'space-a' }],
    });
    await app.db.query("UPDATE team_memberships SET status = 'disabled' WHERE actor_id = 'principal-a'");
    expect((await (await fetch(`${app.origin}/auth/spaces`, { headers: { cookie: cookieA } })).json())).toMatchObject({
      ok: true, spaces: [],
    });
    await app.db.query("UPDATE team_memberships SET status = 'active' WHERE actor_id = 'principal-a'");
    expect((await fetch(`${app.origin}/auth/spaces`, { headers: { cookie: cookieA,
      'sec-fetch-site': 'cross-site' } })).status).toBe(401);
    const page = await (await fetch(`${app.origin}/auth`, { headers: { cookie: cookieA } })).text();
    expect(page).toContain("document.cookie.match(/(?:^|; )__Host-workbench_csrf=");
    expect(page).toContain('if(r.ok)location.reload()');
    expect(page).toContain("fetch('/auth/spaces')");
    expect(page).toContain('new URLSearchParams');
    expect(page).toContain('textContent');
    expect(page).not.toMatch(/repo-a|wk-a|principal-a/);
    app.setUser('memberB');
    const loginB = await app.begin();
    const responseB = await app.complete(loginB.callback, `${cookieA}; ${loginB.browserCookie}`);
    expect(responseB.status).toBe(303);
    const cookieB = cookieJar(responseB);
    expect((await fetch(`${app.origin}/auth/spaces`, { headers: { cookie: cookieA } })).status).toBe(401);
    expect((await (await fetch(`${app.origin}/auth/spaces`, { headers: { cookie: cookieB } })).json())).toMatchObject({
      ok: true, spaces: [{ teamId: 'team-b', assetSpaceId: 'space-b' }],
    });
    expect((await fetch(`${app.origin}/auth/spaces`, { headers: { cookie: cookieB, origin: 'https://wrong.invalid' } })).status).toBe(401);
    expect((await fetch(`${app.origin}/auth/logout`, { method: 'POST', headers: { cookie: cookieB,
      origin: app.origin, 'x-workbench-csrf': 'invalid' } })).status).toBe(401);
    const csrf = /__Host-workbench_csrf=([^;]+)/.exec(cookieB)?.[1];
    expect((await fetch(`${app.origin}/auth/logout`, { method: 'POST', headers: { cookie: cookieB,
      origin: app.origin, 'x-workbench-csrf': csrf! } })).status).toBe(204);
    expect((await fetch(`${app.origin}/auth/spaces`, { headers: { cookie: cookieB } })).status).toBe(401);
    const handle = /__Host-workbench_session=([^;]+)/.exec(cookieB)?.[1]!;
    expect(await resolveWorkbenchSession(app.database, { sessionHandle: handle, hostId: 'web',
      environment: 'wrong', channel: 'web' })).toBeNull();
    const hostHandle = randomBytes(32).toString('base64url');
    await app.db.query(`INSERT INTO workbench_sessions
      (handle_digest, principal_id, host_id, environment, expires_at, identity_epoch)
      VALUES ($1, 'principal-a', 'web', 'isolated', CURRENT_TIMESTAMP + INTERVAL '5 minutes', 0)`,
    [digestSessionHandle(hostHandle)]);
    expect(await (await fetch(`${app.origin}/auth/session`, { headers: { cookie: `__Host-workbench_session=${hostHandle}` } })).json())
      .toEqual({ authenticated: false });
    expect(await resolveWorkbenchSession(app.database, { sessionHandle: hostHandle, hostId: 'web',
      environment: 'isolated', channel: 'host' })).toEqual({ principalId: 'principal-a' });
  });

  it('rejects callback replay, missing browser binding, wrong state and invalid tokens', async () => {
    const app = await setup();
    let login = await app.begin();
    expect(await browserNavigation(login.callback, login.browserCookie)).toBe(303);
    login = await app.begin();
    expect((await app.complete(login.callback, login.browserCookie,
      { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' })).status).toBe(401);
    expect((await app.complete(login.callback, '')).status).toBe(401);
    const modified = new URL(login.callback); modified.searchParams.set('state', randomBytes(32).toString('base64url'));
    expect((await app.complete(modified.href, login.browserCookie)).status).toBe(401);
    expect((await app.complete(login.callback, login.browserCookie)).status).toBe(303);
    expect((await app.complete(login.callback, login.browserCookie)).status).toBe(401);
    login = await app.begin();
    const concurrent = await Promise.all([app.complete(login.callback, login.browserCookie), app.complete(login.callback, login.browserCookie)]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([303, 401]);
    login = await app.begin();
    await app.db.query("UPDATE web_oidc_attempts SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE state_digest = $1",
      [createHash('sha256').update(new URL(login.callback).searchParams.get('state')!).digest('hex')]);
    expect((await app.complete(login.callback, login.browserCookie)).status).toBe(401);
    for (const defect of [app.setInvalidSignature, app.setWrongNonce, app.setWrongAudience,
      app.setWrongIssuer, app.setWrongPkce, app.setExpiredToken, app.setUnknownKey]) {
      defect(true); login = await app.begin();
      expect((await app.complete(login.callback, login.browserCookie)).status).toBe(503);
      defect(false);
    }
    app.setUser('unbound'); login = await app.begin();
    expect((await app.complete(login.callback, login.browserCookie)).status).toBe(401);
    login = await app.begin();
    app.setUnavailable(true);
    expect((await app.complete(login.callback, login.browserCookie)).status).toBe(503);
  });

  it('rejects non-isolated HTTP even when the testing flag is set', async () => {
    const app = await setup();
    expect(() => createWebOidcApi({ database: app.database, config: app.config, issuer: app.issuer,
      clientId: 'test-client', origin: app.origin, redirectUri: `${app.origin}/auth/callback`,
      environment: 'staging', isolatedHttpTest: true })).toThrow('Invalid Web OIDC configuration');
    expect(() => createWebOidcApi({ database: app.database, config: app.config, issuer: app.issuer,
      clientId: 'test-client', origin: app.origin, redirectUri: `${app.origin}/auth/callback`,
      environment: 'isolated' })).toThrow('Invalid Web OIDC configuration');
    const altered = new oidc.Configuration({ issuer: app.issuer, authorization_endpoint: `${app.issuer}/authorize`,
      token_endpoint: 'http://127.0.0.1:9999/token', jwks_uri: `${app.issuer}/jwks`,
      id_token_signing_alg_values_supported: ['RS256'] },
      'test-client', { id_token_signed_response_alg: 'RS256' }, oidc.None());
    oidc.allowInsecureRequests(altered);
    expect(() => createWebOidcApi({ database: app.database, config: altered, issuer: app.issuer,
      clientId: 'test-client', origin: app.origin, redirectUri: `${app.origin}/auth/callback`,
      environment: 'isolated', isolatedHttpTest: true })).toThrow('Invalid Web OIDC configuration');
  });

  it('refuses cross-origin logout and never revives a disabled identity session', async () => {
    const app = await setup(); const login = await app.begin();
    const response = await app.complete(login.callback, login.browserCookie);
    const jar = cookieJar(response); const csrf = /__Host-workbench_csrf=([^;]+)/.exec(jar)?.[1];
    expect((await fetch(`${app.origin}/auth/logout`, { method: 'POST', headers: { cookie: jar, origin: 'https://wrong.invalid',
      'x-workbench-csrf': csrf! } })).status).toBe(401);
    await app.db.query("UPDATE workbench_identity_bindings SET status = 'disabled' WHERE subject = 'memberA'");
    await app.db.query("UPDATE workbench_identity_bindings SET status = 'active' WHERE subject = 'memberA'");
    expect((await (await fetch(`${app.origin}/auth/session`, { headers: { cookie: jar } })).json())).toEqual({ authenticated: false });
  });

  it('selects only a currently authorized Web space without retaining a previous choice', async () => {
    const app = await setup(); const login = await app.begin();
    const cookieA = cookieJar(await app.complete(login.callback, login.browserCookie));
    const read = (path: string, cookie = cookieA) => fetch(`${app.origin}/auth/spaces${path}`, { headers: { cookie } });
    const a = '?teamId=team-a&assetSpaceId=space-a';
    const c = '?teamId=team-a&assetSpaceId=space-c';
    const b = '?teamId=team-b&assetSpaceId=space-b';
    await app.db.query(`INSERT INTO asset_space_resource_bindings VALUES
      ('team-a', 'space-a', 'repo-a', 'refs/heads/main', 'wk-a', 1, 'pending'),
      ('team-b', 'space-b', 'repo-b', 'refs/heads/main', 'wk-b', 1, 'disabled')`);
    expect(await (await read('')).json()).toMatchObject({ ok: true, selected: { teamId: 'team-a', assetSpaceId: 'space-a' },
      bindingBlocker: 'pending_review' });
    expect(await (await read(a)).json()).toMatchObject({ ok: true, selected: { teamId: 'team-a', assetSpaceId: 'space-a' },
      binding: { gitRepositoryId: 'repo-a', configVersion: 1, status: 'pending' } });
    await app.db.query("INSERT INTO asset_spaces VALUES ('space-c', 'team-a')");
    await app.db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-c', 'reviewer')");
    expect(await (await read('')).json()).toMatchObject({ ok: true, spaces: [
      { teamId: 'team-a', assetSpaceId: 'space-a' }, { teamId: 'team-a', assetSpaceId: 'space-c' },
    ], selected: null, binding: null, bindingBlocker: null });
    expect(await (await read(c)).json()).toMatchObject({ ok: true, selected: { teamId: 'team-a', assetSpaceId: 'space-c' },
      binding: null, bindingBlocker: 'not_configured' });
    expect(await (await read(a)).json()).toMatchObject({ ok: true, selected: { teamId: 'team-a', assetSpaceId: 'space-a' },
      bindingBlocker: 'pending_review' });
    expect((await (await read('')).json()).selected).toBeNull();
    app.setUser('memberB'); const loginB = await app.begin();
    const cookieB = cookieJar(await app.complete(loginB.callback, `${cookieA}; ${loginB.browserCookie}`));
    expect((await read(a)).status).toBe(401);
    expect(await (await read(b, cookieB)).json()).toMatchObject({ ok: true, selected: { teamId: 'team-b', assetSpaceId: 'space-b' },
      binding: { gitRepositoryId: 'repo-b', status: 'disabled' }, bindingBlocker: 'disabled' });
    expect((await read(c, cookieB)).status).toBe(403);
    await app.db.query("DELETE FROM knowledge_role_bindings WHERE actor_id = 'principal-b'");
    expect(await (await read('', cookieB)).json()).toMatchObject({ ok: true, spaces: [], selected: null, binding: null });
    expect((await read(b, cookieB)).status).toBe(403);
  });

  it('rejects malformed, forged and revoked Web selections without exposing bindings', async () => {
    const app = await setup(); const login = await app.begin();
    const jar = cookieJar(await app.complete(login.callback, login.browserCookie));
    const read = (path: string) => fetch(`${app.origin}/auth/spaces${path}`, { headers: { cookie: jar } });
    await app.db.query("INSERT INTO asset_spaces VALUES ('space-c', 'team-a')");
    await app.db.query(`INSERT INTO asset_space_resource_bindings VALUES
      ('team-a', 'space-c', 'private-c', 'refs/heads/main', 'private-wk-c', 1, 'pending'),
      ('team-b', 'space-b', 'private-b', 'refs/heads/main', 'private-wk-b', 1, 'pending')`);
    for (const path of ['?', '?teamId=team-a', '?assetSpaceId=space-a', '?teamId=&assetSpaceId=space-a',
      '?teamId=%20&assetSpaceId=space-a', '?teamId=team-a&assetSpaceId=',
      '?teamId=team-a&teamId=team-b&assetSpaceId=space-a',
      '?teamId=team-a&assetSpaceId=space-a&assetSpaceId=space-c',
      '?teamId=team-a&assetSpaceId=space-a&principalId=principal-a']) {
      const response = await read(path);
      expect(response.status, path).toBe(400);
      expect(await response.json()).toEqual({ status: 'unavailable' });
    }
    for (const path of ['?teamId=team-a&assetSpaceId=space-c', '?teamId=team-b&assetSpaceId=space-b',
      '?teamId=team-b&assetSpaceId=space-a', '?teamId=team-a&assetSpaceId=guessed']) {
      const response = await read(path);
      expect(response.status, path).toBe(403);
      const body = await response.text();
      expect(body).not.toMatch(/private-c|private-b|private-wk|__Host-workbench|principal-a/);
    }
    await app.db.query("DELETE FROM knowledge_role_bindings WHERE actor_id = 'principal-a'");
    expect((await read('?teamId=team-a&assetSpaceId=space-a')).status).toBe(403);
    await app.db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-a', 'reviewer')");
    await app.db.query("UPDATE team_memberships SET status = 'disabled' WHERE actor_id = 'principal-a'");
    expect((await read('?teamId=team-a&assetSpaceId=space-a')).status).toBe(403);
    expect(await (await read('')).json()).toMatchObject({ ok: true, spaces: [], selected: null, binding: null });
    await app.db.query("UPDATE team_memberships SET status = 'active' WHERE actor_id = 'principal-a'");
    await app.db.query("UPDATE workbench_identity_bindings SET status = 'disabled' WHERE subject = 'memberA'");
    await app.db.query("UPDATE workbench_identity_bindings SET status = 'active' WHERE subject = 'memberA'");
    expect((await read('?teamId=team-a&assetSpaceId=space-a')).status).toBe(401);
  });

  it('fails closed when selection storage is unavailable and after logout', async () => {
    const app = await setup(); const login = await app.begin();
    const jar = cookieJar(await app.complete(login.callback, login.browserCookie));
    const selection = `${app.origin}/auth/spaces?teamId=team-a&assetSpaceId=space-a`;
    expect((await fetch(selection, { headers: { cookie: jar, origin: 'https://wrong.invalid' } })).status).toBe(401);
    expect((await fetch(selection, { headers: { cookie: jar, 'sec-fetch-site': 'cross-site' } })).status).toBe(401);
    const csrf = /__Host-workbench_csrf=([^;]+)/.exec(jar)?.[1];
    expect((await fetch(`${app.origin}/auth/logout`, { method: 'POST', headers: { cookie: jar,
      origin: app.origin, 'x-workbench-csrf': csrf! } })).status).toBe(204);
    expect((await fetch(selection, { headers: { cookie: jar } })).status).toBe(401);
    const fresh = await app.begin(); const freshJar = cookieJar(await app.complete(fresh.callback, fresh.browserCookie));
    await app.db.query('DROP TABLE team_memberships');
    const response = await fetch(selection, { headers: { cookie: freshJar } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });

  it('rejects selection after session expiry without granting a stale space', async () => {
    const app = await setup(); const login = await app.begin();
    const jar = cookieJar(await app.complete(login.callback, login.browserCookie));
    const handle = /__Host-workbench_session=([^;]+)/.exec(jar)?.[1]!;
    await app.db.query("UPDATE workbench_sessions SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE handle_digest = $1",
      [digestSessionHandle(handle)]);
    const response = await fetch(`${app.origin}/auth/spaces?teamId=team-a&assetSpaceId=space-a`, { headers: { cookie: jar } });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });
});
