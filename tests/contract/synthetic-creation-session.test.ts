import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSyntheticCreationGate } from '../support/synthetic-creation-session.js';

const sourceText = readFileSync(new URL('../../docs/工程设计/合成测试基线/01-虚构来源资料.md', import.meta.url), 'utf8');
const baselineDigest = 'cb64e758d67558ccb51eeb06d07e898a1a66e43ab0953ea313c9fa40adf2d66f';

const members = [
  { actor_id: 'ROLE-OWNER', team_id: 'TEAM-ORION', asset_space_ids: ['AS-ORION'], can_create: true },
  { actor_id: 'ROLE-OTHER', team_id: 'TEAM-VEGA', asset_space_ids: ['AS-VEGA'], can_create: true },
];
const source = { source_id: 'SRC-REQ-01', team_id: 'TEAM-ORION', asset_space_id: 'AS-ORION', valid: true };
const request = {
  actor_id: 'ROLE-OWNER', source_id: 'SRC-REQ-01', asset_space_id: 'AS-ORION',
  purpose: '核对 E-17 来源资料', action: 'create_knowledge' as const,
  baseline_digest: baselineDigest, idempotency_key: 'operation-1',
};
const setup = () => createSyntheticCreationGate({
  members: members.map((member) => ({ ...member, asset_space_ids: [...member.asset_space_ids] })),
  sources: [{ ...source }], baseline_digest: baselineDigest,
});

describe('T01 creation session boundary (isolated fake only)', () => {
  it('lists exactly five workbench entries without treating DSH chat as an entry', () => {
    const gate = setup();
    expect(gate.entries('ROLE-OWNER').map(({ name }) => name)).toEqual([
      '我的工作台', '提炼知识&经验', '打磨可复用的技能', '连接业务数据源', '团队业务资产大盘',
    ]);
    expect(gate.entries('ROLE-OWNER')[0]).toEqual({
      name: '我的工作台', disabled_reason: null, provider_status: 'fixture_only',
    });
    expect(gate.entries('ROLE-OWNER').slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ disabled_reason: 'external_provider_unavailable', provider_status: 'fixture_only' }),
    ]));
    expect(gate.entries('missing')).toEqual([]);
    expect(gate.counts()).toEqual({ sessions: 0, drafts: 0, team_assets: 0 });
  });

  it('keeps browsing, revisiting, cancellation and reuse read-only', () => {
    const gate = setup();
    for (const action of ['browse', 'revisit', 'cancel', 'reuse'] as const) {
      expect(gate.inspect('ROLE-OWNER', action)).toEqual({ ok: true, session_id: null, draft_id: null });
    }
    expect(gate.counts()).toEqual({ sessions: 0, drafts: 0, team_assets: 0 });
  });

  it('creates one session and draft only after explicit authorized creation, then deduplicates retries', () => {
    expect(createHash('sha256').update(sourceText).digest('hex')).toBe(baselineDigest);
    const gate = setup();
    const first = gate.start('ROLE-OWNER', request);
    expect(first).toEqual({ ok: true, session_id: 'cs_1', draft_id: 'draft_1' });
    expect(gate.start('ROLE-OWNER', request)).toEqual(first);
    expect(gate.counts()).toEqual({ sessions: 1, drafts: 1, team_assets: 0 });
    expect(gate.start('ROLE-OWNER', { ...request, purpose: 'different intent' })).toEqual({ ok: false, reason: 'idempotency_conflict' });
    expect(gate.counts()).toEqual({ sessions: 1, drafts: 1, team_assets: 0 });
  });

  it('refuses unknown actors, cross-space intent, invalid source, wrong baseline and missing intent without side effects', () => {
    const gate = setup();
    const attempts = [
      { ...request, actor_id: 'missing' },
      { ...request, actor_id: 'ROLE-OTHER' },
      { ...request, asset_space_id: 'AS-VEGA' },
      { ...request, source_id: 'SRC-UNKNOWN' },
      { ...request, baseline_digest: 'old-fixture-baseline' },
      { ...request, purpose: '  ' },
      { ...request, action: 'browse' as never },
    ];
    for (const attempt of attempts) expect(gate.start('ROLE-OWNER', attempt).ok).toBe(false);
    expect(gate.counts()).toEqual({ sessions: 0, drafts: 0, team_assets: 0 });
  });

  it('rejects forged actor claims and role or space borrowed across teams', () => {
    const gate = createSyntheticCreationGate({
      members: [
        { actor_id: 'ROLE-OWNER', team_id: 'TEAM-ORION', asset_space_ids: ['AS-ORION'], can_create: false },
        { actor_id: 'ROLE-OWNER', team_id: 'TEAM-VEGA', asset_space_ids: ['AS-VEGA'], can_create: true },
      ], sources: [{ ...source }], baseline_digest: baselineDigest,
    });
    expect(gate.start('ROLE-OWNER', request)).toEqual({ ok: false, reason: 'unauthorized' });
    expect(setup().start('ROLE-OTHER', request)).toEqual({ ok: false, reason: 'unauthorized' });
    expect(gate.counts()).toEqual({ sessions: 0, drafts: 0, team_assets: 0 });
  });

  it('rechecks fake membership, source and baseline before returning even a cached retry', () => {
    const gate = setup();
    const first = gate.start('ROLE-OWNER', request);
    expect(first.ok).toBe(true);
    gate.revoke('ROLE-OWNER');
    expect(gate.start('ROLE-OWNER', request)).toEqual({ ok: false, reason: 'unauthorized' });
    gate.restore('ROLE-OWNER');
    gate.invalidateSource('SRC-REQ-01');
    expect(gate.start('ROLE-OWNER', request)).toEqual({ ok: false, reason: 'invalid_source' });
    gate.restoreSource('SRC-REQ-01');
    gate.changeBaseline('fixture-baseline-v2');
    expect(gate.start('ROLE-OWNER', request)).toEqual({ ok: false, reason: 'stale_baseline' });
    expect(gate.counts()).toEqual({ sessions: 1, drafts: 1, team_assets: 0 });
  });

  it('does not let a denied actor reserve another actor’s idempotency key', () => {
    const gate = setup();
    expect(gate.start('ROLE-OTHER', { ...request, actor_id: 'ROLE-OTHER' }).ok).toBe(false);
    expect(gate.start('ROLE-OWNER', request)).toEqual({ ok: true, session_id: 'cs_1', draft_id: 'draft_1' });
    expect(gate.counts()).toEqual({ sessions: 1, drafts: 1, team_assets: 0 });
  });
});
