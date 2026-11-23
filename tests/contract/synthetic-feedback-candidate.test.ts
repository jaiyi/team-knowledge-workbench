import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createSyntheticFeedbackCandidate } from '../support/synthetic-feedback-candidate.js';
import { createSyntheticCreationGate } from '../support/synthetic-creation-session.js';

const sourceText = readFileSync(new URL('../../docs/工程设计/合成测试基线/01-虚构来源资料.md', import.meta.url), 'utf8');
const sourceDigest = 'cb64e758d67558ccb51eeb06d07e898a1a66e43ab0953ea313c9fa40adf2d66f';
const now = Date.parse('2026-07-01T09:00:00Z');
const report = { asset_space_id: 'AS-ORION', category: 'answer_incorrect', summary: '虚构回答与任务问题不符', idempotency_key: 'report-1' };
const unavailable = { ok: false, reason: 'unavailable' };
const setup = () => {
  let time = now;
  const feedback = createSyntheticFeedbackCandidate({
    members: [
      { actor_id: 'ROLE-REPORTER', team_id: 'TEAM-ORION', asset_space_ids: ['AS-ORION'], can_triage: false },
      { actor_id: 'ROLE-REVIEWER', team_id: 'TEAM-ORION', asset_space_ids: ['AS-ORION'], can_triage: true },
      { actor_id: 'ROLE-OTHER', team_id: 'TEAM-ORION', asset_space_ids: ['AS-ORION'], can_triage: false },
      { actor_id: 'ROLE-REPORTER', team_id: 'TEAM-VEGA', asset_space_ids: ['AS-VEGA'], can_triage: false },
    ],
    spaces: [{ asset_space_id: 'AS-ORION', team_id: 'TEAM-ORION' }, { asset_space_id: 'AS-VEGA', team_id: 'TEAM-VEGA' }],
    tasks: [{ task_ref: 'task-orion-1', actor_id: 'ROLE-REPORTER', asset_space_id: 'AS-ORION', valid: true, expires_at: now + 1000 }],
    clock: () => time,
  });
  return { feedback, advance: (value: number) => { time = value; } };
};

