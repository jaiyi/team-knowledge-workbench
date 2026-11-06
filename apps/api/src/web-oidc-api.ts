import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import * as oidc from 'openid-client';
import { digestSessionHandle, resolveWorkbenchSession } from './application/workbench-session.js';
import { readSessionAssetSpaces } from './application/read-session-asset-spaces.js';

type Database = Pick<Pool, 'connect'>;
type Settings = Readonly<{
  database: Database;
  config: oidc.Configuration;
  issuer: string;
  clientId: string;
  origin: string;
  redirectUri: string;
  environment: string;
  // Only an isolated signed issuer in HTTP tests may bypass HTTPS enforcement.
  isolatedHttpTest?: boolean;
}>;
type Attempt = { nonce: string; code_verifier: string };
const fresh = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const noStore = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
const cookieName = '__Host-workbench_session';
const stateCookie = '__Host-workbench_oidc';
const csrfCookie = '__Host-workbench_csrf';
const cookies = (request: IncomingMessage) => Object.fromEntries((request.headers.cookie ?? '').split(';').map((part) => {
  const index = part.indexOf('=');
  return index < 0 ? ['', ''] : [part.slice(0, index).trim(), part.slice(index + 1)];
}));
const cookie = (name: string, value: string, maxAge: number, httpOnly = true) =>
  `${name}=${value}; Secure; ${httpOnly ? 'HttpOnly; ' : ''}SameSite=Lax; Path=/; Max-Age=${maxAge}`;
const clear = (name: string, httpOnly = true) => cookie(name, '', 0, httpOnly);
const send = (response: ServerResponse, status: number, data: object, extra: Record<string, string | string[]> = {}) => {
  response.writeHead(status, { ...noStore, 'content-type': 'application/json', ...extra });
  response.end(JSON.stringify(data));
};
const denied = (response: ServerResponse, status = 401) => send(response, status, { status: 'unavailable' });
const token = (value: string | undefined) => value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>Workbench 登录</title>
<h1>Workbench</h1><p id="status">登录状态查询中</p><a id="login" href="/auth/login">登录</a>
<section id="spaces" hidden><label>当前有权空间 <select id="choice"></select></label>
<button type="button" id="select">查看所选空间</button><p id="selected"></p>
<p>空间选择仅用于本页查看，不授权读取知识或访问 Git／WeKnora。</p></section>
<form method="post" action="/auth/logout" hidden><button>退出登录</button></form>
<script>
const status = document.querySelector('#status');
const spaces = document.querySelector('#spaces');
const choice = document.querySelector('#choice');
const selected = document.querySelector('#selected');
const blocker = { pending_review: '资源绑定待复核', disabled: '资源绑定已停用', not_configured: '资源绑定未配置' };
function showSelection(value) {
  selected.textContent = value.selected
    ? '已选择 ' + value.selected.teamId + ' / ' + value.selected.assetSpaceId + '；' + (blocker[value.bindingBlocker] || '不可访问资源')
    : '请选择一个当前有权空间';
}
async function loadSpaces() {
  try {
    const response = await fetch('/auth/spaces');
    if (!response.ok) throw new Error('unavailable');
    const value = await response.json();
    if (!value.ok || !Array.isArray(value.spaces)) throw new Error('unavailable');
    choice.replaceChildren();
    for (const space of value.spaces) {
      const option = document.createElement('option');
      option.value = JSON.stringify([space.teamId, space.assetSpaceId]);
      option.textContent = space.teamId + ' / ' + space.assetSpaceId;
      choice.append(option);
    }
    choice.disabled = !value.spaces.length;
    document.querySelector('#select').disabled = !value.spaces.length;
    showSelection(value.spaces.length ? value : { selected: null });
    if (!value.spaces.length) selected.textContent = '当前没有有权空间';
  } catch { selected.textContent = '空间查询失败，请重试'; }
}
fetch('/auth/session').then(r => { if (!r.ok) throw new Error('unavailable'); return r.json(); })
  .then(v => {
    status.textContent = v.authenticated ? '已登录' : '未登录';
    if (v.authenticated) {
      document.querySelector('#login').hidden = true;
      document.querySelector('form').hidden = false;
      spaces.hidden = false;
      return loadSpaces();
    }
  }).catch(() => { status.textContent = '登录状态查询失败，请重试'; });
