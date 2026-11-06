import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { createApiServer } from '../../../apps/api/src/server.js';
import { digestSessionHandle, type SessionRequest } from '../../../apps/api/src/application/workbench-session.js';
import { readSessionKnowledgeLocator } from '../../../apps/api/src/application/read-session-knowledge-locator.js';

const migration = (name: string) => readFileSync(new URL(`../../../apps/api/migrations/${name}`, import.meta.url), 'utf8');
const databases = new Set<PGlite>();
const request = { sessionHandle: 'web-a', hostId: 'web', environment: 'isolated', channel: 'web' as const };
const target = { teamId: 'team-a', assetSpaceId: 'space-a', knowledgeId: 'knowledge-a',
  assetRevision: 1, stateVersion: 0, configVersion: 1 };
const unavailable = { ok: false, reason: 'unavailable' };
afterEach(async () => { await Promise.all([...databases].map((db) => db.close())); databases.clear(); });

async function setup() {
  const db = new PGlite(); databases.add(db);
  for (const name of ['001_knowledge_transition_outbox.sql', '003_asset_space_authorization_bindings.sql',
    '004_workbench_identity_sessions.sql', '006_identity_revocation_epoch.sql', '008_web_oidc_login.sql']) await db.exec(migration(name));
  await db.query("INSERT INTO asset_spaces VALUES ('space-a', 'team-a'), ('space-c', 'team-a'), ('space-b', 'team-b')");
  await db.query(`INSERT INTO workbench_identity_bindings (issuer, subject, principal_id) VALUES
    ('https://issuer.invalid', 'memberA', 'principal-a'), ('https://issuer.invalid', 'memberB', 'principal-b')`);
  await db.query("INSERT INTO team_memberships VALUES ('principal-a', 'team-a', 'active'), ('principal-b', 'team-b', 'active')");
  await db.query(`INSERT INTO knowledge_role_bindings VALUES
    ('principal-a', 'team-a', 'space-a', 'reviewer'), ('principal-b', 'team-b', 'space-b', 'reviewer')`);
  await db.query(`INSERT INTO knowledge_states VALUES
    ('knowledge-a', 'team-a', 'space-a', 'captured', 0, 1, $1),
    ('knowledge-c', 'team-a', 'space-c', 'captured', 0, 1, $1),
    ('knowledge-b', 'team-b', 'space-b', 'captured', 0, 1, $1)`, [`sha256:${'a'.repeat(64)}`]);
  await db.query(`INSERT INTO asset_space_resource_bindings VALUES
    ('team-a', 'space-a', 'repo-a', 'refs/heads/main', 'wk-a', 1, 'pending'),
    ('team-b', 'space-b', 'repo-b', 'refs/heads/main', 'wk-b', 1, 'disabled')`);
  for (const [handle, principal] of [['web-a', 'principal-a'], ['web-b', 'principal-b']]) {
    await db.query(`INSERT INTO workbench_sessions
      (handle_digest, principal_id, host_id, environment, expires_at, channel)
      VALUES ($1, $2, 'web', 'isolated', CURRENT_TIMESTAMP + INTERVAL '5 minutes', 'web')`,
    [digestSessionHandle(handle!), principal!]);
  }
  const database = { connect: async () => ({ query: (sql: string, params?: unknown[]) => db.query(sql, params), release() {} }) } as unknown as Pick<Pool, 'connect'>;
  const read = (session: SessionRequest = request,
    object: Omit<typeof target, 'configVersion'> & { configVersion: number | null } = target) =>
    readSessionKnowledgeLocator(database, session, object);
  return { db, read };
}

