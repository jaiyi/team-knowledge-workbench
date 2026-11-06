import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { digestSessionHandle, resolveWorkbenchSession } from '../../apps/api/src/application/workbench-session.js';
import { provisionWebIdentity } from '../../apps/api/src/application/provision-web-identity.js';
import { parseAdminRequest } from '../../apps/api/scripts/admin-web-identity.js';

const migration = (name: string) => readFileSync(new URL(`../../apps/api/migrations/${name}`, import.meta.url), 'utf8');
const databases = new Set<PGlite>();
afterEach(async () => { await Promise.all([...databases].map((db) => db.close())); databases.clear(); });

async function fixture() {
  const db = new PGlite(); databases.add(db);
  for (const name of ['001_knowledge_transition_outbox.sql', '003_asset_space_authorization_bindings.sql',
    '004_workbench_identity_sessions.sql', '006_identity_revocation_epoch.sql', '008_web_oidc_login.sql']) await db.exec(migration(name));
  await db.query("INSERT INTO asset_spaces VALUES ('space-a', 'team-a'), ('space-b', 'team-b')");
  const database = { connect: async () => ({ query: (sql: string, params?: unknown[]) => db.query(sql, params), release() {} }) } as unknown as Pick<Pool, 'connect'>;
  return { db, database };
}

const a = { action: 'provision' as const, issuer: 'https://id.example.invalid/realms/test',
  subject: 'opaque-id-a', principalId: 'principal-a',
  grants: [{ teamId: 'team-a', assetSpaceId: 'space-a', role: 'reviewer' as const }] };
const b = { ...a, subject: 'opaque-id-b', principalId: 'principal-b',
  grants: [{ teamId: 'team-b', assetSpaceId: 'space-b', role: 'reviewer' as const }] };

const state = async (db: PGlite) => ({
  identities: (await db.query('SELECT issuer, subject, principal_id, status, revocation_epoch FROM workbench_identity_bindings ORDER BY subject')).rows,
  memberships: (await db.query('SELECT * FROM team_memberships ORDER BY actor_id')).rows,
  roles: (await db.query('SELECT * FROM knowledge_role_bindings ORDER BY actor_id')).rows,
});

