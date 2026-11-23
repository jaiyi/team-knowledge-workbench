import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool, QueryResultRow } from 'pg';
import { digestSessionHandle, resolveWorkbenchSession, revokeWorkbenchSession } from './application/workbench-session.js';
import { readSessionAssetSpaces } from './application/read-session-asset-spaces.js';

const issuer = 'urn:workbench:local-test';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const fresh = () => randomBytes(32).toString('base64url');
const noStore = { 'cache-control': 'no-store', 'content-type': 'application/json' };
type Database = Pick<Pool, 'connect'>;

type Settings = Readonly<{ database: Database; environment: string; accounts: Readonly<Record<'memberA' | 'memberB', string>> }>;
const fail = (response: ServerResponse, code = 403) => {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(code, noStore);
  response.end(JSON.stringify({ status: 'unavailable' }));
};
const send = (response: ServerResponse, status: number, body: object) => {
  response.writeHead(status, noStore);
  response.end(JSON.stringify(body));
};
const query = async <T extends QueryResultRow>(database: Database, sql: string, params: unknown[]): Promise<T[]> => {
  const client = await database.connect();
  try { return (await client.query<T>(sql, params)).rows; } finally { client.release(); }
};
async function body(request: IncomingMessage, limit = 2048): Promise<string> {
  let text = '';
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error('body too long');
    text += chunk.toString();
  }
  return text;
}
const isMember = (value: string): value is 'memberA' | 'memberB' => value === 'memberA' || value === 'memberB';
const verify = (password: string, stored: string): boolean => {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected || !/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(expected)) return false;
  const actual = scryptSync(password, Buffer.from(salt, 'hex'), 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
};
const bearer = (request: IncomingMessage) => /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1];
const host = (request: IncomingMessage) => request.headers['x-workbench-host'];
const loopbackOnly = (request: IncomingMessage) =>
  request.socket.localAddress === '127.0.0.1' && request.socket.remoteAddress === '127.0.0.1'
  && request.headers.host === `127.0.0.1:${request.socket.localPort}`
  && !request.headers.forwarded && !request.headers['x-forwarded-host'] && !request.headers['x-forwarded-for'];

