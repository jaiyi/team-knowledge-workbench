type Member = {
  actor_id: string;
  team_id: string;
  asset_space_ids: string[];
  can_create: boolean;
};

type Source = {
  source_id: string;
  team_id: string;
  asset_space_id: string;
  valid: boolean;
};

type Request = {
  actor_id: string;
  source_id: string;
  asset_space_id: string;
  purpose: string;
  action: 'create_knowledge' | 'create_skill';
  baseline_digest: string;
  idempotency_key: string;
};

const names = ['我的工作台', '提炼知识&经验', '打磨可复用的技能', '连接业务数据源', '团队业务资产大盘'];

export function createSyntheticCreationGate(fixture: {
  members: Member[];
  sources: Source[];
  baseline_digest: string;
}) {
  const sessions = new Map<string, { intent: string; session_id: string; draft_id: string }>();
  const revoked = new Set<string>();
  let baselineDigest = fixture.baseline_digest;

  return {
    entries(actorId: string) {
      if (!fixture.members.some((member) => member.actor_id === actorId && !revoked.has(actorId))) return [];
      return names.map((name, index) => ({
        name, disabled_reason: index === 0 ? null : 'external_provider_unavailable', provider_status: 'fixture_only',
      }));
    },
    inspect(actorId: string, _action: 'browse' | 'revisit' | 'cancel' | 'reuse') {
      if (!fixture.members.some((member) => member.actor_id === actorId && !revoked.has(actorId))) {
        return { ok: false, reason: 'unauthorized' };
      }
      return { ok: true, session_id: null, draft_id: null };
    },
    start(actorId: string, request: Request) {
      const denied = (reason: string) => ({ ok: false as const, reason });
      const member = fixture.members.find((item) => item.actor_id === actorId && !revoked.has(actorId)
        && item.actor_id === request.actor_id && item.can_create && item.asset_space_ids.includes(request.asset_space_id)
        && fixture.sources.some((source) => source.source_id === request.source_id
          && source.team_id === item.team_id && source.asset_space_id === request.asset_space_id));
      if (!member) return denied('unauthorized');
      const source = fixture.sources.find((item) => item.source_id === request.source_id && item.valid
        && item.team_id === member.team_id && item.asset_space_id === request.asset_space_id);
      if (!source) return denied('invalid_source');
      if (request.baseline_digest !== baselineDigest) return denied('stale_baseline');
      if (!request.purpose.trim() || !request.idempotency_key.trim()
        || !['create_knowledge', 'create_skill'].includes(request.action)) return denied('invalid_intent');

      const key = `${actorId}:${request.asset_space_id}:${request.idempotency_key}`;
      const intent = JSON.stringify([request.source_id, request.purpose, request.action, request.baseline_digest]);
      const existing = sessions.get(key);
      if (existing) {
        if (existing.intent !== intent) return denied('idempotency_conflict');
        return { ok: true as const, session_id: existing.session_id, draft_id: existing.draft_id };
      }
      const id = sessions.size + 1;
      const created = { intent, session_id: `cs_${id}`, draft_id: `draft_${id}` };
      sessions.set(key, created);
      return { ok: true as const, session_id: created.session_id, draft_id: created.draft_id };
    },
    counts() { return { sessions: sessions.size, drafts: sessions.size, team_assets: 0 }; },
    revoke(actorId: string) { revoked.add(actorId); },
    restore(actorId: string) { revoked.delete(actorId); },
    invalidateSource(sourceId: string) {
      const source = fixture.sources.find((item) => item.source_id === sourceId);
      if (source) source.valid = false;
    },
    restoreSource(sourceId: string) {
      const source = fixture.sources.find((item) => item.source_id === sourceId);
      if (source) source.valid = true;
    },
    changeBaseline(digest: string) { baselineDigest = digest; },
  };
}
