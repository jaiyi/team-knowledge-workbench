import { describe, expect, it } from 'vitest';
import { workbenchPackageManifestSchema } from '../../packages/validation/src/package.js';

const digest = `sha256:${'a'.repeat(64)}`;

const manifest = {
  package_identity: 'team-knowledge-workbench',
  package_version: '0.1.0',
  source_commit: '0123456789abcdef0123456789abcdef01234567',
  server_entry: 'server/index.js',
  client_entry: 'client/index.js',
  payload_files: [
    { path: 'client/index.js', digest },
    { path: 'server/index.js', digest },
  ],
  artifact_digest: digest,
  contract_evidence_level: 'pending_checks',
};

describe('Workbench package manifest contract', () => {
  it('accepts a local package manifest', () => {
    expect(workbenchPackageManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('rejects unsafe entries and invalid host claims', () => {
    expect(
      workbenchPackageManifestSchema.safeParse({
        ...manifest,
        server_entry: '../server.js',
      }).success,
    ).toBe(false);
    expect(
      workbenchPackageManifestSchema.safeParse({
        ...manifest,
        contract_evidence_level: 'real_verified',
      }).success,
    ).toBe(false);
  });

  it('rejects platform-specific and encoded traversal entries', () => {
    for (const path of ['C:/Windows/evil.js', 'C:evil.js', '//server/share.js', '%2e%2e/server.js']) {
      expect(
        workbenchPackageManifestSchema.safeParse({
          ...manifest,
          server_entry: path,
          payload_files: [
            { path, digest },
            { path: 'client/index.js', digest },
          ],
        }).success,
      ).toBe(false);
    }
  });
});
