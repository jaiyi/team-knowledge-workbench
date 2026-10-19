import { describe, expect, it } from 'vitest';
import { transitionKnowledge } from '../../packages/domain/src/index.js';
import type { KnowledgeAsset } from '../../packages/contracts/src/index.js';
import { createFakeGit } from '../support/fake-git.js';

const commit = '0123456789abcdef0123456789abcdef01234567';
const path = 'knowledge/quality/assembly-policy/torque-review/';
const makeApproved = (): KnowledgeAsset => ({
  knowledge_id: 'knowledge.quality.assembly-policy', version: '1.0.0', status: 'approved',
  team_id: 'team-a', asset_space_id: 'space-a', asset_repository_id: 'repo-a', repo_path: path,
  taxonomy_version: 'v1', expected_acl_digest: 'sha256:' + 'a'.repeat(64),
  claims_confirmed: true, owner_id: 'owner-a', steward_id: 'steward-a', evidence_level: 'E1',
  sensitivity: 'internal', sources: [{ source_ref_id: 'src_1', kind: 'document', locator: 'meeting://fixture', content_digest: 'sha256:' + 'a'.repeat(64) }],
  content: { conclusion: 'Fixture conclusion', claims: [{ claim_id: 'claim_1', kind: 'rule', statement: 'Fixture rule', source_refs: ['src_1'], confirmation: 'confirmed' }], applies_to: [], not_applies_to: [], inferences: [], unknowns: [] },
  asset_revision: 1, state_version: 0, created_at: '2026-10-15T09:00:00Z', updated_at: '2026-10-15T09:00:00Z',
});

const event = { eventId: 'event-1', repositoryId: 'repo-a', protectedRef: 'refs/heads/main', parentCommitSha: null, commitSha: commit, changedPaths: [`${path}metadata.yaml`] };

describe('fake Git contract (local fixtures only)', () => {
  it('denies direct protected-ref writes and unrelated or malformed merge events', () => {
    const git = createFakeGit('repo-a', path);
    expect(() => git.writeProtectedRef()).toThrow();
    for (const invalid of [
      { repositoryId: 'repo-b' },
      { protectedRef: 'refs/heads/other' },
      { changedPaths: [`${path}../other/metadata.yaml`] },
      { changedPaths: ['knowledge/quality/assembly-policy/torque-review-other/metadata.yaml'] },
      { commitSha: 'not-a-commit' },
    ]) {
      expect(() => git.merge({ ...event, ...invalid })).toThrow();
      expect(git.readMerge(event.eventId)).toBeNull();
    }
  });

  it('rejects out-of-order and stale-parent merge events without recording them', () => {
    const git = createFakeGit('repo-a', path);
    const next = { ...event, eventId: 'event-2', parentCommitSha: commit, commitSha: 'f'.repeat(40) };
    expect(() => git.merge(next)).toThrow();
    expect(git.readMerge(next.eventId)).toBeNull();
    expect(git.mergeCount()).toBe(0);

    git.merge(event);
    git.merge(next);
    expect(git.readMerge(event.eventId)?.commit_sha).toBe(commit);
    expect(git.readMerge(next.eventId)?.commit_sha).toBe(next.commitSha);
    git.merge(event);
    expect(git.mergeCount()).toBe(2);
    expect(() => git.merge({ ...next, eventId: 'event-3', parentCommitSha: null })).toThrow();
    expect(() => git.merge({ ...next, eventId: 'event-3', parentCommitSha: commit })).toThrow();
    expect(git.readMerge('event-3')).toBeNull();
    expect(git.mergeCount()).toBe(2);
  });

  it('records one merge event and uses its independent read-back for publishing', () => {
    const git = createFakeGit('repo-a', path);
    git.merge(event);
    const mutablePaths = [...event.changedPaths];
    git.merge({ ...event, changedPaths: mutablePaths });
    mutablePaths[0] = 'knowledge/quality/assembly-policy/other/metadata.yaml';
    expect(git.readMerge(event.eventId)?.changed_paths).toEqual([`${path}metadata.yaml`]);
    expect(git.mergeCount()).toBe(1);
    expect(() => git.merge({ ...event, commitSha: 'f'.repeat(40) })).toThrow();
    expect(git.mergeCount()).toBe(1);
    expect(git.readMerge('missing')).toBeNull();

    const evidence = git.readMerge(event.eventId);
    expect(evidence).not.toBeNull();
    const knowledge = makeApproved();
    const result = transitionKnowledge(knowledge, {
      transition_id: 'transition-1', idempotency_key: 'idempotency-1', correlation_id: 'correlation-1',
      asset_space_id: 'space-a', to: 'publishing', actor: { actor_id: 'human-1', actor_type: 'human' },
      reason: 'fake merge read-back', expected_state_version: 0, expected_asset_revision: 1,
      evidence: [evidence!], occurred_at: '2026-10-15T09:10:00Z',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.knowledge.source_commit).toBe(commit);
  });
});