describe('T04 isolated Feedback Candidate contract', () => {
  it('accepts and revisits an assetless, eventless sanitized report without claiming a verified call', () => {
    expect(createHash('sha256').update(sourceText).digest('hex')).toBe(sourceDigest);
    const { feedback } = setup();
    const reporter = feedback.authenticate('ROLE-REPORTER');
    const receipt = feedback.report(reporter, report);
    expect(receipt).toEqual({ ok: true, feedback: {
      feedback_id: 'feedback_1', reporter_id: 'ROLE-REPORTER', asset_space_id: 'AS-ORION',
      category: report.category, summary: report.summary, task_ref: null, status: 'received',
      owner: null, next_check_at: null, disposition: null, decision_reason: null,
      attribution: 'unverified', created_at: new Date(now).toISOString(),
    } });
    expect(feedback.revisit(reporter, 'AS-ORION', 'feedback_1')).toEqual(receipt);
    expect(feedback.report(reporter, report)).toEqual(receipt);
    expect(feedback.counts()).toEqual({ feedback: 1 });
  });

  it('rejects conflicting replay, unsafe or invented payloads without reserving the key', () => {
    const { feedback } = setup();
    const reporter = feedback.authenticate('ROLE-REPORTER');
    for (const payload of [
      { ...report, prompt: 'full prompt' }, { ...report, trace: 'full trace' },
      { ...report, tool_parameters: { secret: 'value' } }, { ...report, asset_id: 'invented' },
      { ...report, version: 'invented' }, { ...report, owner: 'ROLE-REVIEWER' },
      { ...report, summary: 'https://example.invalid/raw' }, { ...report, summary: 'x'.repeat(281) },
      { ...report, summary: ' ' }, { ...report, summary: 'secret\0value' },
      { ...report, category: 'unknown' }, { ...report, idempotency_key: ' ' },
    ]) expect(feedback.report(reporter, payload)).toEqual(unavailable);
    const accepted = feedback.report(reporter, report);
    expect(accepted.ok).toBe(true);
    expect(feedback.report(reporter, { ...report, summary: 'another intent' })).toEqual(unavailable);
    expect(feedback.counts()).toEqual({ feedback: 1 });
  });

  it('validates optional expiring task reference but does not require one', () => {
    const { feedback, advance } = setup();
    const reporter = feedback.authenticate('ROLE-REPORTER');
    expect(feedback.report(reporter, { ...report, task_ref: 'missing' })).toEqual(unavailable);
    expect(feedback.report(feedback.authenticate('ROLE-OTHER'), { ...report, task_ref: 'task-orion-1' })).toEqual(unavailable);
    expect(feedback.report(reporter, { ...report, task_ref: 'task-orion-1' })).toMatchObject({ ok: true,
      feedback: { task_ref: 'task-orion-1', attribution: 'unverified', status: 'received' } });
    expect(feedback.revisit(feedback.authenticate('ROLE-REVIEWER'), 'AS-ORION', 'feedback_1'))
      .toMatchObject({ ok: true, feedback: { task_ref: null, attribution: 'unverified' } });
    expect(feedback.triage(feedback.authenticate('ROLE-REVIEWER'), 'AS-ORION', 'feedback_1',
      { disposition: 'platform', reason: '合成平台待核' }))
      .toMatchObject({ ok: true, feedback: { task_ref: null, status: 'triaged' } });
    advance(now + 1000);
    expect(feedback.revisit(reporter, 'AS-ORION', 'feedback_1')).toEqual(unavailable);
    expect(feedback.report(reporter, { ...report, task_ref: 'task-orion-1' })).toEqual(unavailable);
    expect(feedback.report(reporter, { ...report, idempotency_key: 'report-2' })).toMatchObject({ ok: true,
      feedback: { feedback_id: 'feedback_2', task_ref: null } });
  });

  it('keeps private reports scoped to reporter and assigned reviewer, with fresh access checks', () => {
    const { feedback } = setup();
    const reporter = feedback.authenticate('ROLE-REPORTER');
    const other = feedback.authenticate('ROLE-OTHER');
    const reviewer = feedback.authenticate('ROLE-REVIEWER');
    feedback.report(reporter, report);
    for (const id of ['feedback_1', 'feedback_missing']) {
      expect(feedback.revisit(other, 'AS-ORION', id)).toEqual(unavailable);
      expect(feedback.revisit(reporter, 'AS-VEGA', id)).toEqual(unavailable);
    }
    expect(feedback.revisit(reviewer, 'AS-ORION', 'feedback_1')).toMatchObject({ ok: true });
    feedback.revoke('ROLE-REPORTER');
    expect(feedback.revisit(reporter, 'AS-ORION', 'feedback_1')).toEqual(unavailable);
    expect(feedback.report(reporter, report)).toEqual(unavailable);
    feedback.restore('ROLE-REPORTER');
    feedback.revokeSpace('ROLE-REPORTER', 'AS-ORION');
    expect(feedback.revisit(reporter, 'AS-ORION', 'feedback_1')).toEqual(unavailable);
    expect(feedback.revisit(reviewer, 'AS-ORION', 'feedback_1')).toMatchObject({ ok: true });
    expect(feedback.counts()).toEqual({ feedback: 1 });
  });

  it('only a current reviewer records non-knowledge routing and a reasoned closure', () => {
    const { feedback } = setup();
    const reporter = feedback.authenticate('ROLE-REPORTER');
    const reviewer = feedback.authenticate('ROLE-REVIEWER');
    feedback.report(reporter, report);
    expect(feedback.triage(reporter, 'AS-ORION', 'feedback_1', { disposition: 'platform', reason: '合成服务问题' }))
      .toEqual(unavailable);
    expect(feedback.triage(reviewer, 'AS-ORION', 'feedback_1', { disposition: 'platform', reason: '合成服务问题' }))
      .toMatchObject({ ok: true, feedback: { status: 'triaged', owner: 'ROLE-REVIEWER',
        disposition: 'platform', decision_reason: '合成服务问题', next_check_at: new Date(now + 1000).toISOString() } });
    feedback.revoke('ROLE-REVIEWER');
    expect(feedback.triage(reviewer, 'AS-ORION', 'feedback_1', { disposition: 'closed', reason: '误报' }))
      .toEqual(unavailable);
    feedback.restore('ROLE-REVIEWER');
    feedback.revokeSpace('ROLE-REVIEWER', 'AS-ORION');
    expect(feedback.triage(reviewer, 'AS-ORION', 'feedback_1', { disposition: 'closed', reason: '误报' }))
      .toEqual(unavailable);
    const reassigned = feedback.authenticate('ROLE-REVIEWER');
    expect(feedback.triage(reassigned, 'AS-ORION', 'feedback_1', { disposition: 'closed', reason: '误报' }))
      .toEqual(unavailable);
  });

  it('only a current reviewer with space access can close with a reason', () => {
    const { feedback } = setup();
    const reporter = feedback.authenticate('ROLE-REPORTER');
    const reviewer = feedback.authenticate('ROLE-REVIEWER');
    feedback.report(reporter, report);
    expect(feedback.triage(reviewer, 'AS-ORION', 'feedback_1', { disposition: 'closed', reason: '' }))
      .toEqual(unavailable);
    expect(feedback.triage(reviewer, 'AS-ORION', 'feedback_1', { disposition: 'closed', reason: '已核查为虚构误报' }))
      .toMatchObject({ ok: true, feedback: { status: 'closed', disposition: 'closed',
        owner: 'ROLE-REVIEWER', decision_reason: '已核查为虚构误报', next_check_at: null } });
    expect(feedback.revisit(reporter, 'AS-ORION', 'feedback_1')).toMatchObject({ ok: true,
      feedback: { status: 'closed', attribution: 'unverified' } });
    expect(feedback.triage(reviewer, 'AS-ORION', 'feedback_1', { disposition: 'platform', reason: 'late' }))
      .toEqual(unavailable);
  });

  it('never fetches or creates a session, draft or team asset on positive and negative paths', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Feedback must not fetch'); });
    try {
      const { feedback } = setup();
      const gate = createSyntheticCreationGate({ members: [
        { actor_id: 'ROLE-REPORTER', team_id: 'TEAM-ORION', asset_space_ids: ['AS-ORION'], can_create: true },
      ], sources: [], baseline_digest: sourceDigest });
      const reporter = feedback.authenticate('ROLE-REPORTER');
      expect(feedback.report(reporter, report).ok).toBe(true);
      expect(feedback.report(null, report)).toEqual(unavailable);
      expect(feedback.revisit(reporter, 'AS-ORION', 'feedback_1').ok).toBe(true);
      expect(feedback.triage(reporter, 'AS-ORION', 'feedback_1', { disposition: 'closed', reason: 'not mine' }))
        .toEqual(unavailable);
      expect(fetch).not.toHaveBeenCalled();
      expect(gate.counts()).toEqual({ sessions: 0, drafts: 0, team_assets: 0 });
    } finally { fetch.mockRestore(); }
  });
});
