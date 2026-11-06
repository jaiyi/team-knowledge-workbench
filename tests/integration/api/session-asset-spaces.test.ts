import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { digestSessionHandle, resolveWorkbenchSession, revokeWorkbenchSession } from '../../../apps/api/src/application/workbench-session.js';
import { readSessionAssetSpaces } from '../../../apps/api/src/application/read-session-asset-spaces.js';

const migration = (name: string) => readFileSync(fileURLToPath(new URL(`../../../apps/api/migrations/${name}`, import.meta.url)), 'utf8');
const sessions = new Set<PGlite>();
const request = { sessionHandle: 'fixture-handle-a', hostId: 'host-a', environment: 'isolated-test' };
const selection = { teamId: 'team-a', assetSpaceId: 'space-a' };
const denied = { ok: false, reason: 'unavailable' };

afterEach(async () => { await Promise.all([...sessions].map((db) => db.close())); sessions.clear(); });

async function setup() {
  const db = new PGlite();
  sessions.add(db);
  await db.exec(migration('001_knowledge_transition_outbox.sql'));
  await db.exec(migration('003_asset_space_authorization_bindings.sql'));
  await db.exec(migration('004_workbench_identity_sessions.sql'));
  await db.exec(migration('006_identity_revocation_epoch.sql'));
  await db.query("INSERT INTO asset_spaces VALUES ('space-a', 'team-a'), ('space-c', 'team-a'), ('space-b', 'team-b')");
  await db.query("INSERT INTO workbench_identity_bindings (issuer, subject, principal_id) VALUES ('https://id.example.invalid', 'person-a', 'principal-a'), ('https://id.example.invalid', 'person-b', 'principal-b')");
  await db.query("INSERT INTO workbench_sessions (handle_digest, principal_id, host_id, environment, expires_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '1 hour')",
    [digestSessionHandle(request.sessionHandle), 'principal-a', request.hostId, request.environment]);
  const database = { connect: async () => ({ query: (sql: string, params?: unknown[]) => db.query(sql, params), release() {} }) } as unknown as Pick<Pool, 'connect'>;
  const read = (input: typeof request = request, selected?: typeof selection) => readSessionAssetSpaces(database, input, selected);
  return { db, database, read };
}

