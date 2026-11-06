import { Pool } from 'pg';
import * as oidc from 'openid-client';
import { createApiServer } from '../src/server.js';
import { createWebOidcApi } from '../src/web-oidc-api.js';

type Environment = Record<string, string | undefined>;

type Runtime = Readonly<{
  issuer: string;
  clientId: string;
  origin: string;
  redirectUri: string;
  environment: string;
  databaseUrl: string;
  port: number;
}>;

const httpsUrl = (value: string | undefined, originOnly: boolean): URL => {
  if (!value) throw new Error('Web OIDC requires explicit HTTPS configuration');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (originOnly && value !== url.origin)
    || (!originOnly && (value !== url.href || url.pathname.includes('/.well-known/')))) {
    throw new Error('Invalid Web OIDC HTTPS address');
  }
  return url;
};

export function parseWebOidcRuntime(env: Environment): Runtime {
  if (env.WORKBENCH_WEB_OIDC !== '1' || !env.WORKBENCH_WEB_CLIENT_ID?.trim()
    || !env.WORKBENCH_WEB_ENVIRONMENT?.trim() || !env.WORKBENCH_WEB_DATABASE_URL) {
    throw new Error('Explicit Web OIDC settings are required');
  }
  const issuer = httpsUrl(env.WORKBENCH_WEB_ISSUER, false);
  const origin = httpsUrl(env.WORKBENCH_WEB_ORIGIN, true);
  const databaseUrl = env.WORKBENCH_WEB_DATABASE_URL;
  const database = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname
    || !database.pathname.slice(1) || database.username === '' || database.password === ''
    || database.searchParams.getAll('sslmode').length !== 1
    || database.searchParams.get('sslmode') !== 'verify-full'
    || [...database.searchParams.keys()].some((key) => key !== 'sslmode')
    || database.hash) throw new Error('Web OIDC database requires verified PostgreSQL TLS');
  const port = Number(env.WORKBENCH_WEB_PORT);
  if (!/^[0-9]+$/.test(env.WORKBENCH_WEB_PORT ?? '') || !Number.isInteger(port)
    || port < 1 || port > 65535) throw new Error('Web OIDC requires a valid loopback port');
  return {
    issuer: issuer.href, clientId: env.WORKBENCH_WEB_CLIENT_ID,
    origin: origin.origin, redirectUri: `${origin.origin}/auth/callback`,
    environment: env.WORKBENCH_WEB_ENVIRONMENT, databaseUrl, port,
  };
}

export async function startWebOidcServer(settings: Runtime, config: oidc.Configuration,
  database: Pick<Pool, 'connect' | 'query'>) {
  const handler = createWebOidcApi({ database, config, issuer: settings.issuer,
    clientId: settings.clientId, origin: settings.origin, redirectUri: settings.redirectUri,
    environment: settings.environment });
  await database.query(`SELECT i.revocation_epoch, s.identity_epoch, s.channel, s.csrf_digest,
      a.state_digest, m.actor_id, r.actor_id
    FROM workbench_identity_bindings i
    CROSS JOIN workbench_sessions s
    CROSS JOIN web_oidc_attempts a
    CROSS JOIN team_memberships m
    CROSS JOIN knowledge_role_bindings r LIMIT 0`);
  const server = createApiServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(settings.port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

async function main() {
  const settings = parseWebOidcRuntime(process.env);
  const config = await oidc.discovery(new URL(settings.issuer), settings.clientId,
    { id_token_signed_response_alg: 'RS256', token_endpoint_auth_method: 'none' }, oidc.None(), { timeout: 10 });
  const database = new Pool({ connectionString: settings.databaseUrl, max: 5 });
  try {
    const server = await startWebOidcServer(settings, config, database);
    server.on('close', () => { void database.end(); });
    process.stdout.write('Workbench Web OIDC API listening on loopback behind approved HTTPS gateway\n');
  } catch (error) {
    await database.end();
    throw error;
  }
}

if (process.argv[1]?.endsWith('/apps/api/scripts/web-oidc.ts')) {
  main().catch(() => {
    process.stderr.write('Web OIDC startup failed; check approved configuration and dependencies\n');
    process.exitCode = 1;
  });
}