describe('administrator-approved Web identity binding', () => {
  it('rejects unapproved JSON fields and requires explicit confirmation for writes', () => {
    expect(parseAdminRequest(JSON.stringify(a), [])).toEqual({ request: a, apply: false });
    expect(parseAdminRequest(JSON.stringify(a), ['--dry-run'])).toEqual({ request: a, apply: false });
    expect(parseAdminRequest(JSON.stringify(a), ['--apply', '--confirm-test-only'])).toEqual({ request: a, apply: true });
    for (const args of [['--apply'], ['--apply', '--confirm-test-only', '--verbose'], ['--help']]) {
      expect(() => parseAdminRequest(JSON.stringify(a), args)).toThrow();
    }
    for (const input of [
      { ...a, email: 'address@example.invalid' }, { ...a, password: 'invalid' },
      { ...a, subject: 123 }, { ...a, grants: [{ ...a.grants[0], teamId: '' }] },
    ]) expect(() => parseAdminRequest(JSON.stringify(input), ['--dry-run'])).toThrow();
  });

  it('defaults to dry-run, then provisions two distinct subjects with disjoint grants', async () => {
    const { db, database } = await fixture();
    expect(await provisionWebIdentity(database, a)).toEqual({ action: 'provision', outcome: 'would_apply' });
    expect(await state(db)).toEqual({ identities: [], memberships: [], roles: [] });
    expect(await provisionWebIdentity(database, a, true)).toEqual({ action: 'provision', outcome: 'applied' });
    expect(await provisionWebIdentity(database, b, true)).toEqual({ action: 'provision', outcome: 'applied' });
    expect((await state(db)).identities).toHaveLength(2);
    expect((await state(db)).roles).toHaveLength(2);
    expect((await db.query('SELECT * FROM team_memberships WHERE actor_id = $1', [a.principalId])).rows)
      .toEqual([{ actor_id: 'principal-a', team_id: 'team-a', status: 'active' }]);
  });

  it('binds a previously authorized principal without duplicating approved grants', async () => {
    const { db, database } = await fixture();
    await db.query("INSERT INTO team_memberships VALUES ('principal-a', 'team-a', 'active')");
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-a', 'reviewer')");
    const before = await state(db);
    expect(await provisionWebIdentity(database, a)).toEqual({ action: 'provision', outcome: 'would_apply' });
    expect(await state(db)).toEqual(before);
    expect(await provisionWebIdentity(database, a, true)).toEqual({ action: 'provision', outcome: 'applied' });
    const after = await state(db);
    expect(after.identities).toHaveLength(1);
    expect(after.memberships).toEqual(before.memberships);
    expect(after.roles).toEqual(before.roles);
    expect(await provisionWebIdentity(database, a, true)).toEqual({ action: 'provision', outcome: 'unchanged' });
  });

  it('adds only missing approved grants when binding an existing principal', async () => {
    const { db, database } = await fixture();
    await db.query("INSERT INTO team_memberships VALUES ('principal-a', 'team-a', 'active')");
    expect(await provisionWebIdentity(database, a, true)).toEqual({ action: 'provision', outcome: 'applied' });
    expect((await state(db)).memberships).toEqual([{ actor_id: 'principal-a', team_id: 'team-a', status: 'active' }]);
    expect((await state(db)).roles).toEqual([{
      actor_id: 'principal-a', team_id: 'team-a', asset_space_id: 'space-a', role: 'reviewer',
    }]);
  });

  it('is idempotent only for the same mapping and exact same grants', async () => {
    const { db, database } = await fixture();
    await provisionWebIdentity(database, a, true);
    const before = await state(db);
    expect(await provisionWebIdentity(database, a, true)).toEqual({ action: 'provision', outcome: 'unchanged' });
    for (const changed of [
      { ...a, subject: 'different-subject' }, { ...a, principalId: 'different-principal' },
      { ...a, grants: [{ teamId: 'team-b', assetSpaceId: 'space-b', role: 'reviewer' as const }] },
      { ...a, grants: [{ teamId: 'team-a', assetSpaceId: 'space-a', role: 'steward' as const }] },
      { ...a, grants: [{ teamId: 'team-a', assetSpaceId: 'space-missing', role: 'reviewer' as const }] },
    ]) await expect(provisionWebIdentity(database, changed, true)).rejects.toThrow();
    expect(await state(db)).toEqual(before);
  });

  it('rejects inherited orphaned grants, duplicates and insecure identities without writes', async () => {
    const { db, database } = await fixture();
    await db.query("INSERT INTO team_memberships VALUES ('principal-a', 'team-b', 'active')");
    const before = await state(db);
    for (const changed of [a, { ...a, issuer: 'http://id.example.invalid' },
      { ...a, grants: [...a.grants, ...a.grants] }, { ...a, subject: '' }]) {
      await expect(provisionWebIdentity(database, changed, true)).rejects.toThrow();
    }
    expect(await state(db)).toEqual(before);
  });

  it('cannot provision an identity after a missing or failed asset-space check', async () => {
    const { db, database } = await fixture();
    await expect(provisionWebIdentity(database, { ...a, grants: [
      { teamId: 'team-a', assetSpaceId: 'space-a', role: 'reviewer' },
      { teamId: 'team-b', assetSpaceId: 'space-missing', role: 'reviewer' },
    ] }, true)).rejects.toThrow();
    expect(await state(db)).toEqual({ identities: [], memberships: [], roles: [] });
  });

  it('disables the exact binding and invalidates old sessions even after an attempted re-provision', async () => {
    const { db, database } = await fixture();
    await provisionWebIdentity(database, a, true);
    await db.query(`INSERT INTO workbench_sessions
      (handle_digest, principal_id, host_id, environment, expires_at, channel)
      VALUES ($1, $2, 'web', 'isolated', CURRENT_TIMESTAMP + INTERVAL '5 minutes', 'web')`,
    [digestSessionHandle('existing-handle'), a.principalId]);
    const request = { sessionHandle: 'existing-handle', hostId: 'web', environment: 'isolated', channel: 'web' as const };
    expect(await resolveWorkbenchSession(database, request)).toEqual({ principalId: 'principal-a' });
    const disable = { action: 'disable' as const, issuer: a.issuer, subject: a.subject, principalId: a.principalId };
    expect(await provisionWebIdentity(database, disable)).toEqual({ action: 'disable', outcome: 'would_apply' });
    expect(await resolveWorkbenchSession(database, request)).not.toBeNull();
    expect(await provisionWebIdentity(database, disable, true)).toEqual({ action: 'disable', outcome: 'applied' });
    expect(await resolveWorkbenchSession(database, request)).toBeNull();
    expect(await provisionWebIdentity(database, disable, true)).toEqual({ action: 'disable', outcome: 'unchanged' });
    await expect(provisionWebIdentity(database, a, true)).rejects.toThrow();
    expect((await state(db)).identities[0]).toMatchObject({ status: 'disabled', revocation_epoch: 1 });
  });
});
