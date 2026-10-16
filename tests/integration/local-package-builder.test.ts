import { describe, expect, it } from 'vitest';
import { buildLocalPackage } from '../../packages/distribution-adapter/src/local-package-builder.js';

const payload = [
  { path: 'server/index.js', content: 'export const server = true;\n' },
  { path: 'client/index.js', content: 'export const client = true;\n' },
];

describe('local package builder', () => {
  it('produces a stable artifact digest and validated manifest', () => {
    const first = buildLocalPackage({
      packageIdentity: 'team-knowledge-workbench',
      packageVersion: '0.1.0',
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      serverEntry: 'server/index.js',
      clientEntry: 'client/index.js',
      files: payload,
    });
    const second = buildLocalPackage({
      packageIdentity: 'team-knowledge-workbench',
      packageVersion: '0.1.0',
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      serverEntry: 'server/index.js',
      clientEntry: 'client/index.js',
      files: [...payload].reverse(),
    });

    expect(first.manifest.artifact_digest).toBe(second.manifest.artifact_digest);
    expect(first.manifest.runtime_identity_digest).toBe(second.manifest.runtime_identity_digest);
    expect(first.manifest.payload_files).toEqual(second.manifest.payload_files);
    expect(first.manifest.contract_evidence_level).toBe('pending_checks');
  });

  it('does not claim real installation or provider verification', () => {
    const result = buildLocalPackage({
      packageIdentity: 'team-knowledge-workbench',
      packageVersion: '0.1.0',
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      serverEntry: 'server/index.js',
      clientEntry: 'client/index.js',
      files: payload,
    });

    expect(result.manifest.contract_evidence_level).not.toBe('real_verified');
    expect(result.manifest).not.toHaveProperty('install_method');
  });
});
