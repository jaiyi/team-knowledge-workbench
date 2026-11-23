import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import type { AuthenticatedPrincipal, KnowledgeEvidenceVerifier } from '../../../packages/contracts/src/index.js';
import { recordKnowledgeTransition } from '../../../apps/api/src/application/record-knowledge-transition.js';
import { readAssetSpaceBinding } from '../../../apps/api/src/application/read-asset-space-binding.js';
import { readAuthorizedAssetSpaces } from '../../../apps/api/src/application/read-authorized-asset-spaces.js';

const migration = readFileSync(fileURLToPath(new URL('../../../apps/api/migrations/001_knowledge_transition_outbox.sql', import.meta.url)), 'utf8');
const authorizationMigration = readFileSync(fileURLToPath(new URL('../../../apps/api/migrations/003_asset_space_authorization_bindings.sql', import.meta.url)), 'utf8');
const digest = `sha256:${'a'.repeat(64)}`;
const knowledge = {
  knowledge_id: 'knowledge.test.case', version: '1.0.0', status: 'captured',
  team_id: 'team-a', asset_space_id: 'space-a', asset_repository_id: 'repo-a',
  repo_path: 'knowledge/quality/assembly-policy/torque-review/', taxonomy_version: 'v1',
  expected_acl_digest: digest, claims_confirmed: false, owner_id: 'owner-a', steward_id: 'steward-a',
  evidence_level: 'E1', sensitivity: 'internal',
  sources: [{ source_ref_id: 'src_1', kind: 'document', locator: 'fixture://source', content_digest: digest }],
  content: { conclusion: 'synthetic', claims: [{ claim_id: 'claim_1', kind: 'rule', statement: 'synthetic', source_refs: ['src_1'], confirmation: 'pending' }],
    applies_to: [], not_applies_to: [], inferences: [], unknowns: [] },
  asset_revision: 1, state_version: 0, created_at: '2026-10-15T09:00:00Z', updated_at: '2026-10-15T09:00:00Z',
} as const;
const command = {
  transition_id: 'transition-1', idempotency_key: 'idem-1', correlation_id: 'corr-1',
  asset_space_id: 'space-a', to: 'candidate', actor: { actor_id: 'human-1', actor_type: 'human' },
  reason: 'synthetic', expected_state_version: 0, expected_asset_revision: 1,
  evidence: [{ kind: 'source_confirmation', reference: 'source/1', claim_ids: ['claim_1'], source_ref_ids: ['src_1'] }],
  occurred_at: '2026-10-15T09:10:00Z',
} as const;
const principal: AuthenticatedPrincipal = { actor: command.actor, team_ids: ['team-a'],
  asset_space_ids: ['space-a'], roles: ['steward'] };
const verifier: KnowledgeEvidenceVerifier = { verify: (_asset, cmd) => ({
  ok: true, attestation: { evidence_fingerprint: JSON.stringify(cmd.evidence) },
}) };
const instances: PGlite[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map((db) => db.close()));
});

const setup = async () => {
  const db = new PGlite();
  instances.push(db);
  await db.exec(migration);
  await db.exec(authorizationMigration);
  await db.query("INSERT INTO asset_spaces VALUES ('space-a', 'team-a'), ('space-b', 'team-b')");
  await db.query("INSERT INTO team_memberships VALUES ('human-1', 'team-a', 'active')");
  await db.query("INSERT INTO knowledge_role_bindings VALUES ('human-1', 'team-a', 'space-a', 'steward')");
  const assetDigest = `sha256:${createHash('sha256').update(JSON.stringify(knowledge)).digest('hex')}`;
  await db.query('INSERT INTO knowledge_states VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [knowledge.knowledge_id, knowledge.team_id, knowledge.asset_space_id, knowledge.status,
      knowledge.state_version, knowledge.asset_revision, assetDigest]);
  const database = { connect: async () => ({
    query: (sql: string, params?: unknown[]) => db.query(sql, params), release() {},
  }) } as unknown as Pick<Pool, 'connect'>;
  return { db, database };
};

