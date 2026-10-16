import { z } from 'zod';

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const sourceCommit = z.string().regex(/^[0-9a-f]{40}$/);
const sensitiveText = /(?:authorization\s*[:=]\s*bearer|bearer\s+[a-z0-9._~+/=-]+|cookie\s*[:=]|(?:password|passwd|passphrase|token|api[_-]?key|client[_-]?secret|secret|access[_-]?key)\s*[:=]|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:SECRET|TOKEN|API[_-]?KEY|ACCESS[_-]?KEY)(?:\s*[:=]|(?:_|\b))|["'](?:password|passwd|passphrase|token|api[_-]?key|client[_-]?secret|secret|access[_-]?key)["']\s*:\s*["']|-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----)/i;
const safeText = (max: number) => z.string().trim().min(1).max(max).refine(
  (value) => !sensitiveText.test(value),
  { message: 'sensitive credential text is not allowed' },
);
const actor = z.string().trim().min(1).max(200);

export const evidenceManifestSchema = z.strictObject({
  manifest_id: z.string().trim().min(1).max(200),
  gate: z.enum(['p0', 'p0-plugin-spike', 'n0']),
  subject: z.enum(['workbench-product-package', 'backend', 'dsh-harness', 'provider-contract']),
  status: z.enum(['pending', 'passed', 'failed', 'blocked', 'unknown', 'reconciling', 'fallback_only']),
  provider_mode: z.enum(['fake', 'admin', 'real']),
  scope_status: z.enum(['in_scope', 'readiness_only', 'non_blocking']),
  integration_status: z.enum(['pending', 'blocked', 'fallback_only', 'contract_verified', 'real_verified']),
  contract_evidence_level: z.enum(['fact', 'candidate', 'pending_checks', 'warning']),
  target_version: safeText(300),
  environment: z.enum(['local', 'fresh-profile', 'tencent-cloud-nonprod']),
  profile: safeText(300),
  source_commit: sourceCommit,
  artifact_digest: digest,
  fixture_digest: digest,
  commands: z.array(z.strictObject({ command: safeText(1_000), exit_code: z.number().int(), result: safeText(2_000) })),
  readbacks: z.array(z.strictObject({ kind: z.enum(['install', 'restart', 'load', 'health', 'ui', 'provider', 'rollback']), status: z.enum(['succeeded', 'failed', 'unknown']), reference: safeText(500) })),
  failure_path: safeText(2_000),
  rollback_result: safeText(2_000),
  decision: z.enum(['go', 'no_go', 'go_with_expiry']),
  decision_date: z.string().datetime({ offset: true }),
  expiry_or_review_date: z.string().datetime({ offset: true }),
  rollback_or_next_action: safeText(2_000),
  decision_record_id: actor,
  requested_by: actor,
  executed_by: actor,
  decision_owner: actor,
  reviewer: actor,
  reviewed_by: actor,
  hard_blockers: z.array(safeText(500)),
  next_action: safeText(2_000),
  owner: actor,
  review_date: z.string().datetime({ offset: true }),
  fallback_expires_at: z.string().datetime({ offset: true }).nullable(),
  evidence_digest: digest,
}).superRefine((manifest, context) => {
  if (manifest.provider_mode !== 'real' && manifest.integration_status === 'real_verified') {
    context.addIssue({ code: 'custom', path: ['integration_status'], message: 'real_verified requires real provider mode' });
  }
  if (manifest.status === 'fallback_only' || manifest.integration_status === 'fallback_only') {
    if (manifest.decision !== 'go_with_expiry') {
      context.addIssue({ code: 'custom', path: ['decision'], message: 'fallback-only evidence requires an expiring decision' });
    }
  }
  if (
    manifest.decision === 'go' &&
    ['pending', 'blocked', 'fallback_only'].includes(manifest.integration_status)
  ) {
    context.addIssue({ code: 'custom', path: ['decision'], message: 'go requires verified integration status' });
  }
  if (
    manifest.decision === 'go' &&
    ['failed', 'blocked', 'unknown', 'reconciling'].includes(manifest.status)
  ) {
    context.addIssue({ code: 'custom', path: ['decision'], message: 'go requires a passed status' });
  }
  if (manifest.status === 'failed' && manifest.hard_blockers.length === 0) {
    context.addIssue({ code: 'custom', path: ['hard_blockers'], message: 'failed evidence requires a hard blocker' });
  }
  if (manifest.status === 'blocked' && manifest.hard_blockers.length === 0) {
    context.addIssue({ code: 'custom', path: ['hard_blockers'], message: 'blocked evidence requires a hard blocker' });
  }
  if (manifest.decision === 'go_with_expiry' && manifest.fallback_expires_at === null) {
    context.addIssue({ code: 'custom', path: ['fallback_expires_at'], message: 'go_with_expiry requires an expiry' });
  }
  if (manifest.decision === 'no_go' && manifest.hard_blockers.length === 0) {
    context.addIssue({ code: 'custom', path: ['hard_blockers'], message: 'no_go requires a hard blocker' });
  }
});

export type EvidenceManifest = z.infer<typeof evidenceManifestSchema>;