document.querySelector('#select').onclick = async () => {
  try {
    const [teamId, assetSpaceId] = JSON.parse(choice.value);
    const params = new URLSearchParams({ teamId, assetSpaceId });
    const response = await fetch('/auth/spaces?' + params);
    if (!response.ok) throw new Error('unavailable');
    const value = await response.json();
    if (!value.ok) throw new Error('unavailable');
    showSelection(value);
  } catch { selected.textContent = '空间不可用，请重新查询'; }
};
document.querySelector('form').onsubmit=e=>{e.preventDefault();fetch('/auth/logout',{method:'POST',headers:{'x-workbench-csrf':document.cookie.match(/(?:^|; )__Host-workbench_csrf=([^;]+)/)?.[1]||''}}).then(r=>{if(r.ok)location.reload();else document.querySelector('#status').textContent='退出失败，请重试'}).catch(()=>document.querySelector('#status').textContent='退出失败，请重试')}
</script></html>`;

export function createWebOidcApi(settings: Settings) {
  const { database, config, issuer, clientId, origin, redirectUri, environment } = settings;
  const trustedOrigin = new URL(origin);
  const callback = new URL(redirectUri);
  const metadata = config.serverMetadata();
  const authorizationEndpoint = metadata.authorization_endpoint;
  const tokenEndpoint = metadata.token_endpoint;
  const jwksUri = metadata.jwks_uri;
  if (!authorizationEndpoint || !tokenEndpoint || !jwksUri) throw new Error('Invalid Web OIDC configuration');
  const endpoints = [origin, issuer, authorizationEndpoint, tokenEndpoint, jwksUri];
  const isolated = settings.isolatedHttpTest && environment === 'isolated'
    && process.env.VITEST === 'true'
    && endpoints.every((value) => new URL(value).protocol === 'http:' && new URL(value).hostname === '127.0.0.1');
  if (settings.isolatedHttpTest && !isolated) throw new Error('Invalid Web OIDC configuration');
  if (!environment || !clientId || !issuer
    || trustedOrigin.origin !== origin
    || callback.origin !== origin || callback.pathname !== '/auth/callback' || callback.search || callback.hash
    || metadata.issuer !== issuer || config.clientMetadata().client_id !== clientId
    || config.clientMetadata().id_token_signed_response_alg !== 'RS256'
    || !metadata.id_token_signing_alg_values_supported?.includes('RS256')
    || endpoints.some((value) => new URL(value).username || new URL(value).password || new URL(value).hash)
    || new URL(issuer).search || new URL(authorizationEndpoint).origin !== new URL(issuer).origin
    || new URL(tokenEndpoint).origin !== new URL(issuer).origin || new URL(jwksUri).origin !== new URL(issuer).origin
    || (!isolated && endpoints.some((value) => new URL(value).protocol !== 'https:'))) {
    throw new Error('Invalid Web OIDC configuration');
  }
  oidc.enableNonRepudiationChecks(config);
  const webSession = (handle: string) => ({ sessionHandle: handle, hostId: 'web', environment, channel: 'web' as const });
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    if (!['/auth/login', '/auth/callback', '/auth/session', '/auth/logout', '/auth', '/auth/spaces'].includes(path)) return false;
    try {
      if (request.headers.host !== trustedOrigin.host
        || Object.keys(request.headers).some((name) => name === 'forwarded' || name.startsWith('x-forwarded-'))) {
        denied(response); return true;
      }
      const oidcNavigation = path === '/auth/callback' && request.method === 'GET'
        && request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document';
      if (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])
        && !oidcNavigation) { denied(response); return true; }
      const jar = cookies(request);
      if (path === '/auth/login' && request.method === 'GET') {
        if (request.url !== path) { denied(response); return true; }
        const state = fresh(); const browser = fresh(); const nonce = oidc.randomNonce();
        const verifier = oidc.randomPKCECodeVerifier();
        const challenge = await oidc.calculatePKCECodeChallenge(verifier);
        const client = await database.connect();
        try {
          await client.query(`INSERT INTO web_oidc_attempts
            (state_digest, browser_digest, environment, nonce, code_verifier, expires_at)
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + INTERVAL '3 minutes')`,
          [digest(state), digest(browser), environment, nonce, verifier]);
        } finally { client.release(); }
        const target = oidc.buildAuthorizationUrl(config, {
          response_type: 'code', scope: 'openid', redirect_uri: redirectUri, state, nonce,
          code_challenge: challenge, code_challenge_method: 'S256',
        });
        response.writeHead(302, { ...noStore, location: target.href, 'set-cookie': cookie(stateCookie, browser, 180) });
        response.end(); return true;
      }
      if (path === '/auth/callback' && request.method === 'GET') {
        const current = new URL(request.url ?? '', origin);
        const state = token(current.searchParams.get('state') ?? undefined);
        const browser = token(jar[stateCookie]);
        if (!state || !browser || current.searchParams.getAll('state').length !== 1
          || current.searchParams.getAll('code').length !== 1 || !current.searchParams.get('code')) {
          denied(response); return true;
        }
        const client = await database.connect();
        let attempt: Attempt | undefined;
        try {
          const result = await client.query<Attempt>(`UPDATE web_oidc_attempts SET consumed_at = CURRENT_TIMESTAMP
            WHERE state_digest = $1 AND browser_digest = $2 AND environment = $3
              AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
            RETURNING nonce, code_verifier`, [digest(state), digest(browser), environment]);
          attempt = result.rows[0];
        } finally { client.release(); }
        if (!attempt) { denied(response); return true; }
        const validated = await oidc.authorizationCodeGrant(config, current,
          { expectedState: state, expectedNonce: attempt.nonce, pkceCodeVerifier: attempt.code_verifier });
        const claims = validated.claims();
        if (!claims || claims.iss !== issuer || typeof claims.sub !== 'string' || !claims.sub) {
          denied(response); return true;
        }
        const previous = token(jar[cookieName]);
        const handle = fresh(); const csrf = fresh();
        const connection = await database.connect();
        try {
          await connection.query('BEGIN');
          const identity = await connection.query<{ principal_id: string; revocation_epoch: string }>(
            `SELECT principal_id, revocation_epoch FROM workbench_identity_bindings
             WHERE issuer = $1 AND subject = $2 AND status = 'active' FOR SHARE`, [issuer, claims.sub]);
          const binding = identity.rows[0];
          if (!binding) { await connection.query('ROLLBACK'); denied(response); return true; }
          if (previous) await connection.query(`UPDATE workbench_sessions SET revoked_at = CURRENT_TIMESTAMP
            WHERE handle_digest = $1 AND channel = 'web' AND environment = $2 AND revoked_at IS NULL`,
          [digestSessionHandle(previous), environment]);
          await connection.query(`INSERT INTO workbench_sessions
            (handle_digest, principal_id, host_id, environment, expires_at, identity_epoch, channel, csrf_digest)
            VALUES ($1, $2, 'web', $3, CURRENT_TIMESTAMP + INTERVAL '5 minutes', $4, 'web', $5)`,
          [digestSessionHandle(handle), binding.principal_id, environment, binding.revocation_epoch, digest(csrf)]);
          await connection.query('COMMIT');
        } catch (error) { await connection.query('ROLLBACK'); throw error; } finally { connection.release(); }
        response.writeHead(303, { ...noStore, location: '/auth', 'set-cookie': [cookie(cookieName, handle, 300),
          cookie(csrfCookie, csrf, 300, false), clear(stateCookie)] });
        response.end(); return true;
      }
      if (path === '/auth' && request.method === 'GET') {
        response.writeHead(200, { ...noStore, 'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'" });
        response.end(html); return true;
      }
      if (path === '/auth/session' && request.method === 'GET') {
        if (request.url !== path || request.headers.origin) { denied(response); return true; }
        const handle = token(jar[cookieName]);
        const resolved = handle && await resolveWorkbenchSession(database, webSession(handle));
        send(response, 200, { authenticated: !!resolved }); return true;
      }
      if (path === '/auth/spaces' && request.method === 'GET') {
        if (request.headers.origin) { denied(response); return true; }
        let selection: { teamId: string; assetSpaceId: string } | undefined;
        if (request.url !== path) {
          const current = new URL(request.url ?? '', origin);
          const params = current.searchParams;
          const teamIds = params.getAll('teamId'); const spaceIds = params.getAll('assetSpaceId');
          const teamId = teamIds[0]; const assetSpaceId = spaceIds[0];
          if (!request.url?.startsWith(`${path}?`) || current.hash || params.size !== 2
            || teamIds.length !== 1 || spaceIds.length !== 1
            || !teamId?.trim() || !assetSpaceId?.trim()) { denied(response, 400); return true; }
          selection = { teamId, assetSpaceId };
        }
        const handle = token(jar[cookieName]);
        if (!handle) { denied(response); return true; }
        const result = await readSessionAssetSpaces(database, webSession(handle), selection);
        if (!result.ok) { denied(response, result.reason === 'unauthenticated' ? 401 : 403); return true; }
        send(response, 200, result); return true;
      }
      if (path === '/auth/logout' && request.method === 'POST') {
        const handle = token(jar[cookieName]); const csrf = token(jar[csrfCookie]);
        if (request.url !== path || request.headers.origin !== origin || !handle || !csrf
          || request.headers['x-workbench-csrf'] !== csrf) { denied(response); return true; }
        const resolved = await resolveWorkbenchSession(database, webSession(handle));
        if (!resolved) { denied(response); return true; }
        const connection = await database.connect();
        try {
          const result = await connection.query(`UPDATE workbench_sessions SET revoked_at = CURRENT_TIMESTAMP
            WHERE handle_digest = $1 AND channel = 'web' AND environment = $2
              AND csrf_digest = $3 AND revoked_at IS NULL`, [digestSessionHandle(handle), environment, digest(csrf)]);
          if (result.rowCount !== 1) { denied(response); return true; }
        } finally { connection.release(); }
        response.writeHead(204, { ...noStore, 'set-cookie': [clear(cookieName), clear(csrfCookie, false)] });
        response.end(); return true;
      }
      denied(response, 404); return true;
    } catch {
      if (!response.headersSent) denied(response, 503);
      else response.end();
      return true;
    }
  };
}
