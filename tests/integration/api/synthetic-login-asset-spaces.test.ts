import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { createSyntheticOidcLogin } from '../../support/synthetic-oidc-login.js';
import { readSyntheticSessionAssetSpaces } from '../../support/synthetic-session-asset-spaces.js';

const migration = readFileSync(fileURLToPath(new URL('../../../apps/api/migrations/001_knowledge_transition_outbox.sql', import.meta.url)), 'utf8');
const authorizationMigration = readFileSync(fileURLToPath(new URL('../../../apps/api/migrations/003_asset_space_authorization_bindings.sql', import.meta.url)), 'utf8');
const issuer = 'https://identity.example.invalid';
const backendOrigin = 'https://workbench.example.invalid';
const environment = 'isolated-test';
const host = { hostId: 'desktop-a', hostSecret: 'host-secret-a', backendOrigin, environment };
const otherHost = { hostId: 'desktop-b', hostSecret: 'host-secret-b', backendOrigin, environment };
const spaceA = { teamId: 'team-a', assetSpaceId: 'space-a' };
const spaceB = { teamId: 'team-b', assetSpaceId: 'space-b' };
const spaceC = { teamId: 'team-a', assetSpaceId: 'space-c' };
const denied = { ok: false, reason: 'unavailable' };
const instances: PGlite[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map((db) => db.close()));
});

const setup = async () => {
  const db = new PGlite();
  instances.push(db);
  await db.exec(migration);
  await db.exec(authorizationMigration);
  await db.query("INSERT INTO asset_spaces VALUES ('space-a', 'team-a'), ('space-b', 'team-b'), ('space-c', 'team-a')");
  await db.query("INSERT INTO team_memberships VALUES ('principal-a', 'team-a', 'active'), ('principal-b', 'team-b', 'active')");
  await db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-a', 'steward'), ('principal-b', 'team-b', 'space-b', 'reviewer')");
  const database = { connect: async () => ({
    query: (sql: string, params?: unknown[]) => db.query(sql, params), release() {},
  }) } as unknown as Pick<Pool, 'connect'>;
  let now = Date.parse('2026-07-01T09:00:00Z');
  const login = createSyntheticOidcLogin({
    issuer, clientId: 'workbench-test', audience: 'workbench-backend', backendOrigin, environment,
    identities: [
      { issuer, sub: 'person-a', principalId: 'principal-a', email: 'same@example.invalid' },
      { issuer, sub: 'person-b', principalId: 'principal-b', email: 'same@example.invalid' },
      { issuer, sub: 'person-no-grants', principalId: 'principal-no-grants' },
    ],
    clock: () => now,
  });
  login.registerHost(host.hostId, host.hostSecret);
  login.registerHost(otherHost.hostId, otherHost.hostSecret);
  const signIn = (selectedHost = host, sub = 'person-a') => {
    const attempt = login.begin(selectedHost);
    if (!attempt.ok) throw new Error('Expected synthetic login attempt');
    const code = login.issueFixtureCode(attempt.state, sub);
    if (!code) throw new Error('Expected fixture code');
    const completed = login.completeCallback({ state: attempt.state, code, backendOrigin, environment });
    if (!completed.ok) throw new Error('Expected synthetic callback');
    const redeemed = login.redeem({ ...selectedHost, reference: completed.reference });
    if (!redeemed.ok) throw new Error('Expected Host redemption');
    return redeemed.sessionHandle;
  };
  const read = (sessionHandle: string, selectedHost = host, selection?: typeof spaceA) =>
    readSyntheticSessionAssetSpaces(database, login, { ...selectedHost, sessionHandle }, selection);
  return { db, login, signIn, read, advance: (milliseconds: number) => { now += milliseconds; } };
};

describe('T29 identity to T07 current spaces (isolated PGlite only)', () => {
  it('derives zero, one and multiple spaces from current membership and roles without caller scopes', async () => {
    const { db, signIn, read } = await setup();
    const session = signIn();
    expect(await read(session)).toEqual({ ok: true, spaces: [spaceA], selected: spaceA });
    const noGrants = signIn(otherHost, 'person-no-grants');
    expect(await read(noGrants, otherHost)).toEqual({ ok: true, spaces: [], selected: null });
    await db.query("INSERT INTO team_memberships VALUES ('principal-a', 'team-b', 'active')");
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-c', 'reviewer'), ('principal-a', 'team-b', 'space-b', 'steward')");
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-a', 'reviewer')");
    expect(await read(session)).toEqual({ ok: true, spaces: [spaceA, spaceC, spaceB], selected: null });
    expect(await read(session, host, spaceB)).toEqual({ ok: true, spaces: [spaceA, spaceC, spaceB], selected: spaceB });
    expect(await read(session, host, { teamId: 'team-b', assetSpaceId: 'space-c' })).toEqual(denied);
  });

  it('ignores claimed principal and scope fields, and rejects guesses and cross-Host sessions', async () => {
    const { login, signIn, read } = await setup();
    const session = signIn();
    const personB = signIn(otherHost, 'person-b');
    expect(await read('guessed')).toEqual(denied);
    expect(await read(session, otherHost)).toEqual(denied);
    expect(await read(personB, host)).toEqual(denied);
    expect(await read(session, { ...host, hostSecret: 'wrong' })).toEqual(denied);
    expect(await read(session, { ...host, environment: 'production' })).toEqual(denied);
    const claimedHost = { ...host, principalId: 'principal-b', team_ids: ['team-b'], asset_space_ids: ['space-b'] };
    expect(await read(session, claimedHost)).toEqual({ ok: true, spaces: [spaceA], selected: spaceA });
    expect(await read(personB, otherHost, spaceA)).toEqual(denied);
    login.setRevocationAvailable(false);
    expect(await read(session)).toEqual(denied);
  });

  it('rechecks selection after role and membership removal without retaining the prior choice', async () => {
    const { db, signIn, read } = await setup();
    const session = signIn();
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('principal-a', 'team-a', 'space-c', 'reviewer')");
    expect((await read(session, host, spaceC)).ok).toBe(true);
    await db.query("DELETE FROM knowledge_role_bindings WHERE actor_id = 'principal-a' AND asset_space_id = 'space-c'");
    expect(await read(session, host, spaceC)).toEqual(denied);
    expect(await read(session)).toEqual({ ok: true, spaces: [spaceA], selected: spaceA });
    await db.query("UPDATE team_memberships SET status = 'disabled' WHERE actor_id = 'principal-a'");
    expect(await read(session, host, spaceA)).toEqual(denied);
    expect(await read(session)).toEqual({ ok: true, spaces: [], selected: null });
  });

  it('invalidates the old session on logout, account switch, expiry and simulated remote revocation', async () => {
    const { login, signIn, read, advance } = await setup();
    const first = signIn();
    const switched = signIn(host, 'person-b');
    expect(await read(first)).toEqual(denied);
    expect(await read(switched)).toEqual({ ok: true, spaces: [spaceB], selected: spaceB });
    login.logout(host);
    expect(await read(switched)).toEqual(denied);
    const current = signIn();
    advance(301_000);
    expect(await read(current)).toEqual(denied);
    const revoked = signIn();
    login.revoke(issuer, 'person-a');
    expect(await read(revoked)).toEqual(denied);
  });

  it('fails closed on a broken authorization read, rather than returning zero spaces', async () => {
    const { db, signIn, read } = await setup();
    const session = signIn();
    await db.query('DROP TABLE team_memberships');
    await expect(read(session)).rejects.toThrow();
  });
});