export function createTestIdentityApi(settings: Settings) {
  if (!settings.environment || !/^[0-9a-f]{32}:[0-9a-f]{128}$/.test(settings.accounts.memberA)
    || !/^[0-9a-f]{32}:[0-9a-f]{128}$/.test(settings.accounts.memberB)) throw new Error('Invalid TEST identity configuration');
  const { database, environment } = settings;
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname;
      if (!['/test-identity/attempts', '/test-identity/logout', '/v1/context'].includes(path)
        && !/^\/test-identity\/attempts\/[A-Za-z0-9_-]{43}\/(login|claim)$/.test(path)) return false;
      if (!loopbackOnly(request)) { fail(response); return true; }
      if (url.search && path !== '/v1/context') { fail(response); return true; }
      if (path === '/v1/context' && ([...url.searchParams.keys()].some((key) => key !== 'teamId' && key !== 'assetSpaceId')
        || url.searchParams.getAll('teamId').length > 1 || url.searchParams.getAll('assetSpaceId').length > 1)) {
        fail(response); return true;
      }
      if (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) {
        fail(response); return true;
      }
      if (path === '/v1/context' && request.method === 'GET' && request.headers.origin) {
        fail(response); return true;
      }
      if (path === '/test-identity/logout' && request.method === 'POST'
        && (request.headers.origin || request.headers['content-type'] !== 'application/json')) {
        fail(response); return true;
      }
      if ((path === '/test-identity/attempts' || path.endsWith('/claim'))
        && request.method === 'POST'
        && (request.headers['content-type'] !== 'application/json' || request.headers.origin)) { fail(response); return true; }
      if (!['GET', 'POST'].includes(request.method ?? '') || (request.method === 'POST'
        && path !== '/test-identity/logout' && request.headers.origin
        && request.headers.origin !== `http://127.0.0.1:${request.socket.localPort}`)) { fail(response); return true; }
      if (path === '/test-identity/attempts' && request.method === 'POST') {
        const input = JSON.parse(await body(request)) as Record<string, unknown>;
        if (!isMember(input.account as string) || typeof input.hostId !== 'string'
          || !/^[A-Za-z0-9_-]{43}$/.test(input.hostId) || typeof input.claimSecret !== 'string'
          || !/^[A-Za-z0-9_-]{43}$/.test(input.claimSecret) || input.environment !== environment) { fail(response); return true; }
        const attemptId = fresh();
        const csrf = fresh();
        await query(database, `INSERT INTO test_login_attempts
          (attempt_id, claim_digest, host_id, environment, csrf_digest, subject, expires_at)
          VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP + INTERVAL '3 minutes')`,
        [attemptId, sha(input.claimSecret), input.hostId, environment, sha(csrf), input.account]);
        send(response, 201, { attemptId, loginPath: `/test-identity/attempts/${attemptId}/login` });
        return true;
      }
      const match = /^\/test-identity\/attempts\/([A-Za-z0-9_-]{43})\/(login|claim)$/.exec(path);
      if (match) {
        const [, attemptId, action] = match;
        if (action === 'login' && request.method === 'GET') {
          const csrf = fresh();
          const updated = await query<{ attempt_id: string }>(database,
            `UPDATE test_login_attempts SET csrf_digest = $2 WHERE attempt_id = $1
             AND claimed_at IS NULL AND principal_id IS NULL AND expires_at > CURRENT_TIMESTAMP AND failures < 5
             RETURNING attempt_id`, [attemptId, sha(csrf)]);
          if (!updated[0]) { fail(response); return true; }
          response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
            'x-frame-options': 'DENY', 'set-cookie': `test_csrf=${csrf}; HttpOnly; SameSite=Strict; Path=${path}` });
          response.end(`<!doctype html><html><meta charset="utf-8"><title>Workbench TEST 登录</title><h1>仅本机测试身份</h1><form method="post"><input name="csrf" type="hidden" value="${csrf}"><label>账号 <input name="account" required></label><label>口令 <input name="password" type="password" required></label><button>登录</button></form></html>`);
          return true;
        }
        if (action === 'login' && request.method === 'POST') {
          const origin = `http://127.0.0.1:${request.socket.localPort}`;
          if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/x-www-form-urlencoded'
            || (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) {
            fail(response); return true;
          }
          const form = new URLSearchParams(await body(request));
          const account = form.get('account') ?? '';
          const password = form.get('password') ?? '';
          const csrf = form.get('csrf') ?? '';
          const cookie = request.headers.cookie ?? '';
          const cookieToken = /test_csrf=([A-Za-z0-9_-]{43})/.exec(cookie)?.[1];
          if (!isMember(account) || !password || !/^[A-Za-z0-9_-]{43}$/.test(csrf)
            || cookieToken !== csrf) { fail(response); return true; }
          const client = await database.connect();
          try {
            await client.query('BEGIN');
            const rows = await client.query<{ subject: string; csrf_digest: string; failures: number }>(
              `SELECT subject, csrf_digest, failures FROM test_login_attempts WHERE attempt_id = $1
               AND claimed_at IS NULL AND principal_id IS NULL AND expires_at > CURRENT_TIMESTAMP FOR UPDATE`, [attemptId]);
            const row = rows.rows[0];
            if (!row || row.failures >= 5 || row.subject !== account || row.csrf_digest !== sha(csrf)) {
              await client.query('COMMIT'); fail(response); return true;
            }
            await client.query('UPDATE test_login_attempts SET failures = failures + 1 WHERE attempt_id = $1', [attemptId]);
            if (!verify(password, settings.accounts[account])) {
              await client.query('COMMIT'); fail(response); return true;
            }
            const identities = await client.query<{ principal_id: string; revocation_epoch: string }>(
              `SELECT principal_id, revocation_epoch FROM workbench_identity_bindings
               WHERE issuer = $1 AND subject = $2 AND status = 'active' FOR SHARE`, [issuer, account]);
            if (!identities.rows[0]) { await client.query('COMMIT'); fail(response); return true; }
            await client.query(`UPDATE test_login_attempts SET principal_id = $2, identity_epoch = $3, csrf_digest = $4
              WHERE attempt_id = $1`, [attemptId, identities.rows[0].principal_id, identities.rows[0].revocation_epoch, sha(fresh())]);
            await client.query('COMMIT');
          } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
          response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8',
            'content-security-policy': "default-src 'none'; frame-ancestors 'none'" });
          response.end('<!doctype html><html><meta charset="utf-8"><title>TEST 登录完成</title><p>测试登录已完成，可返回本机客户端。</p></html>');
          return true;
        }
        if (action === 'claim' && request.method === 'POST') {
          const input = JSON.parse(await body(request)) as Record<string, unknown>;
          if (typeof input.claimSecret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.claimSecret)
            || typeof input.hostId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.hostId)
            || input.environment !== environment) { fail(response); return true; }
          const client = await database.connect();
          try {
            await client.query('BEGIN');
            const result = await client.query<{ principal_id: string }>(
              `UPDATE test_login_attempts SET claimed_at = CURRENT_TIMESTAMP
               WHERE attempt_id = $1 AND claim_digest = $2 AND host_id = $3 AND environment = $4
                 AND expires_at > CURRENT_TIMESTAMP AND claimed_at IS NULL AND principal_id IS NOT NULL
               RETURNING principal_id`, [attemptId, sha(input.claimSecret), input.hostId, environment]);
            const principal = result.rows[0]?.principal_id;
            if (!principal) { await client.query('COMMIT'); fail(response); return true; }
            const identity = await client.query<{ revocation_epoch: string }>(
              `SELECT i.revocation_epoch FROM workbench_identity_bindings i
               JOIN test_login_attempts a ON a.subject = i.subject AND a.principal_id = i.principal_id
                 AND a.identity_epoch = i.revocation_epoch
               WHERE a.attempt_id = $1 AND i.issuer = $2 AND i.status = 'active'
               FOR SHARE OF i`, [attemptId, issuer]);
            if (!identity.rows[0]) { await client.query('ROLLBACK'); fail(response); return true; }
            await client.query(`INSERT INTO test_login_host_locks (host_id, environment) VALUES ($1, $2)
              ON CONFLICT DO NOTHING`, [input.hostId, environment]);
            await client.query(`SELECT 1 FROM test_login_host_locks WHERE host_id = $1 AND environment = $2 FOR UPDATE`,
              [input.hostId, environment]);
            await client.query(`UPDATE workbench_sessions SET revoked_at = CURRENT_TIMESTAMP
              WHERE host_id = $1 AND environment = $2 AND revoked_at IS NULL`, [input.hostId, environment]);
            const handle = fresh();
            await client.query(`INSERT INTO workbench_sessions
              (handle_digest, principal_id, host_id, environment, expires_at, identity_epoch)
              VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '5 minutes', $5)`,
            [digestSessionHandle(handle), principal, input.hostId, environment, identity.rows[0].revocation_epoch]);
            await client.query('COMMIT');
            send(response, 200, { sessionHandle: handle });
            return true;
          } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
        }
      }
      if ((path === '/v1/context' && request.method === 'GET')
        || (path === '/test-identity/logout' && request.method === 'POST')) {
        const token = bearer(request);
        const hostId = host(request);
        if (!token || typeof hostId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(hostId)) {
          fail(response, 401); return true;
        }
        if (path === '/test-identity/logout') {
          if (!await resolveWorkbenchSession(database, { sessionHandle: token, hostId, environment })) {
            fail(response, 401); return true;
          }
          await revokeWorkbenchSession(database, digestSessionHandle(token));
          response.writeHead(204, { 'cache-control': 'no-store' }); response.end(); return true;
        }
        const teamId = url.searchParams.get('teamId');
        const assetSpaceId = url.searchParams.get('assetSpaceId');
        if ((teamId && !assetSpaceId) || (!teamId && assetSpaceId)) { fail(response); return true; }
        const result = await readSessionAssetSpaces(database, { sessionHandle: token, hostId, environment },
          teamId && assetSpaceId ? { teamId, assetSpaceId } : undefined);
        if (!result.ok) { fail(response, result.reason === 'unauthenticated' ? 401 : 403); return true; }
        send(response, 200, result);
        return true;
      }
      fail(response, 404);
      return true;
    } catch { fail(response, 503); return true; }
  };
}
