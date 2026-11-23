import type { AuthenticatedPrincipal } from '../../packages/contracts/src/index.js';

type Member = { actor_id: string; team_id: string; asset_space_ids: string[]; can_triage: boolean };
type Space = { asset_space_id: string; team_id: string };
type Task = { task_ref: string; actor_id: string; asset_space_id: string; valid: boolean; expires_at: number };
type Report = {
  asset_space_id: string; category: string; summary: string; idempotency_key: string; task_ref?: string;
};
type Feedback = {
  feedback_id: string; reporter_id: string; asset_space_id: string; category: string; summary: string;
  task_ref: string | null; status: 'received' | 'triaged' | 'closed'; owner: string | null;
  next_check_at: string | null; disposition: string | null; decision_reason: string | null;
  attribution: 'unverified'; created_at: string;
};

const denied = { ok: false as const, reason: 'unavailable' };
const categories = ['answer_incorrect', 'outdated', 'missing', 'unusable', 'permission', 'other'];
const dispositions = ['knowledge', 'skill', 'provider', 'platform', 'business', 'closed'];
const reportKeys = ['asset_space_id', 'category', 'summary', 'idempotency_key', 'task_ref'];
const safeText = (value: unknown) => typeof value === 'string' && value.trim().length > 0
  && value.length <= 280 && !/[\0\r\n]/.test(value) && !/\b(?:https?:\/\/|fixture:\/\/)/i.test(value);

