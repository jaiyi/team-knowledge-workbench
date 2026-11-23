import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createSyntheticPrivateInbox } from '../support/synthetic-private-inbox.js';
import { createSyntheticCreationGate } from '../support/synthetic-creation-session.js';

const sourceText = readFileSync(new URL('../../docs/工程设计/合成测试基线/01-虚构来源资料.md', import.meta.url), 'utf8');
const sourceDigest = 'cb64e758d67558ccb51eeb06d07e898a1a66e43ab0953ea313c9fa40adf2d66f';
const now = Date.parse('2026-07-01T09:00:00Z');
const expiresAt = Date.parse('2026-07-15T09:00:00Z');
const members = [
  { actor_id: 'ROLE-OWNER', team_id: 'TEAM-ORION', asset_space_ids: ['AS-ORION'] },
  { actor_id: 'ROLE-OWNER', team_id: 'TEAM-VEGA', asset_space_ids: ['AS-VEGA'] },
  { actor_id: 'ROLE-OTHER', team_id: 'TEAM-ORION', asset_space_ids: ['AS-ORION'] },
];
const sources = [
  { source_id: 'SRC-REQ-01', team_id: 'TEAM-ORION', asset_space_id: 'AS-ORION',
    locator: 'fixture://orion/req-01', purpose: 'personal_revisit', retainable: true, valid: true,
    allowed_actor_ids: ['ROLE-OWNER'], expires_at: expiresAt },
  { source_id: 'SRC-REQ-02', team_id: 'TEAM-VEGA', asset_space_id: 'AS-VEGA',
    locator: 'fixture://vega/req-02', purpose: 'personal_revisit', retainable: true, valid: true,
    allowed_actor_ids: ['ROLE-OWNER'], expires_at: expiresAt },
];
const saveOrion = { source_id: 'SRC-REQ-01', asset_space_id: 'AS-ORION', purpose: 'personal_revisit',
  note: '只在本人有权范围回访', idempotency_key: 'save-1' };
const saveVega = { ...saveOrion, source_id: 'SRC-REQ-02', asset_space_id: 'AS-VEGA' };
const setup = () => {
  let time = now;
  const inbox = createSyntheticPrivateInbox({
    members: members.map((member) => ({ ...member, asset_space_ids: [...member.asset_space_ids] })),
    spaces: [{ asset_space_id: 'AS-ORION', team_id: 'TEAM-ORION' }, { asset_space_id: 'AS-VEGA', team_id: 'TEAM-VEGA' }],
    sources: sources.map((source) => ({ ...source, allowed_actor_ids: [...source.allowed_actor_ids] })), clock: () => time,
  });
  return { inbox, advance: (value: number) => { time = value; } };
};

