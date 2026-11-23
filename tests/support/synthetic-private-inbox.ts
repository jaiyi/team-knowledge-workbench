import type { AuthenticatedPrincipal } from '../../packages/contracts/src/index.js';

type Member = { actor_id: string; team_id: string; asset_space_ids: string[] };
type Space = { asset_space_id: string; team_id: string };
type Source = {
  source_id: string; team_id: string; asset_space_id: string; locator: string;
  purpose: string; retainable: boolean; valid: boolean; allowed_actor_ids: string[]; expires_at: number;
};
type Item = {
  inbox_item_id: string; owner_principal_id: string; team_id: string; origin_space_id: string;
  source_ref: string; locator: string; purpose: string; note_excerpt: string;
  status: 'saved'; created_at: string; expires_at: string;
};
type SaveRequest = {
  source_id: string; asset_space_id: string; purpose: string; note?: string; idempotency_key: string;
};

const denied = { ok: false as const, reason: 'unavailable' };
const safeLocator = (value: string) => /^fixture:\/\/[a-z0-9/-]+$/.test(value);
const saveKeys = ['source_id', 'asset_space_id', 'purpose', 'note', 'idempotency_key'];

export function createSyntheticPrivateInbox(fixture: {
  members: Member[]; spaces: Space[]; sources: Source[]; clock: () => number;
}) {
  const members = fixture.members.map((member) => ({ ...member, asset_space_ids: [...member.asset_space_ids] }));
  const spaces = fixture.spaces.map((space) => ({ ...space }));
  const sources = fixture.sources.map((source) => ({ ...source, allowed_actor_ids: [...source.allowed_actor_ids] }));
  const principals = new WeakMap<AuthenticatedPrincipal, {
    actorId: string; actor: AuthenticatedPrincipal['actor']; teamIds: readonly string[];
    spaceIds: readonly string[];
  }>();
  const items = new Map<string, Item>();
  const removed = new Set<string>();
  const saveKeysByActor = new Map<string, string>();
  const revoked = new Set<string>();
  let nextId = 1;

  const membership = (principal: AuthenticatedPrincipal | null, spaceId: string): Member | undefined => {
    const trusted = principal && principals.get(principal);
    if (!trusted || !principal || principal.actor !== trusted.actor
      || principal.team_ids !== trusted.teamIds || principal.asset_space_ids !== trusted.spaceIds
      || trusted.actorId !== principal.actor.actor_id || principal.actor.actor_type !== 'human'
      || revoked.has(principal.actor.actor_id) || !principal.asset_space_ids.includes(spaceId)) return undefined;
    const space = spaces.find((entry) => entry.asset_space_id === spaceId);
    return members.find((member) => member.actor_id === principal.actor.actor_id
      && member.team_id === space?.team_id && principal.team_ids.includes(member.team_id)
      && member.asset_space_ids.includes(spaceId));
  };
  const permittedSource = (member: Member, sourceId: string, spaceId: string, purpose: string) =>
    sources.find((source) => source.source_id === sourceId && source.team_id === member.team_id
      && source.asset_space_id === spaceId && source.purpose === purpose && source.valid
      && source.allowed_actor_ids.includes(member.actor_id) && source.retainable
      && source.expires_at > fixture.clock() && safeLocator(source.locator));
  const accessible = (principal: AuthenticatedPrincipal | null, spaceId: string, itemId: string) => {
    const member = membership(principal, spaceId);
    if (!member) return undefined;
    const item = items.get(itemId);
    if (!item || item.owner_principal_id !== member.actor_id
      || item.team_id !== member.team_id || item.origin_space_id !== spaceId
      || Date.parse(item.expires_at) <= fixture.clock()
      || permittedSource(member, item.source_ref, spaceId, item.purpose)?.locator !== item.locator) return undefined;
    return item;
  };
  const copy = (item: Item): Item => ({ ...item });

  return {
    authenticate(actorId: string): AuthenticatedPrincipal | null {
      const active = members.filter((member) => member.actor_id === actorId && !revoked.has(actorId));
      if (!active.length) return null;
      const principal: AuthenticatedPrincipal = {
        actor: { actor_id: actorId, actor_type: 'human' },
        team_ids: [...new Set(active.map((member) => member.team_id))],
        asset_space_ids: spaces.filter((space) => active.some((member) =>
          member.team_id === space.team_id && member.asset_space_ids.includes(space.asset_space_id)))
          .map((space) => space.asset_space_id),
        roles: [],
      };
      Object.freeze(principal.actor);
      Object.freeze(principal.team_ids);
      Object.freeze(principal.asset_space_ids);
      Object.freeze(principal);
      principals.set(principal, { actorId, actor: principal.actor,
        teamIds: principal.team_ids, spaceIds: principal.asset_space_ids });
      return principal;
    },
    save(principal: AuthenticatedPrincipal | null, raw: unknown) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || Object.keys(raw).some((key) => !saveKeys.includes(key))) return denied;
      const request = raw as SaveRequest;
      if (typeof request.source_id !== 'string' || typeof request.asset_space_id !== 'string'
        || typeof request.purpose !== 'string' || typeof request.idempotency_key !== 'string'
        || !request.idempotency_key.trim() || (request.note !== undefined &&
          (typeof request.note !== 'string' || request.note.length > 200 || request.note.includes('\0')))) return denied;
      const member = membership(principal, request.asset_space_id);
      const source = member && permittedSource(member, request.source_id, request.asset_space_id, request.purpose);
      if (!member || !source) return denied;
      const key = JSON.stringify([member.actor_id, request.asset_space_id, request.idempotency_key]);
      const previousId = saveKeysByActor.get(key);
      if (previousId) {
        const previous = accessible(principal, request.asset_space_id, previousId);
        if (!previous || previous.source_ref !== request.source_id || previous.purpose !== request.purpose
          || previous.note_excerpt !== (request.note ?? '')) return denied;
        return { ok: true as const, item: copy(previous) };
      }
      const item: Item = {
        inbox_item_id: `inbox_${nextId++}`, owner_principal_id: member.actor_id, team_id: member.team_id,
        origin_space_id: request.asset_space_id, source_ref: source.source_id, locator: source.locator,
        purpose: request.purpose, note_excerpt: request.note ?? '', status: 'saved',
        created_at: new Date(fixture.clock()).toISOString(), expires_at: new Date(source.expires_at).toISOString(),
      };
      items.set(item.inbox_item_id, item);
      saveKeysByActor.set(key, item.inbox_item_id);
      return { ok: true as const, item: copy(item) };
    },
    list(principal: AuthenticatedPrincipal | null, spaceId: string) {
      const member = membership(principal, spaceId);
      if (!member) return denied;
      const selected = [...items.values()].filter((item) => item.owner_principal_id === member.actor_id
 && item.team_id === member.team_id
        && item.origin_space_id === spaceId);
      if (selected.some((item) => !accessible(principal, spaceId, item.inbox_item_id))) return denied;
      return { ok: true as const, items: selected.map(copy) };
    },
    revisit(principal: AuthenticatedPrincipal | null, spaceId: string, itemId: string) {
      const item = accessible(principal, spaceId, itemId);
      return item ? { ok: true as const, item: copy(item) } : denied;
    },
    navigate(principal: AuthenticatedPrincipal | null, spaceId: string, itemId: string) {
      const item = accessible(principal, spaceId, itemId);
      return item ? { ok: true as const, pending_locator: item.locator } : denied;
    },
    remove(principal: AuthenticatedPrincipal | null, spaceId: string, itemId: string) {
      const item = accessible(principal, spaceId, itemId);
      if (!item) return denied;
      items.delete(itemId);
      removed.add(itemId);
      return { ok: true as const, removed: true as const };
    },
    counts() { return { saved: items.size, removed: removed.size }; },
    revoke(actorId: string) { revoked.add(actorId); },
    restore(actorId: string) { revoked.delete(actorId); },
    revokeSpace(actorId: string, spaceId: string) {
      for (const member of members.filter((entry) => entry.actor_id === actorId)) {
        member.asset_space_ids = member.asset_space_ids.filter((id) => id !== spaceId);
      }
    },
    invalidateSource(sourceId: string) {
      const source = sources.find((entry) => entry.source_id === sourceId);
      if (source) source.valid = false;
    },
    restoreSource(sourceId: string) {
      const source = sources.find((entry) => entry.source_id === sourceId);
      if (source) source.valid = true;
    },
    revokeSourceAccess(sourceId: string, actorId: string) {
      const source = sources.find((entry) => entry.source_id === sourceId);
      if (source) source.allowed_actor_ids = source.allowed_actor_ids.filter((id) => id !== actorId);
    },
    grantSourceAccess(sourceId: string, actorId: string) {
      const source = sources.find((entry) => entry.source_id === sourceId);
      if (source && !source.allowed_actor_ids.includes(actorId)) source.allowed_actor_ids.push(actorId);
    },
    setRetainable(sourceId: string, retainable: boolean) {
      const source = sources.find((entry) => entry.source_id === sourceId);
      if (source) source.retainable = retainable;
    },
    changeLocator(sourceId: string, locator: string) {
      const source = sources.find((entry) => entry.source_id === sourceId);
      if (source) source.locator = locator;
    },
  };
}
