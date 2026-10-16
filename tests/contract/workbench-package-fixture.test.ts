import { describe, expect, it } from 'vitest';
import { buildLocalPackage } from '../../packages/distribution-adapter/src/local-package-builder.js';
import { buildWorkbenchPackageInput } from '../../packages/distribution-adapter/src/workbench-package-fixture.js';

describe('Workbench package fixture', () => {
  it('contains a self-consistent Host bundle and runtime registration', () => {
    const input = buildWorkbenchPackageInput({ sourceCommit: '0123456789abcdef0123456789abcdef01234567' });
    const built = buildLocalPackage(input);
    const server = built.files.find((file) => file.path === 'index.js');
    const manifest = built.files.find((file) => file.path === 'package.json');
    const registration = built.files.find((file) => file.path === 'cordis.patch.yml');

    expect(server?.content).toContain('export function apply(ctx, config = {})');
    expect(server?.content).toContain('DSH host Workbench runtime identity mismatch');
    expect(manifest?.content).toContain('"@local/team-knowledge-workbench"');
    expect(manifest?.content).toContain('"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }');
    expect(registration?.content).toContain('team-knowledge-workbench');
    expect(registration?.content).toContain('name: \'@local/team-knowledge-workbench\'');
    expect(registration?.content).toContain(`runtime_identity_digest: '${built.manifest.runtime_identity_digest}'`);
    expect(registration?.content).not.toContain('sha256:0000000000000000000000000000000000000000000000000000000000000000');
    expect(built.manifest.runtime_identity_digest).not.toBe(built.manifest.artifact_digest);
  });

  it('rejects a source commit that could alter generated module syntax', () => {
    expect(() => buildWorkbenchPackageInput({ sourceCommit: 'x'.repeat(40) })).toThrow(
      'source commit must be a 40-character lowercase Git commit',
    );
  });
});