describe('internal Workbench session to current spaces (isolated PGlite)', () => {
  it('does not provision a subject through email, display name or duplicate bindings', async () => {
    const { db, database } = await setup();
    await expect(db.query("INSERT INTO workbench_identity_bindings (issuer, subject, principal_id) VALUES ('https://id.example.invalid', 'person-a', 'other')")).rejects.toThrow();
    await expect(db.query("INSERT INTO workbench_identity_bindings (issuer, subject, principal_id) VALUES ('https://other.example.invalid', 'person-a', 'principal-a')")).rejects.toThrow();
    await db.query("INSERT INTO workbench_identity_bindings (issuer, subject, principal_id) VALUES ('https://other.example.invalid', 'person-a', 'principal-other')");
    expect(await resolveWorkbenchSession(database, request)).toEqual({ principalId: 'principal-a' });
    expect(await resolveWorkbenchSession(database, { ...request, sessionHandle: 'unknown' })).toBeNull();
    expect(await db.query('SELECT handle_digest FROM workbench_sessions')).toMatchObject({ rows: [{ handle_digest: digestSessionHandle(request.sessionHandle) }] });
  });

  it('requires the exact Host, environment, unexpired and unrevoked session', async () => {
    const { db, database, read } = await setup();
    expect(await read()).toEqual({ ok: true, spaces: [], selected: null, binding: null, bindingBlocker: null });
    for (const input of [
      { ...request, hostId: 'host-b' }, { ...request, environment: 'other' },
      { ...request, sessionHandle: 'guessed' },
    ]) expect(await read(input)).toEqual({ ok: false, reason: 'unauthenticated' });
    await db.query("UPDATE workbench_sessions SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'");
    expect(await read()).toEqual({ ok: false, reason: 'unauthenticated' });
    await db.query("UPDATE workbench_sessions SET expires_at = CURRENT_TIMESTAMP + INTERVAL '1 hour'");
    expect(await revokeWorkbenchSession(database, digestSessionHandle(request.sessionHandle))).toBe(true);
    expect(await revokeWorkbenchSession(database, digestSessionHandle(request.sessionHandle))).toBe(false);
    expect(await read()).toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it('derives zero, one and multiple spaces from current grants, not caller fields', async () => {
    const { db, read } = await setup();
    await db.query("INSERT INTO team_memberships VALUES ('principal-a', 'team-a', 'active')");
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-a', 'reviewer')");
    expect(await read()).toEqual({ ok: true, spaces: [selection], selected: selection, binding: null, bindingBlocker: 'not_configured' });
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-c', 'steward')");
    expect(await read()).toMatchObject({ ok: true, spaces: [selection, { teamId: 'team-a', assetSpaceId: 'space-c' }], selected: null });
    expect(await read(request, { teamId: 'team-b', assetSpaceId: 'space-a' })).toEqual(denied);
    await db.query("UPDATE team_memberships SET status = 'disabled' WHERE actor_id = 'principal-a'");
    expect(await read(request, selection)).toEqual(denied);
    expect(await read()).toEqual({ ok: true, spaces: [], selected: null, binding: null, bindingBlocker: null });
  });

  it('exposes only scoped pending or disabled metadata and never executable connections', async () => {
    const { db, read } = await setup();
    await db.query("INSERT INTO team_memberships VALUES ('principal-a', 'team-a', 'active'), ('principal-b', 'team-b', 'active')");
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-a', 'steward'), ('principal-b', 'team-b', 'space-b', 'reviewer')");
    await db.query(`INSERT INTO asset_space_resource_bindings VALUES
      ('team-a', 'space-a', 'repo-a', 'refs/heads/main', 'wk-a', 1, 'pending'),
      ('team-b', 'space-b', 'repo-b', 'refs/heads/main', 'wk-b', 1, 'pending')`);
    expect(await read(request, selection)).toEqual({ ok: true, spaces: [selection], selected: selection,
      binding: { gitRepositoryId: 'repo-a', gitProtectedRef: 'refs/heads/main', weknoraSpaceId: 'wk-a', configVersion: 1, status: 'pending' }, bindingBlocker: 'pending_review' });
    expect(JSON.stringify(await read(request, selection))).not.toContain('repo-b');
    expect(await read(request, { teamId: 'team-b', assetSpaceId: 'space-b' })).toEqual(denied);
    await db.query("UPDATE asset_space_resource_bindings SET status = 'disabled', config_version = 2 WHERE asset_space_id = 'space-a'");
    expect(await read(request, selection)).toMatchObject({ ok: true, binding: { status: 'disabled', configVersion: 2 }, bindingBlocker: 'disabled' });
    await db.query("DELETE FROM knowledge_role_bindings WHERE actor_id = 'principal-a'");
    expect(await read(request, selection)).toEqual(denied);
  });

  it('does not reuse a disabled subject or a session bound to a different principal', async () => {
    const { db, database, read } = await setup();
    await db.query("INSERT INTO team_memberships VALUES ('principal-a', 'team-a', 'active'), ('principal-b', 'team-b', 'active')");
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-a', 'reviewer'), ('principal-b', 'team-b', 'space-b', 'reviewer')");
    await db.query("INSERT INTO workbench_sessions (handle_digest, principal_id, host_id, environment, expires_at) VALUES ($1, 'principal-b', 'host-a', 'isolated-test', CURRENT_TIMESTAMP + INTERVAL '1 hour')", [digestSessionHandle('fixture-handle-b')]);
    expect(await read()).toMatchObject({ ok: true, spaces: [selection] });
    expect(await read({ ...request, sessionHandle: 'fixture-handle-b' })).toMatchObject({
      ok: true, spaces: [{ teamId: 'team-b', assetSpaceId: 'space-b' }],
    });
    await db.query("UPDATE workbench_identity_bindings SET status = 'disabled' WHERE principal_id = 'principal-a'");
    expect(await resolveWorkbenchSession(database, request)).toBeNull();
    await db.query("UPDATE workbench_identity_bindings SET status = 'active' WHERE principal_id = 'principal-a'");
    await expect(db.query("UPDATE workbench_identity_bindings SET revocation_epoch = 0 WHERE principal_id = 'principal-a'")).rejects.toThrow();
    expect(await resolveWorkbenchSession(database, request)).toBeNull();
    expect(await read()).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(await read({ ...request, sessionHandle: 'fixture-handle-b' })).toMatchObject({
      ok: true, spaces: [{ teamId: 'team-b', assetSpaceId: 'space-b' }],
    });
  });

  it('does not expose another space binding in the same team', async () => {
    const { db, read } = await setup();
    await db.query("INSERT INTO team_memberships VALUES ('principal-a', 'team-a', 'active')");
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-a', 'steward')");
    await db.query("INSERT INTO asset_space_resource_bindings VALUES ('team-a', 'space-c', 'repo-c', 'refs/heads/main', 'wk-c', 1, 'pending')");
    expect(await read(request, { teamId: 'team-a', assetSpaceId: 'space-c' })).toEqual(denied);
    expect(JSON.stringify(await read())).not.toContain('repo-c');
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-c', 'reviewer')");
    expect(await read(request, { teamId: 'team-a', assetSpaceId: 'space-c' })).toMatchObject({
      ok: true, binding: { gitRepositoryId: 'repo-c', weknoraSpaceId: 'wk-c' }, bindingBlocker: 'pending_review',
    });
  });

  it('fails on database errors rather than reporting zero spaces', async () => {
    const { db, read } = await setup();
    await db.query('DROP TABLE team_memberships');
    await expect(read()).rejects.toThrow();
  });
});
