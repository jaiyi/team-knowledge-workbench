import type { GitMergeEvidence } from '../../packages/contracts/src/index.js';
import { isKnowledgePathChanged } from '../../packages/domain/src/path-boundary.js';

type FakeMergeEvent = {
  eventId: string;
  repositoryId: string;
  protectedRef: string;
  parentCommitSha: string | null;
  commitSha: string;
  changedPaths: string[];
};

export const createFakeGit = (repositoryId: string, repoPath: string) => {
  const events = new Map<string, FakeMergeEvent>();
  let head: string | null = null;
  let headEventId: string | null = null;
  const readMerge = (eventId: string): GitMergeEvidence | null => {
    const event = events.get(eventId);
    if (!event) return null;
    return {
      kind: 'git_merge', reference: `fake-merge/${event.eventId}`,
      commit_sha: event.commitSha, repository_id: event.repositoryId,
      protected_ref: 'refs/heads/main', merge_event_id: event.eventId,
      changed_paths: [...event.changedPaths], signature_verified: true,
    };
  };

  return {
    writeProtectedRef: () => { throw new Error('Direct protected-ref write is forbidden'); },
    merge: (event: FakeMergeEvent): void => {
      if (
        event.repositoryId !== repositoryId
        || event.protectedRef !== 'refs/heads/main'
        || !/^[0-9a-f]{40}$/.test(event.commitSha)
        || (event.parentCommitSha !== null && !/^[0-9a-f]{40}$/.test(event.parentCommitSha))
        || !event.changedPaths.some((path) => isKnowledgePathChanged(repoPath, path))
        || event.changedPaths.some((path) => !isKnowledgePathChanged(repoPath, path))
      ) throw new Error('Invalid fake merge event');
      const recorded = events.get(event.eventId);
      if (recorded) {
        if (JSON.stringify(recorded) !== JSON.stringify(event)) throw new Error('Conflicting fake merge event');
        return;
      }
      if (event.parentCommitSha !== head || event.commitSha === head) throw new Error('Stale fake merge parent');
      events.set(event.eventId, { ...event, changedPaths: [...event.changedPaths] });
      head = event.commitSha;
      headEventId = event.eventId;
    },
    readMerge,
    readCurrentMerge: (eventId: string): GitMergeEvidence | null => {
      const event = events.get(eventId);
      return event && event.eventId === headEventId ? readMerge(eventId) : null;
    },
    mergeCount: (): number => events.size,
  };
};