export function createSyntheticFeedbackCandidate(fixture: {
  members: Member[]; spaces: Space[]; tasks: Task[]; clock: () => number;
}) {
  const members = fixture.members.map((member) => ({ ...member, asset_space_ids: [...member.asset_space_ids] }));
  const spaces = fixture.spaces.map((space) => ({ ...space }));
  const tasks = fixture.tasks.map((task) => ({ ...task }));
  const principals = new WeakMap<AuthenticatedPrincipal, {
    actor: AuthenticatedPrincipal['actor']; teamIds: readonly string[]; spaceIds: readonly string[];
  }>();
  const feedback = new Map<string, Feedback>();
  const keys = new Map<string, { id: string; fingerprint: string }>();
  const revoked = new Set<string>();
  let nextId = 1;

  const memberFor = (principal: AuthenticatedPrincipal | null, spaceId: string): Member | undefined => {
    const issued = principal && principals.get(principal);
    if (!principal || !issued || principal.actor !== issued.actor
      || principal.team_ids !== issued.teamIds || principal.asset_space_ids !== issued.spaceIds
      || principal.actor.actor_type !== 'human' || revoked.has(principal.actor.actor_id)
      || !principal.asset_space_ids.includes(spaceId)) return undefined;
    const space = spaces.find((entry) => entry.asset_space_id === spaceId);
    return members.find((member) => member.actor_id === principal.actor.actor_id
      && member.team_id === space?.team_id && principal.team_ids.includes(member.team_id)
      && member.asset_space_ids.includes(spaceId));
  };
  const validTask = (taskRef: string, reporterId: string, spaceId: string) =>
    tasks.some((task) => task.task_ref === taskRef && task.actor_id === reporterId
      && task.asset_space_id === spaceId && task.valid && task.expires_at > fixture.clock());
  const copy = (item: Feedback): Feedback => ({ ...item });
  const accessible = (principal: AuthenticatedPrincipal | null, spaceId: string, id: string) => {
    const member = memberFor(principal, spaceId);
    const item = feedback.get(id);
    if (!member || !item || item.asset_space_id !== spaceId
      || (member.actor_id !== item.reporter_id && !member.can_triage)
      || (item.task_ref && !validTask(item.task_ref, item.reporter_id, spaceId))) return undefined;
    return item;
  };

  return {
    authenticate(actorId: string): AuthenticatedPrincipal | null {
      const active = members.filter((member) => member.actor_id === actorId && !revoked.has(actorId));
      if (!active.length) return null;
      const principal: AuthenticatedPrincipal = {
        actor: { actor_id: actorId, actor_type: 'human' },
        team_ids: [...new Set(active.map((member) => member.team_id))],
        asset_space_ids: spaces.filter((space) => active.some((member) =>
          member.team_id === space.team_id && member.asset_space_ids.includes(space.asset_space_id)))
          .map((space) => space.asset_space_id), roles: [],
      };
      Object.freeze(principal.actor);
      Object.freeze(principal.team_ids);
      Object.freeze(principal.asset_space_ids);
      Object.freeze(principal);
      principals.set(principal, { actor: principal.actor, teamIds: principal.team_ids,
        spaceIds: principal.asset_space_ids });
      return principal;
    },
    report(principal: AuthenticatedPrincipal | null, raw: unknown) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || Object.keys(raw).some((key) => !reportKeys.includes(key))) return denied;
      const request = raw as Report;
      if (typeof request.asset_space_id !== 'string' || !categories.includes(request.category)
        || !safeText(request.summary) || typeof request.idempotency_key !== 'string'
        || !request.idempotency_key.trim() || request.idempotency_key.length > 128
        || (request.task_ref !== undefined && (typeof request.task_ref !== 'string'
          || !/^task-[a-z0-9-]+$/.test(request.task_ref)))) return denied;
      const member = memberFor(principal, request.asset_space_id);
      if (!member || (request.task_ref && !validTask(request.task_ref, member.actor_id, request.asset_space_id)))
        return denied;
      const fingerprint = JSON.stringify([request.category, request.summary, request.task_ref ?? null]);
      const key = JSON.stringify([member.actor_id, request.asset_space_id, request.idempotency_key]);
      const previous = keys.get(key);
      if (previous) {
        const item = accessible(principal, request.asset_space_id, previous.id);
        return item && previous.fingerprint === fingerprint ? { ok: true as const, feedback: copy(item) } : denied;
      }
      const item: Feedback = {
        feedback_id: `feedback_${nextId++}`, reporter_id: member.actor_id,
        asset_space_id: request.asset_space_id, category: request.category, summary: request.summary,
        task_ref: request.task_ref ?? null, status: 'received', owner: null, next_check_at: null,
        disposition: null, decision_reason: null, attribution: 'unverified',
        created_at: new Date(fixture.clock()).toISOString(),
      };
      feedback.set(item.feedback_id, item);
      keys.set(key, { id: item.feedback_id, fingerprint });
      return { ok: true as const, feedback: copy(item) };
    },
    revisit(principal: AuthenticatedPrincipal | null, spaceId: string, id: string) {
      const item = accessible(principal, spaceId, id);
      return item ? { ok: true as const, feedback: {
        ...copy(item), task_ref: principal?.actor.actor_id === item.reporter_id ? item.task_ref : null,
      } } : denied;
    },
    triage(principal: AuthenticatedPrincipal | null, spaceId: string, id: string, raw: unknown) {
      const member = memberFor(principal, spaceId);
      const item = accessible(principal, spaceId, id);
      if (!member?.can_triage || !item || item.status === 'closed' || !raw
        || typeof raw !== 'object' || Array.isArray(raw)
        || Object.keys(raw).some((key) => !['disposition', 'reason'].includes(key))) return denied;
      const input = raw as { disposition: string; reason: string };
      if (!dispositions.includes(input.disposition) || !safeText(input.reason)) return denied;
      item.status = input.disposition === 'closed' ? 'closed' : 'triaged';
      item.owner = member.actor_id;
      item.disposition = input.disposition;
      item.decision_reason = input.reason;
      item.next_check_at = item.status === 'closed' ? null : new Date(fixture.clock() + 1000).toISOString();
      return { ok: true as const, feedback: {
        ...copy(item), task_ref: member.actor_id === item.reporter_id ? item.task_ref : null,
      } };
    },
    counts: () => ({ feedback: feedback.size }),
    revoke: (actorId: string) => { revoked.add(actorId); },
    restore: (actorId: string) => { revoked.delete(actorId); },
    revokeSpace(actorId: string, spaceId: string) {
      for (const member of members.filter((entry) => entry.actor_id === actorId)) {
        member.asset_space_ids = member.asset_space_ids.filter((id) => id !== spaceId);
      }
    },
  };
}
