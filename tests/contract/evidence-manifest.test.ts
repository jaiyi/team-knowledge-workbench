import { describe, expect, it } from 'vitest';
import { evidenceManifestSchema } from '../../packages/validation/src/evidence-manifest.js';

const digest = `sha256:${'b'.repeat(64)}`;

const localEvidence = {
  manifest_id: 'p0-local-package-001',
  gate: 'p0',
  subject: 'workbench-product-package',
  status: 'passed',
  provider_mode: 'fake',
  scope_status: 'readiness_only',
  integration_status: 'contract_verified',
  contract_evidence_level: 'pending_checks',
  target_version: 'repository-local',
  environment: 'local',
  profile: 'not-applicable',
  source_commit: '0123456789abcdef0123456789abcdef01234567',
  artifact_digest: digest,
  fixture_digest: digest,
  commands: [{ command: 'npm test', exit_code: 0, result: '49 tests passed' }],
  readbacks: [{ kind: 'health', status: 'succeeded', reference: 'local-test' }],
  failure_path: 'DSH install not attempted',
  rollback_result: 'not-applicable',
  decision: 'no_go',
  decision_date: '2026-10-16T00:00:00Z',
  expiry_or_review_date: '2026-10-23T00:00:00Z',
  rollback_or_next_action: 'collect fixed DSH contract evidence',
  decision_record_id: 'decision-p0-local-001',
  requested_by: 'developer',
  executed_by: 'local-process',
  decision_owner: 'developer',
  reviewer: 'developer',
  reviewed_by: 'developer',
  hard_blockers: ['DSH version and fresh profile are not fixed'],
  next_action: 'run DSH installation spike when environment is available',
  owner: 'developer',
  review_date: '2026-10-16T00:00:00Z',
  fallback_expires_at: null,
  evidence_digest: digest,
};

describe('P0 evidence manifest contract', () => {
  it('accepts local contract evidence with an explicit no-go', () => {
    expect(evidenceManifestSchema.safeParse(localEvidence).success).toBe(true);
  });

  it('rejects real verification from fake mode', () => {
    expect(
      evidenceManifestSchema.safeParse({
        ...localEvidence,
        integration_status: 'real_verified',
      }).success,
    ).toBe(false);
  });

  it('rejects fallback evidence as an unconditional go decision', () => {
    expect(
      evidenceManifestSchema.safeParse({
        ...localEvidence,
        status: 'fallback_only',
        integration_status: 'fallback_only',
        decision: 'go',
      }).success,
    ).toBe(false);
  });

  it('rejects failed-like statuses with an unconditional go decision', () => {
    for (const status of ['failed', 'blocked', 'unknown', 'reconciling'] as const) {
      expect(
        evidenceManifestSchema.safeParse({
          ...localEvidence,
          status,
          hard_blockers: status === 'failed' || status === 'blocked'
            ? ['provider did not reach a terminal success state']
            : [],
          decision: 'go',
        }).success,
      ).toBe(false);
    }
  });

  it('rejects inconsistent failed and blocked decisions', () => {
    expect(
      evidenceManifestSchema.safeParse({
        ...localEvidence,
        status: 'failed',
        hard_blockers: [],
        decision: 'go',
      }).success,
    ).toBe(false);
    expect(
      evidenceManifestSchema.safeParse({
        ...localEvidence,
        status: 'blocked',
        integration_status: 'blocked',
        decision: 'go',
      }).success,
    ).toBe(false);
  });

  it('rejects sensitive command and result text', () => {
    expect(
      evidenceManifestSchema.safeParse({
        ...localEvidence,
        commands: [
          { command: 'curl --header Authorization: Bearer secret', exit_code: 0, result: 'ok' },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects common credential formats in evidence text', () => {
    for (const result of [
      'password: hunter2',
      '{"password":"hunter2"}',
      'token=abc',
      'client_secret: abc',
      'AWS_SECRET_ACCESS_KEY=abc',
      'TENCENTCLOUD_SECRET_ID=abc',
      'TENCENTCLOUD_SECRET_KEY=abc',
      'TENCENTCLOUD_SESSION_TOKEN=abc',
      'SERVICE_API_KEY=abc',
      'SERVICE_ACCESS_KEY=abc',
      '-----BEGIN PRIVATE KEY-----',
    ]) {
      expect(
        evidenceManifestSchema.safeParse({
          ...localEvidence,
          commands: [{ command: 'npm test', exit_code: 0, result }],
        }).success,
      ).toBe(false);
    }
  });
});