describe('ephemeral PostgreSQL engine (not external PG or recovery)', () => {
  it('applies the migration, records a transition and replays the same event exactly once', async () => {
    const { db, database } = await setup();
    expect(await recordKnowledgeTransition(database, principal, knowledge, command, verifier))
      .toEqual({ ok: true, transitionId: command.transition_id, stateVersion: 1, replayed: false });
    expect(await recordKnowledgeTransition(database, principal, knowledge, command, verifier))
      .toEqual({ ok: true, transitionId: command.transition_id, stateVersion: 1, replayed: true });
    expect((await db.query('SELECT * FROM knowledge_transition_events')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM knowledge_outbox')).rows).toHaveLength(1);
    await expect(db.query("INSERT INTO knowledge_outbox (event_id, knowledge_id, asset_space_id, state_version) VALUES ('transition-1', 'knowledge.test.case', 'space-b', 1)"))
      .rejects.toThrow();
    expect((await db.query<{ status: string; state_version: number }>('SELECT status, state_version FROM knowledge_states')).rows)
      .toEqual([{ status: 'candidate', state_version: 1 }]);
  });

  it('rejects missing/revoked grants, cross-team association and duplicate identifiers', async () => {
    const { db, database } = await setup();
    await db.query("DELETE FROM knowledge_role_bindings WHERE actor_id = 'human-1'");
    expect(await recordKnowledgeTransition(database, principal, knowledge, command, verifier))
      .toMatchObject({ ok: false, kind: 'authorization' });
    await expect(db.query("INSERT INTO knowledge_role_bindings VALUES ('human-1', 'team-b', 'space-a', 'steward')"))
      .rejects.toThrow();
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('human-1', 'team-a', 'space-a', 'steward')");
    expect((await recordKnowledgeTransition(database, principal, knowledge, command, verifier)).ok).toBe(true);
    expect(await recordKnowledgeTransition(database, principal, knowledge,
      { ...command, idempotency_key: 'different-id' }, verifier))
      .toMatchObject({ ok: false, kind: 'conflict' });
  });

  it('rechecks current membership before new requests and replay', async () => {
    const { db, database } = await setup();
    let verified = 0;
    const countingVerifier: KnowledgeEvidenceVerifier = { verify: (asset, cmd) => {
      verified += 1;
      return verifier.verify(asset, cmd);
    } };
    await db.query("UPDATE team_memberships SET status = 'disabled' WHERE actor_id = 'human-1'");
    expect(await recordKnowledgeTransition(database, principal, knowledge, command, countingVerifier))
      .toMatchObject({ ok: false, kind: 'authorization' });
    expect(verified).toBe(0);
    expect((await db.query('SELECT * FROM knowledge_transition_events')).rows).toHaveLength(0);
    await db.query("UPDATE team_memberships SET status = 'active' WHERE actor_id = 'human-1'");
    expect(await recordKnowledgeTransition(database, principal, knowledge, command, countingVerifier))
      .toMatchObject({ ok: true, replayed: false });
    await db.query("DELETE FROM team_memberships WHERE actor_id = 'human-1'");
    expect(await recordKnowledgeTransition(database, principal, knowledge, command, countingVerifier))
      .toMatchObject({ ok: false, kind: 'authorization' });
    expect(await recordKnowledgeTransition(database, principal, knowledge,
      { ...command, transition_id: 'transition-new', idempotency_key: 'idem-new' }, countingVerifier))
      .toMatchObject({ ok: false, kind: 'authorization' });
    expect(verified).toBe(1);
    expect((await db.query('SELECT * FROM knowledge_transition_events')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM knowledge_outbox')).rows).toHaveLength(1);
    expect((await db.query('SELECT status, state_version FROM knowledge_states')).rows)
      .toEqual([{ status: 'candidate', state_version: 1 }]);
  });

  it('revokes membership per team while leaving another team available', async () => {
    const { db, database } = await setup();
    const otherKnowledge = { ...knowledge, knowledge_id: 'knowledge.test.team-b', team_id: 'team-b',
      asset_space_id: 'space-b' };
    const otherCommand = { ...command, transition_id: 'transition-team-b', idempotency_key: 'idem-team-b',
      asset_space_id: 'space-b' };
    const otherPrincipal: AuthenticatedPrincipal = { ...principal, team_ids: ['team-a', 'team-b'],
      asset_space_ids: ['space-a', 'space-b'] };
    await db.query("INSERT INTO team_memberships VALUES ('human-1', 'team-b', 'active')");
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('human-1', 'team-b', 'space-b', 'steward')");
    const otherDigest = `sha256:${createHash('sha256').update(JSON.stringify(otherKnowledge)).digest('hex')}`;
    await db.query('INSERT INTO knowledge_states VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [otherKnowledge.knowledge_id, otherKnowledge.team_id, otherKnowledge.asset_space_id,
        otherKnowledge.status, otherKnowledge.state_version, otherKnowledge.asset_revision, otherDigest]);
    await db.query("UPDATE team_memberships SET status = 'disabled' WHERE team_id = 'team-a'");
    expect(await recordKnowledgeTransition(database, otherPrincipal, knowledge, command, verifier))
      .toMatchObject({ ok: false, kind: 'authorization' });
    expect(await recordKnowledgeTransition(database, otherPrincipal, otherKnowledge, otherCommand, verifier))
      .toMatchObject({ ok: true, replayed: false });
    expect((await db.query('SELECT team_id, asset_space_id FROM knowledge_transition_events')).rows)
      .toEqual([{ team_id: 'team-b', asset_space_id: 'space-b' }]);
  });

  it('keeps same-team space roles scoped and denies replay after revocation', async () => {
    const { db, database } = await setup();
    const otherKnowledge = { ...knowledge, knowledge_id: 'knowledge.test.other', asset_space_id: 'space-c' };
    const otherCommand = { ...command, transition_id: 'transition-other', idempotency_key: 'idem-other',
      asset_space_id: 'space-c' };
    const claimedPrincipal: AuthenticatedPrincipal = { ...principal,
      asset_space_ids: ['space-a', 'space-c'], roles: ['steward', 'reviewer'] };
    await db.query("INSERT INTO asset_spaces VALUES ('space-c', 'team-a')");
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('human-1', 'team-a', 'space-c', 'reviewer')");
    const otherDigest = `sha256:${createHash('sha256').update(JSON.stringify(otherKnowledge)).digest('hex')}`;
    await db.query('INSERT INTO knowledge_states VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [otherKnowledge.knowledge_id, otherKnowledge.team_id, otherKnowledge.asset_space_id,
        otherKnowledge.status, otherKnowledge.state_version, otherKnowledge.asset_revision, otherDigest]);
    let verified = 0;
    const countingVerifier: KnowledgeEvidenceVerifier = { verify: (asset, cmd) => {
      verified += 1;
      return verifier.verify(asset, cmd);
    } };
    const denied = { ok: false, kind: 'authorization' };
    expect(await recordKnowledgeTransition(database, claimedPrincipal, otherKnowledge, otherCommand, countingVerifier))
      .toMatchObject(denied);
    expect(await recordKnowledgeTransition(database, claimedPrincipal, otherKnowledge,
      { ...otherCommand, asset_space_id: 'space-a' }, countingVerifier)).toMatchObject(denied);
    expect(await recordKnowledgeTransition(database, claimedPrincipal, otherKnowledge,
      { ...otherCommand, actor: { actor_id: 'other', actor_type: 'human' } }, countingVerifier))
      .toMatchObject(denied);
    expect(verified).toBe(0);
    expect((await db.query('SELECT knowledge_id, status, state_version FROM knowledge_states ORDER BY knowledge_id')).rows)
      .toEqual([
        { knowledge_id: 'knowledge.test.case', status: 'captured', state_version: 0 },
        { knowledge_id: 'knowledge.test.other', status: 'captured', state_version: 0 },
      ]);
    expect((await db.query('SELECT * FROM knowledge_transition_events')).rows).toHaveLength(0);
    expect((await db.query('SELECT * FROM knowledge_outbox')).rows).toHaveLength(0);

    await db.query("INSERT INTO knowledge_role_bindings VALUES ('human-1', 'team-a', 'space-c', 'steward')");
    expect(await recordKnowledgeTransition(database, claimedPrincipal, otherKnowledge, otherCommand, countingVerifier))
      .toEqual({ ok: true, transitionId: 'transition-other', stateVersion: 1, replayed: false });
    await db.query("DELETE FROM knowledge_role_bindings WHERE actor_id = 'human-1' AND asset_space_id = 'space-c' AND role = 'steward'");
    expect(await recordKnowledgeTransition(database, claimedPrincipal, otherKnowledge, otherCommand, countingVerifier))
      .toMatchObject(denied);
    expect(await recordKnowledgeTransition(database, claimedPrincipal, otherKnowledge,
      { ...otherCommand, transition_id: 'transition-later', idempotency_key: 'idem-later' }, countingVerifier))
      .toMatchObject(denied);
    expect(verified).toBe(1);
    expect((await db.query('SELECT transition_id, asset_space_id FROM knowledge_transition_events')).rows)
      .toEqual([{ transition_id: 'transition-other', asset_space_id: 'space-c' }]);
    expect((await db.query('SELECT event_id, asset_space_id FROM knowledge_outbox')).rows)
      .toEqual([{ event_id: 'transition-other', asset_space_id: 'space-c' }]);
    expect((await db.query('SELECT status, state_version FROM knowledge_states WHERE knowledge_id = $1',
      [otherKnowledge.knowledge_id])).rows).toEqual([{ status: 'candidate', state_version: 1 }]);
    expect(await recordKnowledgeTransition(database, claimedPrincipal, knowledge, command, countingVerifier))
      .toEqual({ ok: true, transitionId: 'transition-1', stateVersion: 1, replayed: false });
    expect((await db.query('SELECT transition_id, asset_space_id FROM knowledge_transition_events ORDER BY transition_id')).rows)
      .toEqual([
        { transition_id: 'transition-1', asset_space_id: 'space-a' },
        { transition_id: 'transition-other', asset_space_id: 'space-c' },
      ]);
  });

  it('reads only scoped pending resource metadata without treating it as an active connection', async () => {
    const { db, database } = await setup();
    await db.query("INSERT INTO asset_spaces VALUES ('space-c', 'team-a')");
    const insert = `INSERT INTO asset_space_resource_bindings
      (team_id, asset_space_id, git_repository_id, git_protected_ref, weknora_space_id, config_version, status)
      VALUES ($1, $2, $3, 'refs/heads/main', $4, 1, 'pending')`;
    await db.query(insert, ['team-a', 'space-a', 'repo-a', 'weknora-a']);
    await db.query(insert, ['team-a', 'space-c', 'repo-c', 'weknora-c']);
    expect(await readAssetSpaceBinding(database, principal, 'team-a', 'space-a'))
      .toEqual({ assetSpaceId: 'space-a', gitRepositoryId: 'repo-a', gitProtectedRef: 'refs/heads/main',
        weknoraSpaceId: 'weknora-a', configVersion: 1, status: 'pending' });
    expect(await readAssetSpaceBinding(database, { ...principal, actor: { actor_id: 'other', actor_type: 'human' } },
      'team-a', 'space-a')).toBeNull();
    expect(await readAssetSpaceBinding(database, principal, 'team-a', 'space-c')).toBeNull();
    expect(await readAssetSpaceBinding(database, principal, 'team-b', 'space-b')).toBeNull();
    await expect(db.query(insert, ['team-b', 'space-c', 'repo-b', 'weknora-b'])).rejects.toThrow();
    await expect(db.query(insert, ['team-a', 'space-c', 'repo-a', 'weknora-duplicate'])).rejects.toThrow();
    await db.query("INSERT INTO asset_spaces VALUES ('space-d', 'team-b')");
    await expect(db.query(insert, ['team-b', 'space-d', 'repo-d', 'weknora-c'])).rejects.toThrow();
    await db.query("UPDATE asset_space_resource_bindings SET status = 'disabled', config_version = 2 WHERE asset_space_id = 'space-a'");
    expect(await readAssetSpaceBinding(database, principal, 'team-a', 'space-a'))
      .toMatchObject({ status: 'disabled', configVersion: 2 });
    await db.query("UPDATE team_memberships SET status = 'disabled' WHERE actor_id = 'human-1'");
    expect(await readAssetSpaceBinding(database, principal, 'team-a', 'space-a')).toBeNull();
    await db.query("UPDATE team_memberships SET status = 'active' WHERE actor_id = 'human-1'");
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('human-1', 'team-a', 'space-c', 'reviewer')");
    expect(await readAssetSpaceBinding(database, { ...principal, asset_space_ids: ['space-a', 'space-c'] },
      'team-a', 'space-c')).toMatchObject({ assetSpaceId: 'space-c', status: 'pending' });
    await db.query("DELETE FROM knowledge_role_bindings WHERE actor_id = 'human-1' AND asset_space_id = 'space-c'");
    await db.query("DELETE FROM knowledge_role_bindings WHERE actor_id = 'human-1'");
    expect(await readAssetSpaceBinding(database, principal, 'team-a', 'space-a')).toBeNull();
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('human-1', 'team-a', 'space-a', 'steward')");
    await db.query("DELETE FROM asset_space_resource_bindings WHERE asset_space_id = 'space-a'");
    expect(await readAssetSpaceBinding(database, principal, 'team-a', 'space-a')).toBeNull();
  });

  it('keeps separate-team pending resource bindings isolated', async () => {
    const { db, database } = await setup();
    await db.query("INSERT INTO team_memberships VALUES ('human-2', 'team-b', 'active')");
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('human-2', 'team-b', 'space-b', 'steward')");
    const insert = `INSERT INTO asset_space_resource_bindings
      (team_id, asset_space_id, git_repository_id, git_protected_ref, weknora_space_id, config_version, status)
      VALUES ($1, $2, $3, 'refs/heads/main', $4, 1, 'pending')`;
    await db.query(insert, ['team-a', 'space-a', 'repo-a', 'weknora-a']);
    await db.query(insert, ['team-b', 'space-b', 'repo-b', 'weknora-b']);
    const otherPrincipal: AuthenticatedPrincipal = { actor: { actor_id: 'human-2', actor_type: 'human' },
      team_ids: ['team-b'], asset_space_ids: ['space-b'], roles: ['steward'] };
    expect(await readAssetSpaceBinding(database, principal, 'team-a', 'space-a'))
      .toMatchObject({ gitRepositoryId: 'repo-a', weknoraSpaceId: 'weknora-a', status: 'pending' });
    expect(await readAssetSpaceBinding(database, otherPrincipal, 'team-b', 'space-b'))
      .toMatchObject({ gitRepositoryId: 'repo-b', weknoraSpaceId: 'weknora-b', status: 'pending' });
    expect(await readAssetSpaceBinding(database, { ...principal, team_ids: ['team-a', 'team-b'],
      asset_space_ids: ['space-a', 'space-b'] }, 'team-b', 'space-b')).toBeNull();
    expect(await readAssetSpaceBinding(database, { ...otherPrincipal, team_ids: ['team-a', 'team-b'],
      asset_space_ids: ['space-a', 'space-b'] }, 'team-a', 'space-a')).toBeNull();
    await expect(db.query(insert, ['team-a', 'space-b', 'repo-forged', 'weknora-forged'])).rejects.toThrow();
    await db.query("UPDATE team_memberships SET status = 'disabled' WHERE actor_id = 'human-2'");
    expect(await readAssetSpaceBinding(database, otherPrincipal, 'team-b', 'space-b')).toBeNull();
    expect(await readAssetSpaceBinding(database, principal, 'team-a', 'space-a'))
      .toMatchObject({ gitRepositoryId: 'repo-a', status: 'pending' });
  });

  it('enumerates only current spaces and rechecks selection after role and membership revocation', async () => {
    const { db, database } = await setup();
    const claimed: AuthenticatedPrincipal = { ...principal, team_ids: ['team-a', 'team-b'],
      asset_space_ids: ['space-a', 'space-b', 'space-c'], roles: ['steward', 'reviewer'] };
    expect(await readAuthorizedAssetSpaces(database, null)).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(await readAuthorizedAssetSpaces(database, { ...claimed, actor: { actor_id: 'service', actor_type: 'service' } }))
      .toEqual({ ok: false, reason: 'unauthenticated' });
    expect(await readAuthorizedAssetSpaces(database, { ...claimed, actor: { actor_id: 'other', actor_type: 'human' } }))
      .toEqual({ ok: true, spaces: [], selected: null });
    await db.query("INSERT INTO team_memberships VALUES ('human-2', 'team-b', 'active')");
    expect(await readAuthorizedAssetSpaces(database, { ...claimed, actor: { actor_id: 'human-2', actor_type: 'human' } }))
      .toEqual({ ok: true, spaces: [], selected: null });
    expect(await readAuthorizedAssetSpaces(database, { ...claimed, team_ids: [], asset_space_ids: [] }))
      .toEqual({ ok: true, spaces: [], selected: null });
    expect(await readAuthorizedAssetSpaces(database, claimed))
      .toEqual({ ok: true, spaces: [{ teamId: 'team-a', assetSpaceId: 'space-a' }],
        selected: { teamId: 'team-a', assetSpaceId: 'space-a' } });
    expect(await readAuthorizedAssetSpaces(database, claimed, { teamId: 'team-b', assetSpaceId: 'space-b' }))
      .toEqual({ ok: false, reason: 'unavailable' });

    await db.query("INSERT INTO asset_spaces VALUES ('space-c', 'team-a')");
    await db.query("INSERT INTO team_memberships VALUES ('human-1', 'team-b', 'active')");
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('human-1', 'team-a', 'space-a', 'reviewer')");
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('human-1', 'team-a', 'space-c', 'reviewer')");
    await db.query("INSERT INTO knowledge_role_bindings VALUES ('human-1', 'team-b', 'space-b', 'reviewer')");
    const spaces = [
      { teamId: 'team-a', assetSpaceId: 'space-a' },
      { teamId: 'team-a', assetSpaceId: 'space-c' },
      { teamId: 'team-b', assetSpaceId: 'space-b' },
    ];
    expect(await readAuthorizedAssetSpaces(database, { ...claimed, roles: [] }))
      .toEqual({ ok: true, spaces, selected: null });
    expect(await readAuthorizedAssetSpaces(database, claimed)).toEqual({ ok: true, spaces, selected: null });
    expect(await readAuthorizedAssetSpaces(database, claimed, { teamId: 'team-a', assetSpaceId: 'space-c' }))
      .toEqual({ ok: true, spaces, selected: spaces[1] });
    expect(await readAuthorizedAssetSpaces(database, claimed, { teamId: 'team-b', assetSpaceId: 'space-c' }))
      .toEqual({ ok: false, reason: 'unavailable' });
    expect(await readAuthorizedAssetSpaces(database, { ...principal, asset_space_ids: ['space-a', 'space-b'] },
      { teamId: 'team-b', assetSpaceId: 'space-b' })).toEqual({ ok: false, reason: 'unavailable' });

    await db.query("DELETE FROM knowledge_role_bindings WHERE actor_id = 'human-1' AND asset_space_id = 'space-c'");
    expect(await readAuthorizedAssetSpaces(database, claimed, spaces[1]))
      .toEqual({ ok: false, reason: 'unavailable' });
    await db.query("UPDATE team_memberships SET status = 'disabled' WHERE actor_id = 'human-1' AND team_id = 'team-b'");
    expect(await readAuthorizedAssetSpaces(database, claimed, spaces[2]))
      .toEqual({ ok: false, reason: 'unavailable' });
    expect(await readAuthorizedAssetSpaces(database, claimed)).toEqual({ ok: true, spaces: [spaces[0]], selected: spaces[0] });
    await db.query("DELETE FROM team_memberships WHERE actor_id = 'human-1' AND team_id = 'team-a'");
    expect(await readAuthorizedAssetSpaces(database, claimed))
      .toEqual({ ok: true, spaces: [], selected: null });
    expect(await readAuthorizedAssetSpaces(database, claimed, spaces[0]))
      .toEqual({ ok: false, reason: 'unavailable' });
  });

  it('keeps selection eligibility independent from pending, disabled, or missing resource bindings', async () => {
    const { db, database } = await setup();
    const select = { teamId: 'team-a', assetSpaceId: 'space-a' };
    expect(await readAuthorizedAssetSpaces(database, principal, select))
      .toEqual({ ok: true, spaces: [select], selected: select });
    await db.query(`INSERT INTO asset_space_resource_bindings
      (team_id, asset_space_id, git_repository_id, git_protected_ref, weknora_space_id, config_version, status)
      VALUES ('team-a', 'space-a', 'repo-a', 'refs/heads/main', 'weknora-a', 1, 'pending')`);
    expect(await readAuthorizedAssetSpaces(database, principal, select))
      .toEqual({ ok: true, spaces: [select], selected: select });
    await db.query("UPDATE asset_space_resource_bindings SET status = 'disabled' WHERE asset_space_id = 'space-a'");
    expect(await readAuthorizedAssetSpaces(database, principal, select))
      .toEqual({ ok: true, spaces: [select], selected: select });
    await db.query('DROP TABLE team_memberships');
    await expect(readAuthorizedAssetSpaces(database, principal)).rejects.toThrow();
  });

  it('does not commit state or event when the outbox insert fails', async () => {
    const { db, database } = await setup();
    await db.query('DROP TABLE knowledge_outbox');
    expect(await recordKnowledgeTransition(database, principal, knowledge, command, verifier))
      .toMatchObject({ ok: false, kind: 'database' });
    expect((await db.query('SELECT * FROM knowledge_transition_events')).rows).toHaveLength(0);
    expect((await db.query<{ status: string }>('SELECT status FROM knowledge_states')).rows[0]?.status).toBe('captured');
  });
});