describe('Web session to Knowledge object scope (isolated PGlite)', () => {
  it('matches only server-owned object scope and returns no access grant or Provider target', async () => {
    const { db, read } = await setup();
    const a = await read();
    expect(a).toEqual({ ok: true, bindingBlocker: 'pending_review' });
    expect(await read({ ...request, sessionHandle: 'web-b' }, { ...target, teamId: 'team-b',
      assetSpaceId: 'space-b', knowledgeId: 'knowledge-b' })).toEqual({ ok: true, bindingBlocker: 'disabled' });
    const output = JSON.stringify(a);
    expect(output).not.toMatch(/repo-|wk-|knowledge-|source|content|authorized|assetDigest|principal/);
    expect((await db.query('SELECT knowledge_id, state_version FROM knowledge_states ORDER BY knowledge_id')).rows)
      .toEqual([{ knowledge_id: 'knowledge-a', state_version: 0 }, { knowledge_id: 'knowledge-b', state_version: 0 },
        { knowledge_id: 'knowledge-c', state_version: 0 }]);
    expect((await db.query('SELECT * FROM knowledge_transition_events')).rows).toEqual([]);
    expect((await db.query('SELECT * FROM knowledge_outbox')).rows).toEqual([]);
  });

  it('cannot distinguish absent, foreign, same-team ungranted or stale objects', async () => {
    const { db, read } = await setup();
    for (const input of [
      { ...target, knowledgeId: 'missing' },
      { ...target, knowledgeId: 'knowledge-b' },
      { ...target, knowledgeId: 'knowledge-c' },
      { ...target, teamId: 'team-b', assetSpaceId: 'space-b', knowledgeId: 'knowledge-b' },
      { ...target, teamId: 'team-b' },
      { ...target, assetSpaceId: 'space-c', knowledgeId: 'knowledge-c' },
      { ...target, assetRevision: 2 }, { ...target, stateVersion: 1 }, { ...target, configVersion: 2 },
    ]) expect(await read(request, input)).toEqual(unavailable);
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-c', 'reviewer')");
    expect(await read(request, { ...target, assetSpaceId: 'space-c', knowledgeId: 'knowledge-c',
      configVersion: null })).toEqual({ ok: true, bindingBlocker: 'not_configured' });
    expect(await read(request, { ...target, assetSpaceId: 'space-c', knowledgeId: 'knowledge-c' })).toEqual(unavailable);
    await db.query("UPDATE knowledge_states SET asset_revision = 2, state_version = 1 WHERE knowledge_id = 'knowledge-a'");
    expect(await read()).toEqual(unavailable);
  });

  it('rechecks current role, membership and binding status on every read', async () => {
    const { db, read } = await setup();
    await db.query("UPDATE asset_space_resource_bindings SET status = 'disabled' WHERE asset_space_id = 'space-a'");
    expect(await read()).toEqual({ ok: true, bindingBlocker: 'disabled' });
    await db.query("UPDATE asset_space_resource_bindings SET config_version = 2 WHERE asset_space_id = 'space-a'");
    expect(await read()).toEqual(unavailable);
    expect(await read(request, { ...target, configVersion: 2 })).toEqual({ ok: true, bindingBlocker: 'disabled' });
    await db.query("DELETE FROM knowledge_role_bindings WHERE actor_id = 'principal-a'");
    expect(await read(request, { ...target, configVersion: 2 })).toEqual(unavailable);
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-a', 'reviewer')");
    await db.query("UPDATE team_memberships SET status = 'disabled' WHERE actor_id = 'principal-a'");
    expect(await read(request, { ...target, configVersion: 2 })).toEqual(unavailable);
  });

  it('rejects Host-channel, expired, revoked and switched sessions', async () => {
    const { db, read } = await setup();
    const hostHandle = 'host-a';
    await db.query(`INSERT INTO workbench_sessions
      (handle_digest, principal_id, host_id, environment, expires_at)
      VALUES ($1, 'principal-a', 'web', 'isolated', CURRENT_TIMESTAMP + INTERVAL '5 minutes')`,
    [digestSessionHandle(hostHandle)]);
    for (const session of [{ ...request, sessionHandle: hostHandle }, { ...request, channel: 'host' as const },
      { ...request, hostId: 'other' }, { ...request, environment: 'other' }]) {
      expect(await read(session)).toEqual({ ok: false, reason: 'unauthenticated' });
    }
    await db.query("UPDATE workbench_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE handle_digest = $1",
      [digestSessionHandle(request.sessionHandle)]);
    expect(await read()).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(await read({ ...request, sessionHandle: 'web-b' })).toEqual(unavailable);
    await db.query("UPDATE workbench_sessions SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE handle_digest = $1",
      [digestSessionHandle('web-b')]);
    expect(await read({ ...request, sessionHandle: 'web-b' }, { ...target, teamId: 'team-b',
      assetSpaceId: 'space-b', knowledgeId: 'knowledge-b' })).toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it('does not revive a Web session after identity disable and restore', async () => {
    const { db, read } = await setup();
    await db.query("UPDATE workbench_identity_bindings SET status = 'disabled' WHERE subject = 'memberA'");
    expect(await read()).toEqual({ ok: false, reason: 'unauthenticated' });
    await db.query("UPDATE workbench_identity_bindings SET status = 'active' WHERE subject = 'memberA'");
    expect(await read()).toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it('fails closed on storage errors without treating them as absent objects', async () => {
    const { db, read } = await setup();
    await db.query('DROP TABLE knowledge_role_bindings');
    await expect(read()).rejects.toThrow();
  });

  it('does not expose an object route on the default API', async () => {
    const server = createApiServer();
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected test port');
      const origin = `http://127.0.0.1:${address.port}`;
      expect((await fetch(`${origin}/v1/spaces/space-a/assets/knowledge-a`)).status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