describe('T02 personal Inbox boundary (isolated fake only)', () => {
  it('saves minimal authorized locators separately in both spaces and revisits only in scope', () => {
    expect(createHash('sha256').update(sourceText).digest('hex')).toBe(sourceDigest);
    const { inbox } = setup();
    const owner = inbox.authenticate('ROLE-OWNER');
    const orion = inbox.save(owner, saveOrion);
    const vega = inbox.save(owner, saveVega);
    expect(orion).toMatchObject({ ok: true, item: { inbox_item_id: 'inbox_1', owner_principal_id: 'ROLE-OWNER',
      origin_space_id: 'AS-ORION', source_ref: 'SRC-REQ-01', locator: 'fixture://orion/req-01', status: 'saved' } });
    expect(vega).toMatchObject({ ok: true, item: { inbox_item_id: 'inbox_2', origin_space_id: 'AS-VEGA' } });
    expect(orion.ok && Object.keys(orion.item).sort()).toEqual([
      'created_at', 'expires_at', 'inbox_item_id', 'locator', 'note_excerpt', 'origin_space_id',
      'owner_principal_id', 'purpose', 'source_ref', 'status', 'team_id',
    ]);
    expect(inbox.list(owner, 'AS-ORION')).toEqual({ ok: true, items: [orion.ok && orion.item] });
    expect(inbox.list(owner, 'AS-VEGA')).toEqual({ ok: true, items: [vega.ok && vega.item] });
    expect(inbox.revisit(owner, 'AS-ORION', 'inbox_1')).toEqual(orion);
    expect(inbox.revisit(owner, 'AS-VEGA', 'inbox_1')).toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.navigate(owner, 'AS-ORION', 'inbox_1')).toEqual({ ok: true, pending_locator: 'fixture://orion/req-01' });
    expect(inbox.remove(owner, 'AS-ORION', 'inbox_1')).toEqual({ ok: true, removed: true });
    expect(inbox.revisit(owner, 'AS-ORION', 'inbox_1')).toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.list(owner, 'AS-ORION')).toEqual({ ok: true, items: [] });
    expect(inbox.revisit(owner, 'AS-VEGA', 'inbox_2')).toEqual(vega);
    expect(inbox.counts()).toEqual({ saved: 1, removed: 1 });
  });

  it('rechecks authorization before replaying a save and never resurrects a removed item', () => {
    const { inbox } = setup();
    const owner = inbox.authenticate('ROLE-OWNER');
    const first = inbox.save(owner, saveOrion);
    expect(inbox.save(owner, saveOrion)).toEqual(first);
    expect(inbox.save(owner, { ...saveOrion, note: 'other intent' })).toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.counts()).toEqual({ saved: 1, removed: 0 });
    inbox.invalidateSource('SRC-REQ-01');
    expect(inbox.save(owner, saveOrion)).toEqual({ ok: false, reason: 'unavailable' });
    inbox.restoreSource('SRC-REQ-01');
    inbox.revoke('ROLE-OWNER');
    expect(inbox.save(owner, saveOrion)).toEqual({ ok: false, reason: 'unavailable' });
    inbox.restore('ROLE-OWNER');
    expect(inbox.remove(owner, 'AS-ORION', 'inbox_1')).toEqual({ ok: true, removed: true });
    expect(inbox.save(owner, saveOrion)).toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.counts()).toEqual({ saved: 0, removed: 1 });
  });

  it('does not let a denied save reserve an idempotency key for its owner', () => {
    const { inbox } = setup();
    const other = inbox.authenticate('ROLE-OTHER');
    const owner = inbox.authenticate('ROLE-OWNER');
    expect(inbox.save(other, saveOrion)).toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.save(owner, saveOrion)).toMatchObject({ ok: true, item: { inbox_item_id: 'inbox_1' } });
    expect(inbox.counts()).toEqual({ saved: 1, removed: 0 });
  });

  it('rejects guessed IDs and another principal even within the same team without existence disclosure', () => {
    const { inbox } = setup();
    const owner = inbox.authenticate('ROLE-OWNER');
    const other = inbox.authenticate('ROLE-OTHER');
    expect(inbox.save(owner, saveOrion).ok).toBe(true);
    for (const id of ['inbox_1', 'inbox_guessed']) {
      expect(inbox.revisit(other, 'AS-ORION', id)).toEqual({ ok: false, reason: 'unavailable' });
      expect(inbox.navigate(other, 'AS-ORION', id)).toEqual({ ok: false, reason: 'unavailable' });
      expect(inbox.remove(other, 'AS-ORION', id)).toEqual({ ok: false, reason: 'unavailable' });
    }
    expect(inbox.list(other, 'AS-ORION')).toEqual({ ok: true, items: [] });
    expect(inbox.save(other, { ...saveOrion, idempotency_key: 'other-save' }))
      .toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.revisit(owner, 'AS-ORION', 'inbox_guessed')).toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.counts()).toEqual({ saved: 1, removed: 0 });
  });

  it('rejects forged owner, locator, unrelated source and borrowed team/space binding', () => {
    const { inbox } = setup();
    const owner = inbox.authenticate('ROLE-OWNER');
    for (const input of [
      { ...saveOrion, owner_principal_id: 'ROLE-OTHER' },
      { ...saveOrion, locator: 'fixture://other/forged' },
      { ...saveOrion, source_id: 'SRC-REQ-02' },
      { ...saveOrion, source_id: 'SRC-MISSING' },
      { ...saveOrion, purpose: 'team_submission' },
      { ...saveOrion, note: 'x'.repeat(201) },
      { ...saveOrion, note: 'unsafe\0note' },
      { ...saveOrion, idempotency_key: ' ' },
    ]) expect(inbox.save(owner, input)).toEqual({ ok: false, reason: 'unavailable' });
    const bound = createSyntheticPrivateInbox({ members: [
      { actor_id: 'ROLE-OWNER', team_id: 'TEAM-ORION', asset_space_ids: ['AS-VEGA'] },
      { actor_id: 'ROLE-OWNER', team_id: 'TEAM-VEGA', asset_space_ids: ['AS-ORION'] },
    ], spaces: [{ asset_space_id: 'AS-ORION', team_id: 'TEAM-ORION' },
      { asset_space_id: 'AS-VEGA', team_id: 'TEAM-VEGA' }], sources, clock: () => now });
    expect(bound.save(bound.authenticate('ROLE-OWNER'), saveOrion)).toEqual({ ok: false, reason: 'unavailable' });
    expect(bound.save(bound.authenticate('ROLE-OWNER'), saveVega)).toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.counts()).toEqual({ saved: 0, removed: 0 });
  });

  it('rechecks a single space membership independently of other grants and cached claims', () => {
    const { inbox } = setup();
    const owner = inbox.authenticate('ROLE-OWNER');
    expect(inbox.save(owner, saveOrion).ok).toBe(true);
    expect(inbox.save(owner, saveVega).ok).toBe(true);
    inbox.revokeSpace('ROLE-OWNER', 'AS-ORION');
    expect(inbox.list(owner, 'AS-ORION')).toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.revisit(owner, 'AS-ORION', 'inbox_1')).toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.save(owner, { ...saveOrion, idempotency_key: 'save-2' }))
      .toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.remove(owner, 'AS-ORION', 'inbox_1')).toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.revisit(owner, 'AS-VEGA', 'inbox_2').ok).toBe(true);
    expect(inbox.counts()).toEqual({ saved: 2, removed: 0 });
  });

  it('fails closed on revoked membership/source, forbidden retention and expired references, including listing/deletion', () => {
    const { inbox, advance } = setup();
    const owner = inbox.authenticate('ROLE-OWNER');
    expect(inbox.save(owner, saveOrion).ok).toBe(true);
    inbox.invalidateSource('SRC-REQ-01');
    const unavailable = { ok: false, reason: 'unavailable' };
    expect(inbox.list(owner, 'AS-ORION')).toEqual(unavailable);
    expect(inbox.revisit(owner, 'AS-ORION', 'inbox_1')).toEqual(unavailable);
    expect(inbox.navigate(owner, 'AS-ORION', 'inbox_1')).toEqual(unavailable);
    expect(inbox.remove(owner, 'AS-ORION', 'inbox_1')).toEqual(unavailable);
    inbox.restoreSource('SRC-REQ-01');
    inbox.revokeSourceAccess('SRC-REQ-01', 'ROLE-OWNER');
    expect(inbox.list(owner, 'AS-ORION')).toEqual(unavailable);
    expect(inbox.navigate(owner, 'AS-ORION', 'inbox_1')).toEqual(unavailable);
    inbox.grantSourceAccess('SRC-REQ-01', 'ROLE-OWNER');
    inbox.setRetainable('SRC-REQ-01', false);
    expect(inbox.revisit(owner, 'AS-ORION', 'inbox_1')).toEqual(unavailable);
    inbox.setRetainable('SRC-REQ-01', true);
    inbox.revoke('ROLE-OWNER');
    expect(inbox.list(owner, 'AS-ORION')).toEqual(unavailable);
    expect(inbox.revisit(owner, 'AS-ORION', 'inbox_1')).toEqual(unavailable);
    expect(inbox.remove(owner, 'AS-ORION', 'inbox_1')).toEqual(unavailable);
    inbox.restore('ROLE-OWNER');
    advance(expiresAt);
    expect(inbox.list(owner, 'AS-ORION')).toEqual(unavailable);
    expect(inbox.revisit(owner, 'AS-ORION', 'inbox_1')).toEqual(unavailable);
    expect(inbox.navigate(owner, 'AS-ORION', 'inbox_1')).toEqual(unavailable);
    expect(inbox.remove(owner, 'AS-ORION', 'inbox_1')).toEqual(unavailable);
    expect(inbox.counts()).toEqual({ saved: 1, removed: 0 });
  });

  it('does not accept signed locators, service actors, unbound spaces or mutate stored records through return values', () => {
    const { inbox } = setup();
    const owner = inbox.authenticate('ROLE-OWNER');
    expect(inbox.save({ ...owner!, actor: { actor_id: 'ROLE-OWNER', actor_type: 'service' } }, saveOrion))
      .toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.list(owner, 'AS-MISSING')).toEqual({ ok: false, reason: 'unavailable' });
    inbox.changeLocator('SRC-REQ-01', 'https://example.invalid/item?signature=secret');
    expect(inbox.save(owner, saveOrion)).toEqual({ ok: false, reason: 'unavailable' });
    inbox.changeLocator('SRC-REQ-01', 'fixture://orion/req-01');
    const first = inbox.save(owner, saveOrion);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('Expected fake save');
    (first.item as { note_excerpt: string }).note_excerpt = 'tampered';
    expect(inbox.revisit(owner, 'AS-ORION', first.item.inbox_item_id)).toMatchObject({ ok: true,
      item: { note_excerpt: saveOrion.note } });
    expect(inbox.counts()).toEqual({ saved: 1, removed: 0 });
  });

  it('refuses mutated principal claims and changed source locators rather than returning cached metadata', () => {
    const { inbox } = setup();
    const owner = inbox.authenticate('ROLE-OWNER')!;
    expect(inbox.save(owner, saveOrion).ok).toBe(true);
    expect(Object.isFrozen(owner)).toBe(true);
    expect(Object.isFrozen(owner.actor)).toBe(true);
    const forged = { ...owner, actor: { actor_id: 'ROLE-OTHER', actor_type: 'human' as const } };
    expect(inbox.revisit(forged, 'AS-ORION', 'inbox_1')).toEqual({ ok: false, reason: 'unavailable' });
    const refreshed = inbox.authenticate('ROLE-OWNER');
    inbox.changeLocator('SRC-REQ-01', 'fixture://orion/another-version');
    expect(inbox.revisit(refreshed, 'AS-ORION', 'inbox_1')).toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.navigate(refreshed, 'AS-ORION', 'inbox_1')).toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.save(refreshed, saveOrion)).toEqual({ ok: false, reason: 'unavailable' });
    expect(inbox.list(refreshed, 'AS-ORION')).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('keeps fetch and T01 creation counts at zero across accepted and refused Inbox actions', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Inbox must not fetch'); });
    try {
      const { inbox } = setup();
      const gate = createSyntheticCreationGate({ members: [
        { actor_id: 'ROLE-OWNER', team_id: 'TEAM-ORION', asset_space_ids: ['AS-ORION'], can_create: true },
      ], sources: [{ source_id: 'SRC-REQ-01', team_id: 'TEAM-ORION', asset_space_id: 'AS-ORION', valid: true }],
      baseline_digest: sourceDigest });
      const owner = inbox.authenticate('ROLE-OWNER');
      expect(inbox.save(owner, saveOrion).ok).toBe(true);
      expect(inbox.list(owner, 'AS-ORION').ok).toBe(true);
      expect(inbox.revisit(owner, 'AS-ORION', 'inbox_1').ok).toBe(true);
      expect(inbox.navigate(owner, 'AS-ORION', 'inbox_1').ok).toBe(true);
      expect(inbox.navigate(null, 'AS-ORION', 'inbox_1')).toEqual({ ok: false, reason: 'unavailable' });
      expect(inbox.remove(owner, 'AS-ORION', 'inbox_1').ok).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
      expect(gate.counts()).toEqual({ sessions: 0, drafts: 0, team_assets: 0 });
    } finally { fetch.mockRestore(); }
  });
});
